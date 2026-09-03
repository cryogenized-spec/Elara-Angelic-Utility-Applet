import { useEffect, useState } from 'react';
import type { ChatMessage, ConversationState, ProviderStatus } from '../domain/chat';
import { appendMessage, loadConversation, saveConversation } from '../persistence/conversation';
import { demoTurnPort } from '../chat/demo-turn-port';
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

  useEffect(() => {
    void loadConversation().then(setConversation).catch(() => setError('Could not load the local conversation.'));
  }, []);

  async function send() {
    const text = draft.trim();
    if (!text || status === 'streaming') return;

    setDraft('');
    setError(null);
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

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">ANGELIC UTILITY APPLET</div>
          <h1>Elara</h1>
        </div>
        <span className={`status status-${status}`}>{status}</span>
      </header>

      <section className="conversation" aria-live="polite">
        {conversation.messages.length === 0 ? (
          <div className="empty-state">
            <div className="portrait" aria-hidden="true">E</div>
            <h2>Welcome back.</h2>
            <p>The clean-room chat spine is alive. Send a message to exercise the local stream and persistence path.</p>
          </div>
        ) : (
          conversation.messages.map((message) => (
            <article className={`message message-${message.role}`} key={message.id}>
              <div className="message-label">{message.role}</div>
              <div className="message-body">{message.text || '…'}</div>
            </article>
          ))
        )}
      </section>

      {error && <div className="error" role="alert">{error}</div>}

      <form className="composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
        <textarea
          aria-label="Message Elara"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Message Elara…"
          rows={1}
          disabled={status === 'streaming'}
        />
        <button type="submit" disabled={!draft.trim() || status === 'streaming'}>
          {status === 'streaming' ? '…' : 'Send'}
        </button>
      </form>
    </main>
  );
}
