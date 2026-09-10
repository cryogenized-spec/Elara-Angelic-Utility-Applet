import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { Icon } from '../../ui/icons';
import type { ProviderStatus } from '../../domain/chat';
import type { Attachment } from '../../domain/artifact';
import { ImageAttachmentPreview } from './artifacts/ImageAttachmentPreview';
import { DocumentAttachmentCard } from './artifacts/DocumentAttachmentCard';
import './artifacts/artifact-preview.css';
import { MarkdownReference } from './MarkdownReference';
import { RecordingBanner } from './RecordingBanner';
import { VttRecorder, shouldDiscardVttCapture, type VttRecordingState } from '../../vtt/recording';
import { insertTranscriptAtSelection } from '../../vtt/draft-insertion';
import { transcribeVttCapture } from '../../vtt/transcription';
import { transformVttTranscript, type VttTransformMode } from '../../vtt/transformation';
import { DEFAULT_GEMINI_MODEL } from '../../gemini/contracts';
import { composerEnterKeyHint, isComposerSendShortcut } from './composer-keys';
import { useComposerAutosize } from './composer-autosize';
import './composer.css';

const VTT_LONG_PRESS_MS = 300;

type ComposerProps = {
  draft: string;
  status: ProviderStatus;
  geminiModel?: string;
  systemInstruction: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onCancel: () => void;
  attachments?: Attachment[];
  onFilesSelected?: (files: FileList | null) => void;
  onRemoveAttachment?: (id: string) => void;
  /** Persisted preference; defaults to Enter = Send. */
  enterToSend?: boolean;
};

