import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Icon } from '../../ui/icons';
import type { ProviderStatus } from '../../domain/chat';
import { MarkdownReference } from './MarkdownReference';
import { RecordingBanner } from './RecordingBanner';
import { VttRecorder, shouldDiscardVttCapture, type VttRecordingState } from '../../vtt/recording';
import { insertTranscriptAtSelection } from '../../vtt/draft-insertion';
import { transcribeVttCapture } from '../../vtt/transcription';
import { transformVttTranscript, type VttTransformMode } from '../../vtt/transformation';
import { DEFAULT_GEMINI_MODEL } from '../../gemini/contracts';
import './composer.css';

const MAX_HEIGHT = 132;
const VTT_LONG_PRESS_MS = 300;

type ComposerProps = {
  draft: string;
  status: ProviderStatus;
  geminiModel?: string;
  systemInstruction: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onCancel: () => void;
};

export function Composer({ draft, status, geminiModel = DEFAULT_GEMINI_MODEL, systemInstruction, onDraftChange, onSend, onCancel }: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const expandedTextareaRef = useRef<HTMLTextAreaElement>(null);
  const recorderRef = useRef<VttRecorder | null>(null);
  const transcriptionAbortRef = useRef<AbortController | null>(null);
  const vttTargetRef = useRef<HTMLTextAreaElement | null>(null);
  const vttFocusRef = useRef<{ target: HTMLTextAreaElement; cursor: number } | null>(null);
  const vttSessionIdRef = useRef(0);
  const mountedRef = useRef(true);
  const vttPressTimerRef = useRef<number | null>(null);
  const vttLongPressTriggeredRef = useRef(false);
  const vttPressActiveRef = useRef(false);
  const vttModeControlRef = useRef<HTMLDivElement>(null);
  const [markdownOpen, setMarkdownOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [vttState, setVttState] = useState<VttRecordingState>('idle');
  const [vttRms, setVttRms] = useState(0);
  const [vttElapsed, setVttElapsed] = useState(0);
  const [vttMessage, setVttMessage] = useState<string | null>(null);
  const [vttTransformMode, setVttTransformMode] = useState<VttTransformMode>('raw');
  const [vttModeOpen, setVttModeOpen] = useState(false);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || expanded) return;
    textarea.style.height = 'auto';
    const nextHeight = Math.min(MAX_HEIGHT, Math.max(42, textarea.scrollHeight));
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
  }, [draft, expanded]);

  useEffect(() => {
    if (!expanded) return;
    const textarea = expandedTextareaRef.current;
    textarea?.focus();
    document.body.classList.add('composer-expanded-open');
    return () => document.body.classList.remove('composer-expanded-open');
  }, [expanded]);

  useEffect(() => {
    if (vttState !== 'idle') return;
    const pending = vttFocusRef.current;
    if (!pending) return;
    vttFocusRef.current = null;
    requestAnimationFrame(() => {
      if (!mountedRef.current || !pending.target.isConnected) return;
      pending.target.focus();
      pending.target.setSelectionRange(pending.cursor, pending.cursor);
    });
  }, [vttState, draft]);

  useEffect(() => {
    if (!vttModeOpen) return undefined;
    function handleOutsidePointer(event: PointerEvent) {
      if (!vttModeControlRef.current?.contains(event.target as Node)) setVttModeOpen(false);
    }
    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') setVttModeOpen(false);
    }
    window.addEventListener('pointerdown', handleOutsidePointer);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('pointerdown', handleOutsidePointer);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [vttModeOpen]);

  useEffect(() => {
    if (!expanded) return;
    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape' && !vttBusyForState(vttState)) setExpanded(false);
    }
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [expanded, vttState]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      vttSessionIdRef.current += 1;
      if (vttPressTimerRef.current !== null) window.clearTimeout(vttPressTimerRef.current);
      recorderRef.current?.cancel();
      transcriptionAbortRef.current?.abort();
      recorderRef.current = null;
      transcriptionAbortRef.current = null;
    };
  }, []);

  const vttBusy = vttState === 'requesting' || vttState === 'recording' || vttState === 'processing';
  const composerLocked = status === 'streaming' || vttBusy;

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    if (status === 'streaming' || vttBusy || !draft.trim()) return;
    event.preventDefault();
    onSend();
  }

  function handleExpandedKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && status !== 'streaming' && !vttBusy && draft.trim()) {
      event.preventDefault();
      onSend();
    }
  }

  function transformModeLabel(): string {
    if (vttTransformMode === 'polish') return 'Polish';
    if (vttTransformMode === 'roleplay') return 'Roleplay';
    return 'Raw';
  }

  async function handleVtt(target: HTMLTextAreaElement | null): Promise<void> {
    if (status === 'streaming') return;
    if (vttState === 'recording') {
      recorderRef.current?.stop();
      return;
    }
    if (vttState === 'processing') {
      vttSessionIdRef.current += 1;
      transcriptionAbortRef.current?.abort();
      transcriptionAbortRef.current = null;
      setVttMessage('Voice processing cancelled.');
      setVttState('idle');
      setVttRms(0);
      setVttElapsed(0);
      return;
    }
    if (vttBusy || !target) return;

    const sessionId = vttSessionIdRef.current + 1;
    vttSessionIdRef.current = sessionId;
    const selection = {
      start: target.selectionStart ?? draft.length,
      end: target.selectionEnd ?? draft.length,
    };
    vttTargetRef.current = target;
    setVttMessage(null);
    setVttRms(0);
    setVttElapsed(0);
    const recorder = new VttRecorder({
      selection,
      onStateChange: (state) => { if (mountedRef.current && vttSessionIdRef.current === sessionId) setVttState(state); },
      onRmsChange: (rms) => { if (mountedRef.current && vttSessionIdRef.current === sessionId) setVttRms(rms); },
      onElapsedChange: (elapsed) => { if (mountedRef.current && vttSessionIdRef.current === sessionId) setVttElapsed(elapsed); },
    });
    recorderRef.current = recorder;

    try {
      const capture = await recorder.start();
      if (!mountedRef.current || vttSessionIdRef.current !== sessionId) return;
      recorderRef.current = null;
      setVttElapsed(capture.durationMs);
      setVttRms(0);
      if (shouldDiscardVttCapture(capture.blob.size, capture.durationMs)) {
        setVttMessage('No speech detected.');
        setVttState('idle');
        return;
      }
      const controller = new AbortController();
      transcriptionAbortRef.current = controller;
      setVttState('processing');
      const transcript = await transcribeVttCapture(capture, controller.signal);
      if (!mountedRef.current || vttSessionIdRef.current !== sessionId) return;

      let message = transcript;
      let statusMessage: string | null = null;
      if (vttTransformMode !== 'raw') {
        statusMessage = vttTransformMode === 'polish' ? 'Polishing transcript…' : 'Converting to roleplay…';
        setVttMessage(statusMessage);
        try {
          message = await transformVttTranscript(transcript, vttTransformMode, { model: geminiModel, signal: controller.signal, systemInstruction });
        } catch (cause) {
          if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
          statusMessage = 'Transformation failed; inserted the raw transcript.';
          message = transcript;
          setVttMessage(statusMessage);
        }
      }

      if (!mountedRef.current || vttSessionIdRef.current !== sessionId) return;
      const inserted = insertTranscriptAtSelection(draft, capture.selection, message);
      onDraftChange(inserted.value);
      vttFocusRef.current = { target, cursor: inserted.cursor };
      setVttMessage(statusMessage);
      setVttState('idle');
    } catch (cause) {
      if (!mountedRef.current || vttSessionIdRef.current !== sessionId) return;
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        setVttMessage('Voice processing cancelled.');
        setVttState('idle');
        return;
      }
      const message = cause instanceof Error ? cause.message : 'Voice processing failed.';
      setVttMessage(message);
      setVttState('failed');
      window.setTimeout(() => {
        if (mountedRef.current && vttSessionIdRef.current === sessionId) setVttState('idle');
      }, 1200);
    } finally {
      if (vttSessionIdRef.current !== sessionId) return;
      transcriptionAbortRef.current = null;
      recorderRef.current = null;
      vttTargetRef.current = null;
      setVttRms(0);
      setVttElapsed(0);
    }
  }

  function beginVttPress(): void {
    if (status === 'streaming' || (!textareaRef.current && !expandedTextareaRef.current)) return;
    if (vttState === 'recording' || vttState === 'processing' || vttState === 'requesting') {
      vttPressActiveRef.current = true;
      vttLongPressTriggeredRef.current = false;
      return;
    }
    if (vttBusy) return;
    if (vttPressTimerRef.current !== null) window.clearTimeout(vttPressTimerRef.current);
    vttPressActiveRef.current = true;
    vttLongPressTriggeredRef.current = false;
    vttPressTimerRef.current = window.setTimeout(() => {
      if (!vttPressActiveRef.current || composerLocked) return;
      vttLongPressTriggeredRef.current = true;
      setVttModeOpen(true);
    }, VTT_LONG_PRESS_MS);
  }

  function endVttPress(target: HTMLTextAreaElement | null): void {
    if (!vttPressActiveRef.current) return;
    vttPressActiveRef.current = false;
    if (vttPressTimerRef.current !== null) {
      window.clearTimeout(vttPressTimerRef.current);
      vttPressTimerRef.current = null;
    }
    if (vttLongPressTriggeredRef.current) return;
    void handleVtt(target);
  }

  function cancelVttPress(): void {
    vttPressActiveRef.current = false;
    if (vttPressTimerRef.current !== null) {
      window.clearTimeout(vttPressTimerRef.current);
      vttPressTimerRef.current = null;
    }
    vttLongPressTriggeredRef.current = false;
  }

  function handleVttKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.repeat) return;
    event.preventDefault();
    beginVttPress();
  }

  function handleVttKeyUp(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    endVttPress(expanded ? expandedTextareaRef.current : textareaRef.current);
  }

  function selectVttMode(mode: VttTransformMode): void {
    setVttTransformMode(mode);
    setVttModeOpen(false);
  }

  const banner = vttBusy ? <RecordingBanner state={vttState} rms={vttRms} elapsedMs={vttElapsed} onStop={bannerStop} /> : null;

  function vttControl(targetRef: { current: HTMLTextAreaElement | null }) {
    return <div className="composer__vtt-control" ref={vttModeControlRef}>
      <button
        className={`composer__icon composer__vtt-button${vttState === 'recording' ? ' is-recording' : ''}`}
        type="button"
        aria-label={micAriaLabel()}
        aria-pressed={vttState === 'recording'}
        data-vtt-mode={vttTransformMode}
        disabled={composerLocked}
        onPointerDown={(event) => { if (event.pointerType === 'mouse' && event.button !== 0) return; beginVttPress(); }}
        onPointerUp={() => endVttPress(targetRef.current)}
        onPointerCancel={cancelVttPress}
        onKeyDown={handleVttKeyDown}
        onKeyUp={handleVttKeyUp}
      >
        <Icon name={vttState === 'processing' ? 'loader' : 'mic'} size={20} />
        <span className="composer__vtt-mode-glyph" aria-hidden="true">{vttTransformMode === 'raw' ? 'R' : vttTransformMode === 'polish' ? 'P' : 'RP'}</span>
      </button>
      {vttModeOpen && (
        <div className="composer__vtt-menu" role="menu" aria-label="Voice transcript mode">
          <button type="button" role="menuitemradio" aria-checked={vttTransformMode === 'raw'} className={vttTransformMode === 'raw' ? 'is-active' : ''} aria-label="Raw" onClick={() => selectVttMode('raw')}><span>Raw</span><small>Faithful transcript</small></button>
          <button type="button" role="menuitemradio" aria-checked={vttTransformMode === 'polish'} className={vttTransformMode === 'polish' ? 'is-active' : ''} aria-label="Polish" onClick={() => selectVttMode('polish')}><span>Polish</span><small>Clean natural prose</small></button>
          <button type="button" role="menuitemradio" aria-checked={vttTransformMode === 'roleplay'} className={vttTransformMode === 'roleplay' ? 'is-active' : ''} aria-label="Roleplay" onClick={() => selectVttMode('roleplay')}><span>Roleplay</span><small>Convert to scene prose</small></button>
        </div>
      )}
    </div>;
  }

  function bannerStop(): void {
    if (vttState === 'recording') recorderRef.current?.stop();
    else if (vttState === 'processing') {
      vttSessionIdRef.current += 1;
      transcriptionAbortRef.current?.abort();
      transcriptionAbortRef.current = null;
      setVttMessage('Voice processing cancelled.');
      setVttState('idle');
      setVttRms(0);
      setVttElapsed(0);
    }
  }

  function micAriaLabel(): string {
    if (vttState === 'recording') return 'Recording voice input';
    if (vttState === 'processing') return `${transformModeLabel()} voice input`;
    if (vttState === 'requesting') return 'Requesting microphone access';
    return 'VTT voice input';
  }

  if (expanded) {
    return <>
      <section className="composer-expanded" role="dialog" aria-modal="true" aria-label="Expanded message editor">
        <header className="composer-expanded__header">
          <div>
            <span className="composer-expanded__eyebrow">COMPOSE</span>
            <h2>Write to Elara</h2>
          </div>
          <button className="composer-expanded__collapse composer__icon" type="button" aria-label="Collapse message editor" onClick={() => setExpanded(false)} disabled={vttBusy}>
            <Icon name="collapse" size={20} />
          </button>
        </header>
        {banner}
        <textarea
          ref={expandedTextareaRef}
          className="composer-expanded__textarea"
          aria-label="Expanded message"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={handleExpandedKeyDown}
          placeholder="Write your message…"
          disabled={composerLocked}
          autoFocus
        />
        {vttMessage && <div className="composer__vtt-status" role="status" aria-live="polite">{vttMessage}</div>}
        <footer className="composer-expanded__footer">
          <button className="composer__icon composer__markdown" type="button" aria-label="Markdown reference" aria-expanded={markdownOpen} disabled={composerLocked} onClick={() => setMarkdownOpen((open) => !open)}>
            <Icon name="markdown" size={20} />
          </button>
          <button className="composer__icon" type="button" aria-label="Attach image or document" disabled={composerLocked}>
            <Icon name="paperclip" size={19} />
          </button>
          <div className="composer-expanded__spacer" />
          {vttControl(expandedTextareaRef)}
          <button className="composer__send" type="button" aria-label={status === 'streaming' ? 'Cancel response' : 'Send message'} disabled={composerLocked || !draft.trim()} onClick={() => { if (status === 'streaming') onCancel(); else onSend(); }}>
            <Icon name={status === 'streaming' ? 'close' : 'send'} size={19} />
          </button>
        </footer>
      </section>
      <MarkdownReference open={markdownOpen} onClose={() => setMarkdownOpen(false)} />
    </>;
  }

  return <>
    {banner}
    <form className="composer" onSubmit={(event) => { event.preventDefault(); if (status === 'streaming') onCancel(); else onSend(); }}>
      <button className="composer__icon composer__markdown" type="button" aria-label="Markdown reference" aria-expanded={markdownOpen} disabled={composerLocked} onClick={() => setMarkdownOpen((open) => !open)}>
        <Icon name="markdown" size={20} />
      </button>
      <button className="composer__icon" type="button" aria-label="Attach image or document" disabled={composerLocked}>
        <Icon name="paperclip" size={19} />
      </button>
      <div className="composer__input-wrap">
        <textarea ref={textareaRef} aria-label="Message Elara" value={draft} onChange={(event) => onDraftChange(event.target.value)} onKeyDown={handleKeyDown} placeholder="Message Elara…" rows={1} disabled={composerLocked} enterKeyHint="send" />
        <button className="composer__expand" type="button" aria-label="Expand message editor" onClick={() => setExpanded(true)} disabled={composerLocked}>
          <Icon name="expand" size={15} />
        </button>
      </div>
      {vttControl(textareaRef)}
      <button className="composer__send" type="submit" aria-label={status === 'streaming' ? 'Cancel response' : 'Send message'} disabled={composerLocked || !draft.trim()}>
        <Icon name={status === 'streaming' ? 'close' : 'send'} size={19} />
      </button>
    </form>
    {vttMessage && <div className="composer__vtt-status" role="status" aria-live="polite">{vttMessage}</div>}
    <MarkdownReference open={markdownOpen} onClose={() => setMarkdownOpen(false)} />
  </>;
}

function vttBusyForState(state: VttRecordingState): boolean {
  return state === 'requesting' || state === 'recording' || state === 'processing';
}
