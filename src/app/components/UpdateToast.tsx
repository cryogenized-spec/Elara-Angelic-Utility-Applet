import { Icon } from '../../ui/icons';
import './update-toast.css';

export function UpdateToast({ onRefresh, onDismiss }: { onRefresh: () => void; onDismiss: () => void }) {
  return (
    <div className="update-toast" role="status" aria-live="polite" aria-label="Application update available">
      <span className="update-toast__copy">
        <Icon name="sparkles" size={15} />
        <span>New version available</span>
      </span>
      <button className="update-toast__refresh" type="button" onClick={onRefresh}>
        Refresh
      </button>
      <button className="update-toast__dismiss" type="button" aria-label="Dismiss update notice" onClick={onDismiss}>
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
