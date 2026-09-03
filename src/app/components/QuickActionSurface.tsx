import { Icon } from '../../ui/icons';
import type { QuickActionSurface as QuickActionSurfaceModel } from '../quick-actions/contracts';

const capabilityLabels: Record<QuickActionSurfaceModel['capability'], string> = {
  'calendar.events.read': 'calendar.events.read',
  'tasks.read': 'tasks.read',
  'gmail.read': 'gmail.read',
};

export function QuickActionSurface({ surface, onClose }: {
  surface: QuickActionSurfaceModel;
  onClose: () => void;
}) {
  return (
    <section className="quick-action-surface" aria-label={`${surface.title} action surface`}>
      <div className="quick-action-surface__icon" aria-hidden="true">
        <Icon name={surface.id === 'calendar' ? 'calendar' : surface.id === 'tasks' ? 'tasks' : 'mail'} size={19} />
      </div>
      <div className="quick-action-surface__body">
        <div className="quick-action-surface__eyebrow">WORKSPACE ACTION</div>
        <h2>{surface.title}</h2>
        <p>{surface.detail}</p>
        <span className="quick-action-surface__capability">Capability · {capabilityLabels[surface.capability]}</span>
      </div>
      <button className="quick-action-surface__close" type="button" aria-label={`Close ${surface.title} action surface`} onClick={onClose}>
        <Icon name="close" size={17} />
      </button>
    </section>
  );
}
