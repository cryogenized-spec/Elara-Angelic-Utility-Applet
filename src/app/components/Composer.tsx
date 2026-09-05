import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Icon } from '../../ui/icons';
import type { ProviderStatus } from '../../domain/chat';
import { MarkdownReference } from './MarkdownReference';
import { RecordingBanner } from './RecordingBanner';
import { VttRecorder, shouldDiscardVttCapture, type VttRecordingState } from '../../vtt/recording';
import { insertTranscriptAtSelection } from '../../vtt/draft-insertion';
import { transcribeVttCapture } from '../../vtt/transcription';
import './composer.css';

const MAX_HEIGHT = 132;

type ComposerProps = {
  draft: string;
  status: ProviderStatus;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onCancel: () => void;
};

export function Composer({ draft, status, onDraftChange, onSend, onCancel }: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const expandedTextareaRef = useRef<HTMLTextAreaElement>(null);
  const recorderRef = useRef<VttRecorder | null>(null);
  const transcriptionAbortRef = useRef<AbortController | null>(null);
  const vttTargetRef = useRef<HTMLTextAreaElement | null>(null);
  const [markdownOpen, setMarkdownOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [vttState, setVttState] = useState<VttRecordingState>('idle');
  const [vttRms, setVttRms] = useState(0);
  const [vttElapsed, setVttElapsed] = useState(0);
  const [vttMessage, setVttMessage] = useState<string | null>(null);

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
    if (!expanded) return;
    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape' && !vttBusyForState(vttState)) setExpanded(false);
    }
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [expanded, vttState]);

  useEffect(() => () => {
    recorderRef.current?.cancel();
    transcriptionAbortRef.current?.abort();
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

  async function handleVtt(target: HTMLTextAreaElement | null): Promise<void> {
    if (status === 'streaming') return;
    if (vttState === 'recording') {
      recorderRef.current?.stop();
      return;
    }
    if (vttState === 'processing') {
      transcriptionAbortRef.current?.abort();
      transcriptionAbortRef.current = null;
      setVttMessage('Voice transcription cancelled.');
      setVttState('idle');
      setVttRms(0);
      setVttElapsed(0);
      return;
    }
    if (vttBusy || !target) return;

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
      onStateChange: setVttState,
      onRmsChange: setVttRms,
      onElapsedChange: setVttElapsed,
    });
    recorderRef.current = recorder;

    try {
      const capture = await recorder.start();
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
      const inserted = insertTranscriptAtSelection(draft, capture.selection, transcript);
      onDraftChange(inserted.value);
      setVttMessage(null);
      requestAnimationFrame(() => {
        const nextTarget = vttTargetRef.current ?? (expanded ? expandedTextareaRef.current : textareaRef.current);
        nextTarget?.focus();
        nextTarget?.setSelectionRange(inserted.cursor, inserted.cursor);
      });
      setVttState('idle');
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      const message = cause instanceof Error ? cause.message : 'Voice transcription failed.';
      setVttMessage(message);
      setVttState('failed');
      window.setTimeout(() => setVttState('idle'), 1200);
    } finally {
      transcriptionAbortRef.current = null;
      recorderRef.current = null;
      vttTargetRef.current = null;
      setVttRms(0);
      setVttElapsed(0);
    }
  }

  function bannerStop(): void {
    if (vttState === 'recording') recorderRef.current?.stop();
    else if (vttState === 'processing') {
      transcriptionAbortRef.current?.abort();
      transcriptionAbortRef.current = null;
      setVttMessage('Voice transcription cancelled.');
      setVttState('idle');
      setVttRms(0);
      setVttElapsed(0);
    }
  }

  function micAriaLabel(): string {
    if (vttState === 'recording') return 'Recording voice input';
    if (vttState === 'processing') return 'Transcribing voice input';
    if (vttState === 'requesting') return 'Requesting microphone access';
    return 'VTT voice input';
  }

  const banner = vttBusy ? (
    <RecordingBanner state={vttState} rms={vttRms} elapsedMs={vttElapsed} onStop={bannerStop} />
  ) : null;

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
          <button className="composer__icon composer__vtt-button" type="button" aria-label={micAriaLabel()} aria-pressed={false} disabled={composerLocked} onClick={() => void handleVtt(expandedTextareaRef.current)}>
            <Icon name="mic" size={20} />
          </button>
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
      <button className="composer__icon composer__vtt-button" type="button" aria-label={micAriaLabel()} aria-pressed={false} disabled={composerLocked} onClick={() => void handleVtt(textareaRef.current)}>
        <Icon name="mic" size={20} />
      </button>
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
