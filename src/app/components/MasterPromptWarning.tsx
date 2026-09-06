import { useEffect, useState } from 'react';
import { loadCharacterProfile } from '../../persistence/character';
import './master-prompt-warning.css';

export function MasterPromptWarning() {
  const [isEmpty, setIsEmpty] = useState(false);

  useEffect(() => {
    let active = true;
    let refreshTimer: number | null = null;

    const refresh = () => {
      void loadCharacterProfile().then((profile) => {
        if (active) setIsEmpty(profile.systemInstruction.trim().length === 0);
      }).catch(() => {
        if (active) setIsEmpty(false);
      });
    };

    refresh();
    refreshTimer = window.setInterval(refresh, 1500);
    return () => {
      active = false;
      if (refreshTimer !== null) window.clearInterval(refreshTimer);
    };
  }, []);

  if (!isEmpty) return null;

  return (
    <div className="master-prompt-warning" role="status" aria-live="polite">
      <span className="master-prompt-warning__dash" aria-hidden="true" />
      <span>Master Prompt is currently empty. You can add one in Settings → Character.</span>
    </div>
  );
}
