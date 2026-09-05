import { useEffect, useRef } from 'react';
import type { VttRecordingState } from '../../vtt/recording';
import { Icon } from '../../ui/icons';

function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export function RecordingBanner({
  state,
  rms,
  elapsedMs,
  onStop,
}: {
  state: VttRecordingState;
  rms: number;
  elapsedMs: number;
  onStop: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rmsRef = useRef(rms);

  useEffect(() => {
    rmsRef.current = rms;
  }, [rms]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    let frame = 0;
    let phase = 0;
    const history = new Array<number>(80).fill(0);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.max(1, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      const mid = height / 2;
      const current = Math.max(0, Math.min(1, rmsRef.current / 0.35));
      history.push(current);
      history.shift();
      phase += 0.12;

      context.clearRect(0, 0, width, height);
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.lineWidth = 1.8;
      const gradient = context.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, 'rgba(154, 224, 255, 0.45)');
      gradient.addColorStop(0.35, 'rgba(243, 190, 255, 0.95)');
      gradient.addColorStop(0.72, 'rgba(255, 244, 214, 0.95)');
      gradient.addColorStop(1, 'rgba(164, 245, 224, 0.55)');
      context.strokeStyle = gradient;
      context.shadowBlur = 12;
      context.shadowColor = 'rgba(225, 197, 255, 0.34)';
      context.beginPath();
      history.forEach((sample, index) => {
        const x = (index / (history.length - 1)) * width;
        const envelope = 5 + sample * (height * 0.34);
        const wave = Math.sin(index * 0.75 + phase) * envelope;
        const y = mid + wave;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.stroke();
      context.shadowBlur = 0;
      frame = window.requestAnimationFrame(draw);
    };

    draw();
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, []);

  const processing = state === 'processing';
  const requesting = state === 'requesting';

  return (
    <section className="composer__vtt-banner" aria-label="Voice recording" data-state={state}>
      <div className="composer__vtt-meta">
        <span className="composer__vtt-live-dot" aria-hidden="true" />
        <span className="composer__vtt-label">{processing ? 'TRANSCRIBING' : requesting ? 'STARTING' : 'REC'}</span>
        <span className="composer__vtt-timer" aria-live="polite">{formatElapsed(elapsedMs)}</span>
      </div>
      <div className="composer__vtt-signal" aria-hidden="true">
        <canvas ref={canvasRef} />
      </div>
      <button
        className="composer__vtt-stop"
        type="button"
        aria-label={processing ? 'Cancel voice transcription' : 'Stop VTT voice input'}
        onClick={onStop}
        disabled={requesting}
      >
        <Icon name={processing ? 'close' : 'stop'} size={17} strokeWidth={2} />
        <span>{processing ? 'Cancel' : 'Stop'}</span>
      </button>
    </section>
  );
}
