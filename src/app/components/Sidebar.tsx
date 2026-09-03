import { useEffect, useMemo, useState } from 'react';
import type { ConversationThread } from '../../domain/chat';
import { Icon } from '../../ui/icons';

function formatThreadTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function Sidebar({ open, threads, activeId, onClose, onSelect, onNewChat, onRename, onArchive, onDelete, onSettings }: {
  open: boolean;
  threads: ConversationThread[];
  activeId: string;
  onClose: () => void;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onRename: (id: string, title: string) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  onSettings: () => void;
}) {
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  useEffect(() => {
    if (!open) {
      setQuery('');
      setEditingId(null);
    }
  }, [open]);

  const visibleThreads = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return threads;
    return threads.filter((thread) => thread.title.toLocaleLowerCase().includes(normalized));
  }, [query, threads]);

  function beginRename(thread: ConversationThread) {
    setEditingId(thread.id);
    setEditingTitle(thread.title);
  }

  function commitRename() {
    if (!editingId) return;
    const cleaned = editingTitle.trim();
    if (cleaned) onRename(editingId, cleaned);
    setEditingId(null);
    setEditingTitle('');
  }

  return (
    <>
      <button className={`sidebar-backdrop${open ? ' is-open' : ''}`} aria-label="Close sidebar" type="button" onClick={onClose} />
      <aside className={`sidebar${open ? ' is-open' : ''}`} aria-label="Chat threads" aria-hidden={!open}>
        <div className="sidebar__head">
          <div>
            <div className="eyebrow">CONVERSATIONS</div>
            <h2>Threads</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Close sidebar" onClick={onClose}><Icon name="close" /></button>
        </div>

        <button className="sidebar-new-chat" type="button" onClick={onNewChat}>
          <Icon name="plus" size={18} />
          <span>New chat</span>
        </button>

        <label className="sidebar-search">
          <Icon name="search" size={17} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search chats" aria-label="Search chats" />
        </label>

        <div className="thread-list" aria-label="Conversation threads">
          {visibleThreads.map((thread) => (
            <div className={`thread-row${activeId === thread.id ? ' is-active' : ''}`} key={thread.id}>
              {editingId === thread.id ? (
                <input
                  className="thread-rename-input"
                  value={editingTitle}
                  maxLength={80}
                  autoFocus
                  aria-label="Thread name"
                  onChange={(event) => setEditingTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commitRename();
                    if (event.key === 'Escape') { setEditingId(null); setEditingTitle(''); }
                  }}
                  onBlur={commitRename}
                />
              ) : (
                <button className="thread" type="button" onClick={() => { onSelect(thread.id); onClose(); }}>
                  <span className="thread__title">{thread.title}</span>
                  <span className="thread__meta">{formatThreadTime(thread.updatedAt)}</span>
                </button>
              )}
              {editingId !== thread.id && (
                <details className="thread-menu">
                  <summary aria-label={`Thread actions for ${thread.title}`}><Icon name="dots" size={17} /></summary>
                  <div className="thread-menu__panel">
                    <button type="button" onClick={() => beginRename(thread)}>Rename</button>
                    {thread.id !== 'primary' && <button type="button" onClick={() => onArchive(thread.id)}>Archive</button>}
                    {thread.id !== 'primary' && <button type="button" onClick={() => onDelete(thread.id)}>Delete</button>}
                  </div>
                </details>
              )}
            </div>
          ))}
          {visibleThreads.length === 0 && <p className="sidebar-empty">No conversations match “{query}”.</p>}
        </div>

        <div className="sidebar__footer">
          <button className="sidebar-action" type="button" onClick={onSettings}>
            <Icon name="settings" size={19} /><span>Settings</span>
          </button>
        </div>
      </aside>
    </>
  );
}
