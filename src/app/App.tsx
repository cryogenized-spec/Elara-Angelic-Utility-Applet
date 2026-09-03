import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, ConversationState, ConversationThread, ProviderStatus } from '../domain/chat';
import {
  appendMessage,
  archiveThread,
  createThread,
  deleteThread,
  loadConversation,
  loadThreads,
  renameThread,
  saveConversation,
} from '../persistence/conversation';
import { demoThreadTitlePort } from '../chat/thread-title-port';
import { demoTurnPort } from '../chat/demo-turn-port';
import { Icon } from '../ui/icons';
import { fontFamilyForCss, type FontSelection } from '../ui/fontRegistry';
import { useVisualViewport } from '../ui/useVisualViewport';
import { Sidebar } from './components/Sidebar';
import { SettingsScreen } from './components/SettingsScreen';
import { TopToolRail } from './components/TopToolRail';
import { PortraitBanner, type PortraitBackground, type PortraitScale } from './components/PortraitBanner';
import { ConversationSurface } from './components/ConversationSurface';
import { Composer } from './components/Composer';
import { QuickActionSurface } from './components/QuickActionSurface';
import { DEFAULT_QUICK_ACTIONS, demoQuickActionPort } from './quick-actions/defaults';
import type { QuickActionId, QuickActionSurface as QuickActionSurfaceModel } from './quick-actions/contracts';
import '../ui/fonts.css';
import './app.css';
import './mobile-viewport.css';
import './quick-action-rail.css';

const ACTIVE_THREAD_KEY = 'elara.active-thread';
const DEFAULT_TITLE = 'New conversation';

const makeMessage = (role: ChatMessage['role'], text: string, conversationId: string): ChatMessage => ({
  id: `${role}-${crypto.randomUUID()}`,
  role,
  text,
  conversationId,
  createdAt: Date.now(),
});

