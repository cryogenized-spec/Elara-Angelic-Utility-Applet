// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToggleSwitch } from './ToggleSwitch';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

function sw(): HTMLButtonElement { return container.querySelector('[role="switch"]')!; }
function key(key: string): void { act(() => { sw().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); }); }

function Harness({ initial, disabled }: { initial: boolean; disabled?: boolean }) {
  const [on, setOn] = useState(initial);
  return <ToggleSwitch checked={on} onCheckedChange={setOn} disabled={disabled} label="Roleplay mode" />;
}

describe('ToggleSwitch', () => {
  it('renders switch semantics with aria-checked reflecting the controlled value', () => {
    act(() => root.render(<ToggleSwitch checked={false} onCheckedChange={() => {}} label="Test" />));
    expect(sw().getAttribute('role')).toBe('switch');
    expect(sw().getAttribute('aria-checked')).toBe('false');
    expect(sw().getAttribute('aria-label')).toBe('Test');
    expect(sw().getAttribute('type')).toBe('button');
    act(() => root.render(<ToggleSwitch checked onCheckedChange={() => {}} label="Test" />));
    expect(sw().getAttribute('aria-checked')).toBe('true');
    expect(sw().classList.contains('is-on')).toBe(true);
  });

  it('is controlled: does not flip without the parent updating checked', () => {
    const onChange = vi.fn();
    act(() => root.render(<ToggleSwitch checked={false} onCheckedChange={onChange} label="Test" />));
    act(() => sw().click());
    expect(onChange).toHaveBeenCalledWith(true);
    expect(sw().getAttribute('aria-checked')).toBe('false');
  });

  it('off → on via click', () => {
    act(() => root.render(<Harness initial={false} />));
    act(() => sw().click());
    expect(sw().getAttribute('aria-checked')).toBe('true');
  });

  it('on → off via click', () => {
    act(() => root.render(<Harness initial />));
    act(() => sw().click());
    expect(sw().getAttribute('aria-checked')).toBe('false');
  });

  it('activates with Space and Enter exactly once per press', () => {
    const onChange = vi.fn();
    act(() => root.render(<ToggleSwitch checked={false} onCheckedChange={onChange} label="Test" />));
    key(' ');
    expect(onChange).toHaveBeenCalledTimes(1);
    key('Enter');
    expect(onChange).toHaveBeenCalledTimes(2);
    key('a');
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('keyboard toggles state end to end', () => {
    act(() => root.render(<Harness initial={false} />));
    key(' ');
    expect(sw().getAttribute('aria-checked')).toBe('true');
    key('Enter');
    expect(sw().getAttribute('aria-checked')).toBe('false');
  });

  it('does nothing when disabled', () => {
    const onChange = vi.fn();
    act(() => root.render(<ToggleSwitch checked={false} onCheckedChange={onChange} disabled label="Test" />));
    expect(sw().disabled).toBe(true);
    act(() => sw().click());
    key(' ');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('supports labelledBy/describedBy wiring', () => {
    act(() => root.render(<ToggleSwitch checked={false} onCheckedChange={() => {}} labelledBy="lbl" describedBy="hint" />));
    expect(sw().getAttribute('aria-labelledby')).toBe('lbl');
    expect(sw().getAttribute('aria-describedby')).toBe('hint');
  });
});
