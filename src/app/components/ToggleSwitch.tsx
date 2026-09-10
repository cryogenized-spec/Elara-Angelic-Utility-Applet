import type { KeyboardEvent } from 'react';
import './toggle-switch.css';

export interface ToggleSwitchProps {
  /** Controlled state; the parent owns the value. */
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Accessible name. Provide either `label` or `labelledBy`. */
  label?: string;
  labelledBy?: string;
  describedBy?: string;
  id?: string;
  className?: string;
}

/**
 * Reusable controlled switch with native button semantics: role="switch",
 * aria-checked, Space/Enter activation, visible focus ring, 48×30 hit area.
 * Visual language matches the previous Roleplay Settings switch.
 */
export function ToggleSwitch({ checked, onCheckedChange, disabled = false, label, labelledBy, describedBy, id, className }: ToggleSwitchProps) {
  function toggle(): void {
    if (disabled) return;
    onCheckedChange(!checked);
  }

  // Enter and Space toggle on keydown. preventDefault stops the browser from
  // also synthesising a click for the same key press (which would toggle
  // twice) and stops Space from scrolling the page.
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return;
    event.preventDefault();
    toggle();
  }

  return (
    <button
      id={id}
      type="button"
      role="switch"
      className={`toggle-switch${checked ? ' is-on' : ''}${className ? ` ${className}` : ''}`}
      aria-checked={checked}
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={toggle}
      onKeyDown={handleKeyDown}
    >
      <span className="toggle-switch__track" aria-hidden="true"><span className="toggle-switch__thumb" /></span>
    </button>
  );
}
