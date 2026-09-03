import { Icon } from '../../ui/icons';
import { DEFAULT_QUICK_ACTIONS } from '../quick-actions/defaults';
import type { QuickActionId } from '../quick-actions/contracts';

export type QuickTool = typeof DEFAULT_QUICK_ACTIONS[number];

export function TopToolRail({
  tools = DEFAULT_QUICK_ACTIONS,
  onAction,
  activeId = null,
}: {
  tools?: readonly QuickTool[];
  onAction: (id: QuickActionId) => void;
  activeId?: QuickActionId | null;
}) {
  return (
    <nav className="tool-rail" aria-label="Quick actions">
      <div className="tool-rail__track">
        {tools.map((tool) => (
          <button
            className={`tool-pill${activeId === tool.id ? ' is-active' : ''}`}
            type="button"
            key={tool.id}
            aria-pressed={activeId === tool.id}
            title={tool.description}
            onClick={() => onAction(tool.id)}
          >
            <Icon name={tool.icon} size={17} />
            <span>{tool.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