export function Composer({ draft, status, geminiModel = DEFAULT_GEMINI_MODEL, systemInstruction, onDraftChange, onSend, onCancel, attachments = [], onFilesSelected, onRemoveAttachment, enterToSend = true }: ComposerProps) {
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
  const attachmentControlRef = useRef<HTMLDivElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const [markdownOpen, setMarkdownOpen] = useState(false);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [vttState, setVttState] = useState<VttRecordingState>('idle');
  const [vttRms, setVttRms] = useState(0);
  const [vttElapsed, setVttElapsed] = useState(0);
  const [vttMessage, setVttMessage] = useState<string | null>(null);
  const [vttTransformMode, setVttTransformMode] = useState<VttTransformMode>('raw');
  const [vttModeOpen, setVttModeOpen] = useState(false);

  // Autosize: grow to ~COMPOSER_VISIBLE_LINES lines, then scroll internally.
  // The bound comes from the editor's own line-height, and the measurement is
  // cached — no per-keystroke style recalculation beyond the text itself.
  useComposerAutosize(textareaRef, draft, { enabled: !expanded });

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
    if (!attachmentMenuOpen) return undefined;
    function handleOutsidePointer(event: PointerEvent) {
      if (!attachmentControlRef.current?.contains(event.target as Node)) setAttachmentMenuOpen(false);
    }
    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') setAttachmentMenuOpen(false);
    }
    window.addEventListener('pointerdown', handleOutsidePointer);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('pointerdown', handleOutsidePointer);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [attachmentMenuOpen]);

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
      vttTargetRef.current = null;
      vttFocusRef.current = null;
    };
  }, []);

  const vttBusy = vttState === 'requesting' || vttState === 'recording' || vttState === 'processing';
  const isStreaming = status === 'streaming';
  const composerLocked = isStreaming || vttBusy;
  // The send button doubles as the stop button while streaming: it must stay
  // enabled so the user can cancel the turn. Every other composer control
  // stays locked until the turn settles.
  const sendDisabled = vttBusy || (!isStreaming && !draft.trim() && attachments.length === 0);

  const canSend = status !== 'streaming' && !vttBusy && (Boolean(draft.trim()) || attachments.length > 0);
  const enterKeyHint = composerEnterKeyHint(enterToSend);

  // Both composers share one Enter rule (see composer-keys.ts). Only the
  // configured send shortcut is intercepted; every other Enter reaches the
  // textarea so newlines behave natively.
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!isComposerSendShortcut({ key: event.key, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey, isComposing: event.nativeEvent.isComposing }, enterToSend)) return;
    if (!canSend) return;
    event.preventDefault();
    onSend();
  }

  function transformModeLabel(): string {
    if (vttTransformMode === 'polish') return 'Polish';
    if (vttTransformMode === 'roleplay') return 'Roleplay';
    return 'Raw';
  }

  function currentVttTarget(): HTMLTextAreaElement | null {
    return expanded ? expandedTextareaRef.current : textareaRef.current;
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
    const activeTarget = vttTargetRef.current ?? target;
    if (vttBusy || !activeTarget) return;

    const sessionId = vttSessionIdRef.current + 1;
    vttSessionIdRef.current = sessionId;
    const selection = {
      start: activeTarget.selectionStart ?? draft.length,
      end: activeTarget.selectionEnd ?? draft.length,
    };
    vttTargetRef.current = activeTarget;
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
        setVttMessage('No speech was detected.');
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

      const insertionTarget = vttTargetRef.current;
      if (!mountedRef.current || vttSessionIdRef.current !== sessionId || !insertionTarget || !insertionTarget.isConnected) return;
      const inserted = insertTranscriptAtSelection(draft, capture.selection, message);
      onDraftChange(inserted.value);
      vttFocusRef.current = { target: insertionTarget, cursor: inserted.cursor };
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
    if (status === 'streaming') return;
    const target = currentVttTarget();
    if (!target) return;
    vttTargetRef.current = target;
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
    void handleVtt(vttTargetRef.current ?? target ?? currentVttTarget());
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
    endVttPress(currentVttTarget());
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

  function handleFileInput(event: ChangeEvent<HTMLInputElement>): void {
    onFilesSelected?.(event.currentTarget.files);
    event.currentTarget.value = '';
    setAttachmentMenuOpen(false);
  }

  // The paperclip is the single home for the composer's secondary tools:
  // attachment sources first, then the Markdown reference. Every action is
  // represented by a Lucide icon plus its text label, so the menu stays legible
  // at phone widths without a separate control stealing editor width.
  function attachmentPicker() {
    return <div className="composer__attachment-control" ref={attachmentControlRef}>
      <button className="composer__icon" type="button" aria-label="Composer tools" aria-expanded={attachmentMenuOpen} aria-haspopup="menu" disabled={composerLocked} onClick={() => setAttachmentMenuOpen((open) => !open)}>
        <Icon name="paperclip" size={19} />
      </button>
      {attachmentMenuOpen && <div className="composer__attachment-menu" role="menu" aria-label="Composer tools">
        <p className="composer__attachment-menu-title" role="presentation">ATTACH</p>
        <button type="button" role="menuitem" aria-label="Camera: take a photo" title="Take a photo" onClick={() => cameraInputRef.current?.click()}>
          <Icon name="camera" size={18} />
          <span className="composer__attachment-menu-text"><span>Camera</span><small>Take a photo</small></span>
        </button>
        <button type="button" role="menuitem" aria-label="Photos / Gallery: choose an image" title="Choose an image" onClick={() => galleryInputRef.current?.click()}>
          <Icon name="image" size={18} />
          <span className="composer__attachment-menu-text"><span>Photos / Gallery</span><small>Choose an image</small></span>
        </button>
        <button type="button" role="menuitem" aria-label="File / Document: choose a document" title="Choose a document" onClick={() => documentInputRef.current?.click()}>
          <Icon name="docs" size={18} />
          <span className="composer__attachment-menu-text"><span>File / Document</span><small>Choose a document</small></span>
        </button>
        <p className="composer__attachment-menu-title" role="presentation">COMPOSE</p>
        <button type="button" role="menuitem" aria-label="Markdown reference" title="Open the Markdown formatting reference" onClick={() => { setAttachmentMenuOpen(false); setMarkdownOpen((open) => !open); }}>
          <Icon name="markdown" size={18} />
          <span className="composer__attachment-menu-text"><span>Markdown</span><small>Formatting reference</small></span>
        </button>
      </div>}
      <input ref={cameraInputRef} className="composer__file-input" type="file" accept="image/*" capture="environment" aria-label="Take a photo" onChange={handleFileInput} />
      <input ref={galleryInputRef} className="composer__file-input" type="file" accept="image/*" multiple aria-label="Choose photos" onChange={handleFileInput} />
      <input ref={documentInputRef} className="composer__file-input" type="file" accept="application/pdf,text/plain,text/markdown,application/json,text/csv,application/javascript,text/javascript,text/css,text/html,application/xml,text/xml" multiple aria-label="Choose a file or document" onChange={handleFileInput} />
    </div>;
  }

  function attachmentPreviews() {
    if (!attachments.length) return null;
    return <div className="composer__attachments artifact-list" aria-label="Selected attachments">
      {attachments.map((attachment) => attachment.kind === 'image'
        ? <ImageAttachmentPreview key={attachment.id} attachment={attachment} compact onRemove={onRemoveAttachment ? () => onRemoveAttachment(attachment.id) : undefined} />
        : <DocumentAttachmentCard key={attachment.id} attachment={attachment} onRemove={onRemoveAttachment ? () => onRemoveAttachment(attachment.id) : undefined} />)}
      {attachments.some((attachment) => attachment.kind === 'image') && <p className="composer__attachment-hint">Send the image first, then choose <strong>Extract text</strong> on its message artifact.</p>}
    </div>;
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
        {attachmentPreviews()}
        <textarea
          ref={expandedTextareaRef}
          className="composer-expanded__textarea"
          aria-label="Expanded message"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Write your message…"
          disabled={composerLocked}
          enterKeyHint={enterKeyHint}
          autoFocus
        />
        {vttMessage && <div className="composer__vtt-status" role="status" aria-live="polite">{vttMessage}</div>}
        <footer className="composer-expanded__footer">
          {attachmentPicker()}
          <div className="composer-expanded__spacer" />
          {vttControl(expandedTextareaRef)}
          <button className={`composer__send${isStreaming ? ' is-cancel' : ''}`} type="button" aria-label={isStreaming ? 'Cancel response' : 'Send message'} disabled={sendDisabled} onClick={() => { if (isStreaming) onCancel(); else onSend(); }}>
            <Icon name={isStreaming ? 'close' : 'send'} size={19} />
          </button>
        </footer>
      </section>
      <MarkdownReference open={markdownOpen} onClose={() => setMarkdownOpen(false)} />
    </>;
  }

  return <>
    {banner}
    {attachmentPreviews()}
    <form className="composer" onSubmit={(event) => { event.preventDefault(); if (status === 'streaming') onCancel(); else onSend(); }}>
      {attachmentPicker()}
      <div className="composer__input-wrap">
        <textarea ref={textareaRef} className="composer__input" aria-label="Message Elara" value={draft} onChange={(event) => onDraftChange(event.target.value)} onKeyDown={handleKeyDown} placeholder="Message Elara…" rows={1} disabled={composerLocked} enterKeyHint={enterKeyHint} />
        <button className="composer__expand" type="button" aria-label="Expand message editor" onClick={() => setExpanded(true)} disabled={composerLocked}>
          <Icon name="expand" size={15} />
        </button>
      </div>
      {vttControl(textareaRef)}
      <button className={`composer__send${isStreaming ? ' is-cancel' : ''}`} type="submit" aria-label={isStreaming ? 'Cancel response' : 'Send message'} disabled={sendDisabled}>
        <Icon name={isStreaming ? 'close' : 'send'} size={19} />
      </button>
    </form>
    {vttMessage && <div className="composer__vtt-status" role="status" aria-live="polite">{vttMessage}</div>}
    <MarkdownReference open={markdownOpen} onClose={() => setMarkdownOpen(false)} />
  </>;
}

function vttBusyForState(state: VttRecordingState): boolean {
  return state === 'requesting' || state === 'recording' || state === 'processing';
}
