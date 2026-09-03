import type { ChatMessage } from '../../domain/chat';
import { ExecutionSummary } from './ExecutionSummary';
import './conversation-surface.css';

export function ConversationSurface({ messages, fontSize }: { messages: ChatMessage[]; fontSize: number }) {
  if (messages.length === 0) {
    return (
      <section className="conversation" aria-label="Conversation">
        <div className="empty-state">
          <span className="empty-state__kicker">ELARA / READY</span>
          <h2>What shall we work on?</h2>
          <p style={{ fontSize: `${fontSize}px` }}>Your conversation starts here. Elara's presence stays central while utility surfaces remain out of the visible chat.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="conversation" aria-label="Conversation" aria-live="polite">
      <div className="conversation__stream">
        {messages.map((message) => (
          <article className={`message message-${message.role}`} key={message.id}>
            <header className="message-meta">
              <span>{message.role === 'assistant' ? 'ELARA' : 'YOU'}</span>
              <time dateTime={new Date(message.createdAt).toISOString()}>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
            </header>
            {message.role === 'assistant' && message.executionSummary && <ExecutionSummary summary={message.executionSummary} />}
            <div className="message-body" style={{ fontSize: `${fontSize}px` }}>{message.text || '…'}</div>
          </article>
        ))}
      </div>
    </section>
  );
}
