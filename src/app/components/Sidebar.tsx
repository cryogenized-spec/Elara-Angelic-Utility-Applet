import { Icon } from '../../ui/icons';

const threads = [
  { id: 'primary', title: 'Current conversation', preview: 'Continue where you left off.' },
  { id: 'weekend', title: 'Weekend trip planning', preview: 'Routes, timing, and places.' },
  { id: 'work', title: 'Work and daily planning', preview: 'Tasks, messages, and priorities.' },
];

export function Sidebar({ open, activeId, onClose, onSelect, onSettings }: {
  open: boolean;
  activeId: string;
  onClose: () => void;
  onSelect: (id: string) => void;
  onSettings: () => void;
}) {
  return (
    <>
      <button className={`sidebar-backdrop${open ? ' is-open' : ''}`} aria-label="Close sidebar" type="button" onClick={onClose} />
      <aside className={`sidebar${open ? ' is-open' : ''}`} aria-label="Chat threads">
        <div className="sidebar__head">
          <div>
            <div className="eyebrow">CONVERSATIONS</div>
            <h2>Threads</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Close sidebar" onClick={onClose}><Icon name="close" /></button>
        </div>

        <div className="thread-list">
          {threads.map((thread) => (
            <button className={`thread${activeId === thread.id ? ' is-active' : ''}`} key={thread.id} type="button" onClick={() => { onSelect(thread.id); onClose(); }}>
              <span className="thread__title">{thread.title}</span>
              <span className="thread__preview">{thread.preview}</span>
            </button>
          ))}
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
