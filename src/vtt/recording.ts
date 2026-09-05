export type VttRecordingState = 'idle' | 'requesting' | 'recording' | 'processing' | 'cancelled' | 'empty' | 'failed';

export interface VttSelectionRange {
  start: number;
  end: number;
}

export interface VttCapture {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  selection: VttSelectionRange;
}

export interface VttRecorderOptions {
  selection: VttSelectionRange;
  onStateChange?: (state: VttRecordingState) => void;
  onLevelChange?: (level: 0 | 1 | 2 | 3) => void;
  onRmsChange?: (rms: number) => void;
  onElapsedChange?: (elapsedMs: number) => void;
  silenceThreshold?: number;
  silenceDurationMs?: number;
  minimumDurationMs?: number;
  maximumDurationMs?: number;
}

export const VTT_AUDIO_BITRATE = 32_000;
export const VTT_MIN_BLOB_BYTES = 2_048;
export const VTT_MIN_DURATION_MS = 500;
export const VTT_SILENCE_DURATION_MS = 4_000;
export const VTT_MAX_DURATION_MS = 60_000;
const RMS_SAMPLE_INTERVAL_MS = 100;
const DEFAULT_SILENCE_THRESHOLD = 0.018;

const SUPPORTED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
] as const;

export function getSupportedVttMimeType(mediaRecorder: Pick<typeof MediaRecorder, 'isTypeSupported'> = globalThis.MediaRecorder): string {
  for (const mimeType of SUPPORTED_MIME_TYPES) {
    if (mediaRecorder.isTypeSupported(mimeType)) return mimeType;
  }
  throw new Error('This browser does not provide a supported microphone recording format.');
}

export function shouldDiscardVttCapture(blobSize: number, durationMs: number): boolean {
  return blobSize < VTT_MIN_BLOB_BYTES || durationMs < VTT_MIN_DURATION_MS;
}

export function getVttSignalLevel(rms: number): 0 | 1 | 2 | 3 {
  if (rms < DEFAULT_SILENCE_THRESHOLD) return 0;
  if (rms < 0.06) return 1;
  if (rms < 0.16) return 2;
  return 3;
}

function vibrate(pattern: number | number[]): void {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(pattern);
}

function calculateRms(analyser: AnalyserNode, data: Uint8Array<ArrayBuffer>): number {
  analyser.getByteTimeDomainData(data);
  let sum = 0;
  for (const sample of data) {
    const centered = (sample - 128) / 128;
    sum += centered * centered;
  }
  return Math.sqrt(sum / data.length);
}

