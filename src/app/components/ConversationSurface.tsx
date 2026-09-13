import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage } from '../../domain/chat';
import type { GenerationState } from '../../chat/generation-state';
import { deleteMessage } from '../../persistence/conversation';
import { GenerationActivity } from './GenerationTrace';
import { Icon } from '../../ui/icons';
import { MarkdownText } from './MarkdownText';
import { MessageArtifacts } from './artifacts/MessageArtifacts';
import { MessageMedia } from './media/MessageMedia';
import { hasRenderableMessageContent } from './message-content';
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
  const conversationStreamRef = useRef<HTMLDivElement>(null);
  const activityAnchorRef = useRef<HTMLDivElement>(null);
  const anchoredGenerationRef = useRef<string | null>(null);
  const restoredManualGenerationRef = useRef<string | null>(null);
  const manualScrollTopRef = useRef<number | null>(null);
  const retainActivityTailRef = useRef(false);
  const followModeRef = useRef<FollowMode>('bottom');
  const layoutScrollSuppressionRef = useRef(0);
  const [manualScroll, setManualScroll] = useState(false);
  const [selectedVariants, setSelectedVariants] = useState<Record<string, number>>({});
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set());
  const seenCountsRef = useRef<Record<string, number>>({});

  const liveGeneration = generation !== null && generation.phase !== 'completed';
  const generationId = generation?.generationId;

  function atEnd(element: HTMLElement): boolean {
    return element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_STICK_THRESHOLD_PX;
  }

  function setFollowMode(mode: FollowMode): void {
    followModeRef.current = mode;
    setManualScroll(mode === 'manual');
  }

  function suppressLayoutScrollEvents(): void {
    const token = layoutScrollSuppressionRef.current + 1;
    layoutScrollSuppressionRef.current = token;
    // `scroll` is asynchronous relative to `scrollTop` writes and to the DOM
    // shrink that removes the live activity runway. Ignore those browser/layout
    // notifications for two frames so they cannot masquerade as user intent.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (layoutScrollSuppressionRef.current === token) layoutScrollSuppressionRef.current = 0;
    }));
  }

  function rememberScrollPosition() {
    const element = conversationRef.current;
    if (!element || layoutScrollSuppressionRef.current !== 0) return;

    if (followModeRef.current === 'activity') {
      const anchor = activityAnchorRef.current;
      if (anchor) {
        const offset = anchor.getBoundingClientRect().top - element.getBoundingClientRect().top;
        if (Math.abs(offset) <= ACTIVITY_ANCHOR_TOLERANCE_PX) return;
      }
      if (liveGeneration) retainActivityTailRef.current = true;
      manualScrollTopRef.current = element.scrollTop;
      setFollowMode('manual');
      return;
    }

    if (atEnd(element)) {
      manualScrollTopRef.current = null;
      setFollowMode('bottom');
    } else {
      manualScrollTopRef.current = element.scrollTop;
      setFollowMode('manual');
    }
  }

  function scrollToEnd(behavior: ScrollBehavior = 'smooth') {
    const element = conversationRef.current;
    if (!element || followModeRef.current !== 'bottom') return;
    element.scrollTo({ top: Math.max(0, element.scrollHeight - element.clientHeight), behavior });
  }

  function jumpToLatest() {
    retainActivityTailRef.current = false;
    manualScrollTopRef.current = null;
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
      if (!hasRenderableMessageContent(message)) continue;
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

  // A newly submitted turn owns one automatic viewport move. Previous manual
  // scroll state belongs to the previous turn and must not prevent the new
  // activity card from becoming the user's starting point. Once this generation
  // is anchored, no later phase or streaming update may move the viewport again.
  useLayoutEffect(() => {
    if (!generationId) return;

    if (!liveGeneration) {
      const element = conversationRef.current;
      if (
        element
        && anchoredGenerationRef.current === generationId
        && retainActivityTailRef.current
        && followModeRef.current === 'manual'
        && manualScrollTopRef.current !== null
        && restoredManualGenerationRef.current !== generationId
      ) {
        suppressLayoutScrollEvents();
        element.scrollTop = manualScrollTopRef.current;
        restoredManualGenerationRef.current = generationId;
      } else if (anchoredGenerationRef.current === generationId && !retainActivityTailRef.current) {
        // Removing the one-viewport live runway can clamp scrollTop and emit a
        // browser-generated scroll after this layout effect. Elect bottom now,
        // but suppress that settling event so it cannot immediately re-elect
        // `manual`. We intentionally do not move the viewport here: the user's
        // accepted Generation Activity position remains stable until genuinely
        // new late content asks bottom-follow to reconcile it.
        suppressLayoutScrollEvents();
        manualScrollTopRef.current = null;
        setFollowMode('bottom');
      }
      return;
    }

    if (anchoredGenerationRef.current === generationId) return;
    const element = conversationRef.current;
    const anchor = activityAnchorRef.current;
    if (!element || !anchor) return;

    const offset = anchor.getBoundingClientRect().top - element.getBoundingClientRect().top;
    anchoredGenerationRef.current = generationId;
    restoredManualGenerationRef.current = null;
    retainActivityTailRef.current = false;
    manualScrollTopRef.current = null;
    suppressLayoutScrollEvents();
    setFollowMode('activity');
    element.scrollTop = Math.max(0, element.scrollTop + offset);
  }, [generationId, liveGeneration, visibleMessages.length]);

  useEffect(() => {
    if (followModeRef.current === 'bottom') scrollToEnd();
  }, [visibleMessages.length, latestVisibleText]);

  useEffect(() => {
    const element = conversationRef.current;
    const stream = conversationStreamRef.current;
    if (!element || !stream) return undefined;

    let frame = 0;
    const reconcileViewport = () => {
      frame = 0;
      // The Generation Activity runway is exactly one real conversation
      // viewport tall. This gives the browser enough physical scroll range to
      // place a final activity card at the top without phone/desktop constants.
      element.style.setProperty('--conversation-viewport-height', `${element.clientHeight}px`);
      // Bottom-follow is an elected authority, not a geometric guess. Lazy card
      // resolution, image fallback and other late content may grow scrollHeight
      // without a React message update. Reconcile only while bottom mode owns the
      // viewport; deliberate manual/activity modes must never be yanked.
      if (followModeRef.current !== 'bottom') return;
      element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    };
    const scheduleReconcile = () => {
      if (frame) return;
      frame = requestAnimationFrame(reconcileViewport);
    };

    reconcileViewport();

    // ResizeObserver catches real box-size changes (viewport resize, image/card
    // layout). MutationObserver catches late DOM/content insertions even when the
    // stream's observed border box does not report a resize in that browser.
    const resizeObserver = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(scheduleReconcile);
    resizeObserver?.observe(element);
    resizeObserver?.observe(stream);

    const mutationObserver = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(scheduleReconcile);
    mutationObserver?.observe(stream, { childList: true, subtree: true, characterData: true });

    return () => {
      if (frame) cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, []);

  async function handleDelete(message: ChatMessage) {
    try {
      await deleteMessage(message.id, message.conversationId ?? 'primary');
      setDeletedIds((current) => new Set(current).add(message.id));
    } catch {
      // The message may already have disappeared locally; keep the chat surface stable.
    }
  }

  const hasLivePanel = liveGeneration;
  const showActivityTail = hasLivePanel || (manualScroll && retainActivityTailRef.current);
  if (visibleMessages.length === 0 && !hasLivePanel) {
    return <section className="conversation" aria-label="Conversation"><div className="empty-state"><span className="empty-state__kicker">ELARA / READY</span><h2>What shall we work on?</h2><p>Your conversation starts here. Elara's presence stays central while utility surfaces remain out of the visible chat.</p></div></section>;
  }

  return <section ref={conversationRef} className="conversation" aria-label="Conversation" onScroll={rememberScrollPosition}>
    <div ref={conversationStreamRef} className="conversation__stream">
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
          {selected.text.trim() && <div className="message-body"><MarkdownText text={selected.text} /></div>}
          <MessageArtifacts attachmentIds={selected.attachments} artifactIds={selected.artifacts} messageId={selected.id} conversationId={selected.conversationId} />
          <MessageMedia items={selected.media} />
          <div className="message-actions" aria-label="Message actions">
            <button type="button" className="message-action" aria-label="Regenerate response" title="Regenerate response" onClick={() => onRegenerate(selected.id)}><Icon name="refresh" size={15} /></button>
            <button type="button" className="message-action message-action--danger" aria-label="Delete message" title="Delete message" onClick={() => void handleDelete(selected)}><Icon name="trash" size={15} /></button>
          </div>
        </article>;
      })}

      {hasLivePanel && generation && <div ref={activityAnchorRef}><GenerationActivity key={generation.generationId} generation={generation} /></div>}

      {activeAssistant && hasRenderableMessageContent(activeAssistant) && <article className="message message-assistant message-assistant--streaming" key={activeAssistant.id}>
        <header className="message-meta"><span>ELARA</span><time dateTime={new Date(activeAssistant.createdAt).toISOString()}>{new Date(activeAssistant.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></header>
        {activeAssistant.text.trim() && <div className="message-body"><MarkdownText text={activeAssistant.text} /></div>}
        <MessageArtifacts attachmentIds={activeAssistant.attachments} artifactIds={activeAssistant.artifacts} messageId={activeAssistant.id} conversationId={activeAssistant.conversationId} />
        <MessageMedia items={activeAssistant.media} />
      </article>}

      {showActivityTail && <div className="conversation__activity-tail" aria-hidden="true" />}
    </div>
    {manualScroll && <button type="button" className="conversation__jump" aria-label="Jump to latest messages" onClick={jumpToLatest}>↓ Newest</button>}
  </section>;
});