export function App() {
  const [conversation, setConversation] = useState<ConversationState>({ id: 'primary', title: DEFAULT_TITLE, createdAt: Date.now(), updatedAt: Date.now(), messages: [] });
  const [threads, setThreads] = useState<ConversationThread[]>([]);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<ProviderStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [quickActionSurface, setQuickActionSurface] = useState<QuickActionSurfaceModel | null>(null);
  const [font, setFont] = useState<FontSelection>({ kind: 'built-in', family: 'Inter' });
  const [fontSize, setFontSize] = useState(15);
  const [portraitScale, setPortraitScale] = useState<PortraitScale>(2);
  const [portraitBackground, setPortraitBackground] = useState<PortraitBackground>('midnight');
  const abortControllerRef = useRef<AbortController | null>(null);

  useVisualViewport();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loadedThreads = await loadThreads();
        const storedActive = window.localStorage.getItem(ACTIVE_THREAD_KEY);
        const activeId = storedActive && loadedThreads.some((thread) => thread.id === storedActive) ? storedActive : (loadedThreads[0]?.id ?? 'primary');
        const loadedConversation = await loadConversation(activeId);
        if (cancelled) return;
        setThreads(loadedThreads);
        setConversation(loadedConversation);
        window.localStorage.setItem(ACTIVE_THREAD_KEY, activeId);
      } catch {
        if (!cancelled) setError('Could not load the local conversation history.');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => () => abortControllerRef.current?.abort(), []);

  async function refreshThreads() {
    setThreads(await loadThreads());
  }

  async function switchThread(id: string) {
    cancel();
    setQuickActionSurface(null);
    setError(null);
    setDraft('');
    try {
      const nextConversation = await loadConversation(id);
      setConversation(nextConversation);
      window.localStorage.setItem(ACTIVE_THREAD_KEY, id);
      await refreshThreads();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not open that conversation.');
    }
  }

  async function startNewChat() {
    cancel();
    setQuickActionSurface(null);
    setError(null);
    setDraft('');
    try {
      const nextConversation = await createThread();
      setConversation(nextConversation);
      window.localStorage.setItem(ACTIVE_THREAD_KEY, nextConversation.id);
      await refreshThreads();
      setSidebarOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create a new conversation.');
    }
  }

  async function send() {
    const text = draft.trim();
    if (!text || status === 'streaming') return;

    setDraft('');
    setQuickActionSurface(null);
    setError(null);
    setStatus('streaming');

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const conversationId = conversation.id;

    try {
      const userMessage = makeMessage('user', text, conversationId);
      const withUser = await appendMessage(userMessage, conversationId);
      if (controller.signal.aborted) return;
      let titled = withUser;

      if (withUser.title === DEFAULT_TITLE) {
        try {
          const generatedTitle = await demoThreadTitlePort.generateTitle(text);
          titled = { ...withUser, title: generatedTitle, updatedAt: Date.now() };
          await saveConversation(titled);
        } catch {
          // A title is metadata; failure must not block the chat turn.
        }
      }

      setConversation(titled);
      await refreshThreads();

      const assistantMessage = makeMessage('assistant', '', conversationId);
      let liveText = '';
      const base = { ...titled, messages: [...titled.messages, assistantMessage], updatedAt: Date.now() };
      setConversation(base);

      for await (const event of demoTurnPort.streamReply(text, controller.signal)) {
        if (event.type === 'text-delta') {
          liveText += event.text;
          setConversation({
            ...base,
            messages: base.messages.map((message) => message.id === assistantMessage.id ? { ...message, text: liveText } : message),
          });
        } else if (event.type === 'completed') {
          const completed = {
            ...base,
            updatedAt: Date.now(),
            messages: base.messages.map((message) => message.id === assistantMessage.id
              ? { ...message, text: liveText, executionSummary: { id: crypto.randomUUID(), steps: event.executionSteps, durationMs: event.durationMs } }
              : message),
          };
          await saveConversation(completed);
          setConversation(completed);
          await refreshThreads();
        } else if (event.type === 'failed') {
          throw new Error(event.message);
        }
      }

      if (!controller.signal.aborted) setStatus('idle');
    } catch (cause) {
      if (controller.signal.aborted || (cause instanceof DOMException && cause.name === 'AbortError')) {
        setStatus('idle');
        return;
      }
      setStatus('failed');
      setError(cause instanceof Error ? cause.message : 'The response failed.');
    } finally {
      if (abortControllerRef.current === controller) abortControllerRef.current = null;
    }
  }

  function cancel() {
    abortControllerRef.current?.abort();
    setStatus('idle');
    setError(null);
  }

  async function handleRename(id: string, title: string) {
    try {
      await renameThread(id, title);
      await refreshThreads();
      if (id === conversation.id) setConversation((current) => ({ ...current, title }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not rename that conversation.');
    }
  }

  async function handleArchive(id: string) {
    try {
      await archiveThread(id);
      await refreshThreads();
      if (id === conversation.id) await startNewChat();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not archive that conversation.');
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this conversation? This removes its local messages.')) return;
    try {
      await deleteThread(id);
      await refreshThreads();
      if (id === conversation.id) await startNewChat();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete that conversation.');
    }
  }

  async function handleQuickAction(id: QuickActionId) {
    setError(null);
    try {
      const surface = await demoQuickActionPort.execute(id);
      setQuickActionSurface(surface);
    } catch (cause) {
      setQuickActionSurface(null);
      setError(cause instanceof Error ? cause.message : 'The quick action could not be opened.');
    }
  }

  if (settingsOpen) {
    return (
      <SettingsScreen
        font={font}
        onFontChange={setFont}
        fontSize={fontSize}
        onFontSizeChange={setFontSize}
        portraitScale={portraitScale}
        onPortraitScaleChange={setPortraitScale}
        portraitBackground={portraitBackground}
        onPortraitBackgroundChange={setPortraitBackground}
        onBack={() => setSettingsOpen(false)}
      />
    );
  }

  return (
    <main className="app-shell" style={{ fontFamily: fontFamilyForCss(font), '--body-font-size': `${fontSize}px` } as React.CSSProperties}>
      <div className="left-spine" aria-label="Application controls">
        <button className="glass-menu-button" type="button" aria-label="Open sidebar" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(true)}>
          <Icon name="menu" size={21} />
        </button>
        <button className="glass-menu-button left-spine__settings" type="button" aria-label="Open settings" onClick={() => setSettingsOpen(true)}>
          <Icon name="settings" size={20} />
        </button>
      </div>

      <PortraitBanner collapsed={sidebarOpen} scale={portraitScale} background={portraitBackground} />
      <TopToolRail tools={DEFAULT_QUICK_ACTIONS} activeId={quickActionSurface?.id ?? null} onAction={(id) => void handleQuickAction(id)} />
      {quickActionSurface && <QuickActionSurface surface={quickActionSurface} onClose={() => setQuickActionSurface(null)} />}

      <ConversationSurface messages={conversation.messages} fontSize={fontSize} />
      {error && <div className="error" role="alert">{error}</div>}

      <Composer draft={draft} status={status} onDraftChange={setDraft} onSend={() => void send()} onCancel={cancel} />

      <Sidebar
        open={sidebarOpen}
        threads={threads}
        activeId={conversation.id}
        onClose={() => setSidebarOpen(false)}
        onSelect={(id) => void switchThread(id)}
        onNewChat={() => void startNewChat()}
        onRename={(id, title) => void handleRename(id, title)}
        onArchive={(id) => void handleArchive(id)}
        onDelete={(id) => void handleDelete(id)}
        onSettings={() => { setSidebarOpen(false); setSettingsOpen(true); }}
      />
    </main>
  );
}