export class VttRecorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private analyserData: Uint8Array<ArrayBuffer> | null = null;
  private meterTimer: number | null = null;
  private maxDurationTimer: number | null = null;
  private silenceStartedAt: number | null = null;
  private startedAt = 0;
  private resolveCapture: ((capture: VttCapture) => void) | null = null;
  private rejectCapture: ((error: Error) => void) | null = null;
  private readonly options: Required<Pick<VttRecorderOptions, 'selection' | 'silenceThreshold' | 'silenceDurationMs' | 'minimumDurationMs' | 'maximumDurationMs'>> & Pick<VttRecorderOptions, 'onStateChange' | 'onLevelChange' | 'onRmsChange' | 'onElapsedChange'>;

  constructor(options: VttRecorderOptions) {
    this.options = {
      selection: options.selection,
      silenceThreshold: options.silenceThreshold ?? DEFAULT_SILENCE_THRESHOLD,
      silenceDurationMs: options.silenceDurationMs ?? VTT_SILENCE_DURATION_MS,
      minimumDurationMs: options.minimumDurationMs ?? VTT_MIN_DURATION_MS,
      maximumDurationMs: options.maximumDurationMs ?? VTT_MAX_DURATION_MS,
      onStateChange: options.onStateChange,
      onLevelChange: options.onLevelChange,
      onRmsChange: options.onRmsChange,
      onElapsedChange: options.onElapsedChange,
    };
  }

  get state(): VttRecordingState {
    if (this.recorder?.state === 'recording') return 'recording';
    return 'idle';
  }

  async start(): Promise<VttCapture> {
    if (this.recorder && this.recorder.state !== 'inactive') throw new Error('VTT recording is already active.');
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone capture is not supported by this browser.');
    if (typeof globalThis.MediaRecorder === 'undefined') throw new Error('This browser does not support microphone recording.');

    this.setState('requesting');
    try {
      const mimeType = getSupportedVttMimeType(globalThis.MediaRecorder);
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.startedAt = performance.now();
      this.silenceStartedAt = null;
      this.options.onElapsedChange?.(0);
      this.options.onRmsChange?.(0);
      this.options.onLevelChange?.(0);
      this.setupMeter(this.stream);
      const chunks: BlobPart[] = [];
      this.recorder = new globalThis.MediaRecorder(this.stream, { mimeType, audioBitsPerSecond: VTT_AUDIO_BITRATE });
      this.recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data); };
      this.recorder.onerror = () => this.fail(new Error('The browser could not record microphone audio.'));
      this.recorder.onstop = () => {
        const durationMs = Math.max(0, Math.round(performance.now() - this.startedAt));
        const blob = new Blob(chunks, { type: mimeType });
        const capture: VttCapture = { blob, mimeType, durationMs, selection: this.options.selection };
        this.cleanup(false);
        if (shouldDiscardVttCapture(blob.size, durationMs) || durationMs < this.options.minimumDurationMs) {
          this.setState('empty');
          this.resolveCapture?.(capture);
          this.resolveCapture = null;
          this.rejectCapture = null;
          this.setState('idle');
          return;
        }
        this.setState('processing');
        this.resolveCapture?.(capture);
        this.resolveCapture = null;
        this.rejectCapture = null;
      };

      const capturePromise = new Promise<VttCapture>((resolve, reject) => {
        this.resolveCapture = resolve;
        this.rejectCapture = reject;
      });
      this.recorder.start(250);
      vibrate(20);
      this.setState('recording');
      this.maxDurationTimer = window.setTimeout(() => this.stop(), this.options.maximumDurationMs);
      return await capturePromise;
    } catch (cause) {
      this.cleanup(true);
      this.setState('failed');
      throw cause instanceof Error ? cause : new Error('Microphone capture failed.');
    }
  }

  stop(): void {
    if (!this.recorder || this.recorder.state === 'inactive') return;
    vibrate([15, 30, 15]);
    this.recorder.stop();
  }

  cancel(): void {
    const recorder = this.recorder;
    if (!recorder || recorder.state === 'inactive') return;
    recorder.onstop = null;
    recorder.stop();
    this.cleanup(true);
    this.resolveCapture = null;
    this.rejectCapture = null;
    this.setState('cancelled');
    this.setState('idle');
  }

  private setupMeter(stream: MediaStream): void {
    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor) return;
    this.audioContext = new AudioContextConstructor();
    const source = this.audioContext.createMediaStreamSource(stream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    source.connect(this.analyser);
    this.analyserData = new Uint8Array(this.analyser.fftSize);
    this.meterTimer = window.setInterval(() => this.sampleMeter(), RMS_SAMPLE_INTERVAL_MS);
  }

  private sampleMeter(): void {
    if (!this.analyser || !this.analyserData || !this.startedAt) return;
    const elapsedMs = Math.max(0, performance.now() - this.startedAt);
    const rms = calculateRms(this.analyser, this.analyserData);
    this.options.onElapsedChange?.(Math.round(elapsedMs));
    this.options.onRmsChange?.(rms);
    this.options.onLevelChange?.(getVttSignalLevel(rms));
    if (elapsedMs < this.options.minimumDurationMs) return;
    if (rms < this.options.silenceThreshold) {
      this.silenceStartedAt ??= performance.now();
      if (performance.now() - this.silenceStartedAt >= this.options.silenceDurationMs) this.stop();
    } else {
      this.silenceStartedAt = null;
    }
  }

  private cleanup(rejectPending: boolean): void {
    if (this.meterTimer !== null) { window.clearInterval(this.meterTimer); this.meterTimer = null; }
    if (this.maxDurationTimer !== null) { window.clearTimeout(this.maxDurationTimer); this.maxDurationTimer = null; }
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.recorder = null;
    this.analyser = null;
    this.analyserData = null;
    this.silenceStartedAt = null;
    this.startedAt = 0;
    const context = this.audioContext;
    this.audioContext = null;
    if (context) void context.close().catch(() => undefined);
    this.options.onRmsChange?.(0);
    this.options.onLevelChange?.(0);
    this.options.onElapsedChange?.(0);
    if (rejectPending) this.rejectCapture?.(new Error('VTT recording was cancelled.'));
  }

  private fail(error: Error): void {
    this.cleanup(true);
    this.rejectCapture?.(error);
    this.resolveCapture = null;
    this.rejectCapture = null;
    this.setState('failed');
  }

  private setState(state: VttRecordingState): void {
    this.options.onStateChange?.(state);
  }
}

declare global {
  interface Window { webkitAudioContext?: typeof AudioContext; }
}
