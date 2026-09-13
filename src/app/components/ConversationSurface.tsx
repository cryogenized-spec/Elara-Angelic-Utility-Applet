import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage } from '../../domain/chat';
import { isActivePhase, type GenerationState } from '../../chat/generation-state';
import { deleteMessage } from '../../persistence/conversation';
import { GenerationActivity } from './GenerationTrace';
import { Icon } from '../../ui/icons';
import { MarkdownText } from './MarkdownText';
import { MessageArtifacts } from './artifacts/MessageArtifacts';
import { MessageMedia } from './media/MessageMedia';
import './conversation-surface.css';

const BOTTOM_STICK_THRESHOLD_PX = 32;
const ACTIVITY_ANCHOR_TOLERANCE_PX = 18;
type FollowMode = 'bottom' | 'activity' | 'manual';

function responseGroupFor(message: ChatMessage): string {
  return message.responseGroupId || message.id;
}

/**
 * Memoised: the surface is the most expensive subtree in the shell (every
 * message body is parsed by `react-markdown`), so it must not re-render when
 * unrelated shell state — the composer draft above all — changes.
 */
export const ConversationSurface = memo(function ConversationSurface({ messages, generation, onRegenerate }: { messages: ChatMessage[]; generation: GenerationState | null; onRegenerate: (messageId: string) => void }) {
  const conversationRef = useRef<HTMLElement>(null);
  const activityAnchorRef = useRef<HTMLDivElement>(null);
  const followModeRef = useRef<FollowMode>('bottom');
  const [manualScroll, setManualScroll] = useState(false);
  const [selectedVariants, setSelectedVariants] = useState<Record<string, number>>({});
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set());
  const seenCountsRef = useRef<Record<string, number>>({});

  const liveGeneration = generation !== null && generation.phase !== 'completed';
  const generationId = generation?.generationId;
  const generationPhase = generation?.phase;

  function atEnd(element: HTMLElement): boolean {
    return element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_STICK_THRESHOLD_PX;
  }

  function setFollowMode(mode: FollowMode): void {
    followModeRef.current = mode;
    setManualScroll(mode === 'manual');
  }

  function rememberScrollPosition() {
    const element = conversationRef.current;
    if (!element) return;

    if (followModeRef.current === 'activity') {
      const anchor = activityAnchorRef.current;
      if (anchor) {
        const offset = anchor.getBoundingClientRect().top - element.getBoundingClientRect().top;
        if (Math.abs(offset) <= ACTIVITY_ANCHOR_TOLERANCE_PX) return;
      }
      setFollowMode('manual');
      return;
    }

    setFollowMode(atEnd(element) ? 'bottom' : 'manual');
  }

  function scrollToEnd(behavior: ScrollBehavior = 'smooth') {
    const element = conversationRef.current;
    if (!element || followModeRef.current !== 'bottom') return;
    element.scrollTo({ top: Math.max(0, element.scrollHeight - element.clientHeight), behavior });
  }

  function jumpToLatest() {
    setFollowMode('bottom');
    scrollToEnd();
  }

  const visibleMessages = useMemo(() => messages.filter((message) => !deletedIds.has(message.id)), [messages, deletedIds]);
  const latestVisibleText = visibleMessages.at(-1)?.text;

  const activeAssistant = useMemo(() => {
    if (!liveGeneration) return undefined;
    const candidate = visibleMessages.at(-1);
    if (candidate?.role !== 'assistant' || candidate.providerTurn) return undefined;
    return candidate;
  }, [liveGeneration, visibleMessages]);

  const grouped = useMemo(() => {
    const entries: Array<{ message: ChatMessage; variants: ChatMessage[] }> = [];
    const groups = new Map<string, ChatMessage[]>();
    for (const message of visibleMessages) {
      if (activeAssistant?.id === message.id) continue;
      if (message.role !== 'assistant') {
        entries.push({ message, variants: [message] });
        continue;
      }
      if (!message.text.trim()) continue;
      const key = responseGroupFor(message);
      const variants = groups.get(key);
      if (variants) {
        variants.push(message);
        continue;
      }
      const next = [message];
      groups.set(key, next);
      entries.push({ message, variants: next });
    }
    return entries;
  }, [visibleMessages, activeAssistant]);

  useEffect(() => {
    const previousCounts = seenCountsRef.current;
    const nextCounts: Record<string, number> = {};
    for (const entry of grouped) {
      if (entry.message.role !== 'assistant') continue;
      nextCounts[responseGroupFor(entry.message)] = entry.variants.length;
    }

    setSelectedVariants((current) => {
      const next = { ...current };
      let changed = false;
      for (const entry of grouped) {
        if (entry.message.role !== 'assistant') continue;
        const key = responseGroupFor(entry.message);
        const count = entry.variants.length;
        const previousCount = previousCounts[key];
        const value = !(key in next) || (previousCount !== undefined && count > previousCount)
          ? count - 1
          : Math.min(next[key] ?? count - 1, count - 1);
        if (next[key] !== value) {
          next[key] = value;
          changed = true;
        }
      }
      return changed ? next : current;
    });

    seenCountsRef.current = nextCounts;
  }, [grouped]);

  useLayoutEffect(() => {
    if (!generationId || !generationPhase) return;
    const element = conversationRef.current;
    const anchor = activityAnchorRef.current;
    if (!element || !anchor) return;

    const shouldAnchor = isActivePhase(generationPhase)
      || (generationPhase === 'completed' && followModeRef.current === 'activity')
      || generationPhase === 'failed'
      || generationPhase === 'cancelled';
    if (!shouldAnchor || followModeRef.current === 'manual') return;

    const offset = anchor.getBoundingClientRect().top - element.getBoundingClientRect().top;
    element.scrollTo({ top: Math.max(0, element.scrollTop + offset), behavior: 'auto' });
    setFollowMode('activity');
  }, [generationId, generationPhase]);

  useEffect(() => {
    if (followModeRef.current === 'bottom') scrollToEnd();
  }, [visibleMessages.length, latestVisibleText]);

  useEffect(() => {
    const element = conversationRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      if (followModeRef.current !== 'bottom') return;
      element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  async function handleDelete(message: ChatMessage) {
    try {
      await deleteMessage(message.id, message.conversationId ?? 'primary');
      setDeletedIds((current) => new Set(current).add(message.id));
    } catch {
      // The message may already have disappeared locally; keep the chat surface stable.
    }
  }

  const hasLivePanel = generation !== null && generation.phase !== 'completed';
  if (visibleMessages.length === 0 && !hasLivePanel) {
    return <section className="conversation" aria-label="Conversation"><div className="empty-state"><span className="empty-state__kicker">ELARA / READY</span><h2>What shall we work on?</h2><p>Your conversation starts here. Elara's presence stays central while utility surfaces remain out of the visible chat.</p></div></section>;
  }

  return <section ref={conversationRef} className="conversation" aria-label="Conversation" onScroll={rememberScrollPosition}>
    <div className="conversation__stream">
      {grouped.map(({ message, variants }) => {
        if (message.role !== 'assistant') {
          return <article className="message message-user user-surface-frosted" key={message.id}>
            <header className="message-meta"><span>YOU</span><time dateTime={new Date(message.createdAt).toISOString()}>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></header>
            <div className="message-body"><MarkdownText text={message.text} /></div>
            <MessageArtifacts attachmentIds={message.attachments} artifactIds={message.artifacts} messageId={message.id} conversationId={message.conversationId} />
            <MessageMedia items={message.media} />
            <div className="message-actions" aria-label="Message actions">
              <button type="button" className="message-action" aria-label="Delete message" title="Delete message" onClick={() => void handleDelete(message)}><Icon name="trash" size={15} /></button>
            </div>
          </article>;
        }
        const groupId = responseGroupFor(message);
        const selectedIndex = Math.min(Math.max(selectedVariants[groupId] ?? variants.length - 1, 0), variants.length - 1);
        const selected = variants[selectedIndex];
        const anchorsCurrentGeneration = Boolean(generation?.generationId && selected.generationActivity?.id === generation.generationId);
        return <article className="message message-assistant" key={groupId}>
          <header className="message-meta"><span>ELARA</span><time dateTime={new Date(selected.createdAt).toISOString()}>{new Date(selected.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></header>
          {selected.generationActivity && <div ref={anchorsCurrentGeneration ? activityAnchorRef : undefined}><GenerationActivity record={selected.generationActivity} thoughtSummary={selected.providerTurn?.usage?.thoughtSummary} /></div>}
          {variants.length > 1 && <div className="response-variants" aria-label="Generated response variants">
            <button type="button" className="response-variants__button" aria-label="Previous response" disabled={selectedIndex === 0} onClick={() => setSelectedVariants((current) => ({ ...current, [groupId]: Math.max(0, selectedIndex - 1) }))}>‹</button>
            <span className="response-variants__pagination" aria-live="polite">{selectedIndex + 1}/{variants.length}</span>
            <button type="button" className="response-variants__button" aria-label="Next response" disabled={selectedIndex === variants.length - 1} onClick={() => setSelectedVariants((current) => ({ ...current, [groupId]: Math.min(variants.length - 1, selectedIndex + 1) }))}>›</button>
          </div>}
          <div className="message-body"><MarkdownText text={selected.text} /></div>
          <MessageArtifacts attachmentIds={selected.attachments} artifactIds={selected.artifacts} messageId={selected.id} conversationId={selected.conversationId} />
          <MessageMedia items={selected.media} />
          <div className="message-actions" aria-label="Message actions">
            <button type="button" className="message-action" aria-label="Regenerate response" title="Regenerate response" onClick={() => onRegenerate(selected.id)}><Icon name="refresh" size={15} /></button>
            <button type="button" className="message-action message-action--danger" aria-label="Delete message" title="Delete message" onClick={() => void handleDelete(selected)}><Icon name="trash" size={15} /></button>
          </div>
        </article>;
      })}

      {hasLivePanel && generation && <div ref={activityAnchorRef}><GenerationActivity key={generation.generationId} generation={generation} /></div>}

      {activeAssistant?.text.trim() && <article className="message message-assistant message-assistant--streaming" key={activeAssistant.id}>
        <header className="message-meta"><span>ELARA</span><time dateTime={new Date(activeAssistant.createdAt).toISOString()}>{new Date(activeAssistant.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></header>
        <div className="message-body"><MarkdownText text={activeAssistant.text} /></div>
      </article>}

      {hasLivePanel && <div className="conversation__activity-tail" aria-hidden="true" />}
    </div>
    {manualScroll && <button type="button" className="conversation__jump" aria-label="Jump to latest messages" onClick={jumpToLatest}>↓ Newest</button>}
  </section>;
});
