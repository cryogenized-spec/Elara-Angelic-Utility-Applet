import { hasMasterCharacterInstruction } from '../../character/system-instruction';
import './master-prompt-warning.css';

export function MasterPromptWarning({ systemInstruction }: { systemInstruction: string }) {
  if (hasMasterCharacterInstruction(systemInstruction)) return null;

  return (
    <div className="master-prompt-warning" aria-live="polite">
      <span className="master-prompt-warning__dash" aria-hidden="true" />
      <span>Master Prompt is currently empty. You can add one in Settings → Character.</span>
    </div>
  );
}
