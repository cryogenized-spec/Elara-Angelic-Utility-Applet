import { useEffect, useState } from 'react';
import type { ChatMessage, ConversationState, ProviderStatus } from '../domain/chat';
import { appendMessage, loadConversation, saveConversation } from '../persistence/conversation';
import { demoTurnPort } from '../chat/demo-turn-port';
import { Icon } from '../ui/icons';
import { fontFamilyForCss, type FontSelection } from '../ui/fontRegistry';
import { Sidebar } from './components/Sidebar';
import { SettingsScreen } from './components/SettingsScreen';
import { TopToolRail } from './components/TopToolRail';
import { PortraitBanner, type PortraitBackground, type PortraitScale } from './components/PortraitBanner';
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

  useEffect(() => {
    void loadConversation().then(setConversation).catch(() => setError('Could not load the local conversation.'));
  }, []);

  async function send() {
    const text = draft.trim();
    if (!text || status === 'streaming') return;

    setDraft('');
    setError(null);
    setToolNotice(null);
    setStatus('streaming');

    try {
      const userMessage = makeMessage('user', text);
      const withUser = await appendMessage(userMessage);
      setConversation(withUser);

      const assistantMessage = makeMessage('assistant', '');
      let liveText = '';
      const base = { ...withUser, messages: [...withUser.messages, assistantMessage] };
      setConversation(base);

      for await (const event of demoTurnPort.streamReply(text)) {
        if (event.type === 'text-delta') {
          liveText += event.text;
          setConversation({
            ...base,
            messages: base.messages.map((message) => message.id === assistantMessage.id ? { ...message, text: liveText } : message),
          });
        } else if (event.type === 'failed') {
          throw new Error(event.message);
        }
      }

      const completed = {
        ...base,
        messages: base.messages.map((message) => message.id === assistantMessage.id ? { ...message, text: liveText } : message),
      };
      await saveConversation(completed);
      setConversation(completed);
      setStatus('idle');
    } catch (cause) {
      setStatus('failed');
      setError(cause instanceof Error ? cause.message : 'The response failed.');
    }
  }

  function handleToolAction(id: string) {
    if (id === 'new-chat') {
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

      <section className="conversation" aria-live="polite">
        {conversation.messages.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state__kicker">ELARA / READY</span>
            <h2>What shall we work on?</h2>
            <p>Your conversation starts here. Utility actions stay outside the visible chat unless you choose to turn their results into conversation.</p>
          </div>
        ) : (
          conversation.messages.map((message) => (
            <article className={`message message-${message.role}`} key={message.id}>
              <div className="message-meta"><span>{message.role === 'assistant' ? 'Elara' : 'You'}</span><time>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>
              <div className="message-body">{message.text || '…'}</div>
            </article>
          ))
        )}
      </section>

      {error && <div className="error" role="alert">{error}</div>}

      <form className="composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
        <button className="composer__icon" type="button" aria-label="Attach image or document"><Icon name="paperclip" size={20} /></button>
        <textarea
          aria-label="Message Elara"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Message Elara…"
          rows={1}
          disabled={status === 'streaming'}
        />
        <button className="composer__icon" type="button" aria-label="Voice input"><Icon name="mic" size={20} /></button>
        <button className="composer__send" type="submit" aria-label="Send message" disabled={!draft.trim() || status === 'streaming'}>
          <Icon name="send" size={19} />
        </button>
      </form>

      <Sidebar open={sidebarOpen} activeId={conversation.id} onClose={() => setSidebarOpen(false)} onSelect={(id) => setConversation((current) => id === current.id ? current : { id, messages: [] })} onSettings={() => { setSidebarOpen(false); setSettingsOpen(true); }} />
    </main>
  );
}
