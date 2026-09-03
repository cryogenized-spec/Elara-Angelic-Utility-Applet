import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, ConversationState, ProviderStatus } from '../domain/chat';
import { appendMessage, loadConversation, saveConversation } from '../persistence/conversation';
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
import '../ui/fonts.css';
import './app.css';

const makeMessage = (role: ChatMessage['role'], text: string): ChatMessage => ({
  id: `${role}-${crypto.randomUUID()}`,
  role,
  text,
  createdAt: Date.now(),
});

export function App() {
  const [conversation, setConversation] = useState<ConversationState>({ id: 'primary', messages: [] });
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<ProviderStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toolNotice, setToolNotice] = useState<string | null>(null);
  const [font, setFont] = useState<FontSelection>({ kind: 'built-in', family: 'Inter' });
  const [fontSize, setFontSize] = useState(15);
  const [portraitScale, setPortraitScale] = useState<PortraitScale>(2);
  const [portraitBackground, setPortraitBackground] = useState<PortraitBackground>('midnight');
  const abortControllerRef = useRef<AbortController | null>(null);

  useVisualViewport();

  useEffect(() => {
    void loadConversation().then(setConversation).catch(() => setError('Could not load the local conversation.'));
  }, []);

  useEffect(() => () => abortControllerRef.current?.abort(), []);

  async function send() {
    const text = draft.trim();
    if (!text || status === 'streaming') return;

    setDraft('');
    setError(null);
    setToolNotice(null);
    setStatus('streaming');

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const userMessage = makeMessage('user', text);
      const withUser = await appendMessage(userMessage);
      if (controller.signal.aborted) return;
      setConversation(withUser);

      const assistantMessage = makeMessage('assistant', '');
      let liveText = '';
      const base = { ...withUser, messages: [...withUser.messages, assistantMessage] };
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
            messages: base.messages.map((message) => message.id === assistantMessage.id
              ? { ...message, text: liveText, executionSummary: { id: crypto.randomUUID(), steps: event.executionSteps, durationMs: event.durationMs } }
              : message),
          };
          await saveConversation(completed);
          setConversation(completed);
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

  function handleToolAction(id: string) {
    if (id === 'new-chat') {
      cancel();
      setConversation({ id: crypto.randomUUID(), messages: [] });
      setToolNotice(null);
      return;
    }

    const labels: Record<string, string> = { calendar: 'Calendar action surface', tasks: 'Tasks action surface', gmail: 'Gmail action surface' };
    setToolNotice(`${labels[id] ?? 'Quick action'} ready — no prompt was added to chat.`);
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
      <TopToolRail onAction={handleToolAction} />
      {toolNotice && <div className="tool-notice" role="status">{toolNotice}</div>}

      <ConversationSurface messages={conversation.messages} fontSize={fontSize} />
      {error && <div className="error" role="alert">{error}</div>}

      <Composer draft={draft} status={status} onDraftChange={setDraft} onSend={() => void send()} onCancel={cancel} />

      <Sidebar open={sidebarOpen} activeId={conversation.id} onClose={() => setSidebarOpen(false)} onSelect={(id) => {
        cancel();
        setConversation((current) => id === current.id ? current : { id, messages: [] });
      }} onSettings={() => { setSidebarOpen(false); setSettingsOpen(true); }} />
    </main>
  );
}
