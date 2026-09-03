import { Icon, type IconName } from '../../ui/icons';

export type QuickTool = { id: string; label: string; icon: IconName };

const defaultTools: QuickTool[] = [
  { id: 'calendar', label: 'Calendar', icon: 'calendar' },
  { id: 'tasks', label: 'Tasks', icon: 'tasks' },
  { id: 'gmail', label: 'Gmail', icon: 'mail' },
  { id: 'new-chat', label: 'New chat', icon: 'plus' },
];

export function TopToolRail({ onAction }: { onAction: (id: string) => void }) {
  return (
    <nav className="tool-rail" aria-label="Quick actions">
      <div className="tool-rail__track">
        {defaultTools.map((tool) => (
          <button className="tool-pill" type="button" key={tool.id} onClick={() => onAction(tool.id)}>
            <Icon name={tool.icon} size={17} />
            <span>{tool.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
