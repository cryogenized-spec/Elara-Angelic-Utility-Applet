// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_MEMORY_BEHAVIOR,
  SENSITIVE_MEMORY_CATEGORY_KEYS,
} from '../../domain/preferences';
import {
  loadMemoryBehaviorPreferences,
  saveMemoryBehaviorPreferences,
} from '../../persistence/preferences';
import { MemoryContinuitySettings } from './MemoryContinuitySettings';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function waitForReady(): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (container.textContent?.includes('Changes save automatically.')) return;
    await settle();
  }
  throw new Error('Memory continuity settings did not become ready.');
}

async function waitForSaved(): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (container.textContent?.includes('Changes save automatically.')) {
      await settle();
      return;
    }
    await settle();
  }
  throw new Error('Memory continuity settings did not finish saving.');
}

function switchByLabel(label: string): HTMLButtonElement {
  const buttons = [...container.querySelectorAll<HTMLButtonElement>('[role="switch"]')];
  const match = buttons.find((button) => {
    if (button.getAttribute('aria-label') === label) return true;
    const labelledBy = button.getAttribute('aria-labelledby');
    return labelledBy ? container.querySelector(`#${labelledBy}`)?.textContent === label : false;
  });
  if (!match) throw new Error(`Switch not found: ${label}`);
  return match;
}

function radio(label: string): HTMLButtonElement {
  const buttons = [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
  const match = buttons.find((button) => button.querySelector('strong')?.textContent === label);
  if (!match) throw new Error(`Radio option not found: ${label}`);
  return match;
}

beforeEach(async () => {
  await saveMemoryBehaviorPreferences(DEFAULT_MEMORY_BEHAVIOR);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<MemoryContinuitySettings />);
    await Promise.resolve();
  });
  await waitForReady();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('MemoryContinuitySettings', () => {
  it('shows the companion defaults while keeping sensitive automatic memory off', () => {
    expect(switchByLabel('Use memory in conversation').getAttribute('aria-checked')).toBe('true');
    expect(radio('Natural').getAttribute('aria-checked')).toBe('true');
    expect(container.textContent).toContain('Feelings, vulnerabilities & reflections');
    expect(container.textContent).toContain('Sensitive things');

    const sensitiveLabels = [
      'Health & wellbeing',
      'Money & finances',
      'Intimacy & sexuality',
      'Religion & spirituality',
      'Politics & civic views',
      'Race & ethnicity',
      'Legal & criminal history',
      'Exact home & location details',
    ];

    expect(sensitiveLabels).toHaveLength(SENSITIVE_MEMORY_CATEGORY_KEYS.length);
    for (const label of sensitiveLabels) {
      expect(switchByLabel(label).getAttribute('aria-checked')).toBe('false');
    }
  });

  it('persists remembering and recall temperament through the existing preference authority', async () => {
    await act(async () => { radio('Attentive').click(); });
    await waitForSaved();

    const recallGroup = [...container.querySelectorAll<HTMLElement>('[role="radiogroup"]')]
      .find((group) => group.getAttribute('aria-label') === 'How Elara uses memories');
    const makeConnections = [...(recallGroup?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? [])]
      .find((button) => button.querySelector('strong')?.textContent === 'Make connections');
    if (!makeConnections) throw new Error('Make connections option not found.');

    await act(async () => { makeConnections.click(); });
    await waitForSaved();

    const stored = await loadMemoryBehaviorPreferences();
    expect(stored.rememberingStyle).toBe('attentive');
    expect(stored.recallStyle).toBe('proactive');
  });

  it('serializes rapid changes so the newest choice wins', async () => {
    act(() => { radio('Selective').click(); });
    act(() => { radio('Attentive').click(); });
    act(() => { switchByLabel('Health & wellbeing').click(); });
    act(() => { switchByLabel('Health & wellbeing').click(); });
    await waitForSaved();

    const stored = await loadMemoryBehaviorPreferences();
    expect(stored.rememberingStyle).toBe('attentive');
    expect(stored.categories.health_wellbeing).toBe(false);
    expect(radio('Attentive').getAttribute('aria-checked')).toBe('true');
    expect(switchByLabel('Health & wellbeing').getAttribute('aria-checked')).toBe('false');
  });

  it('preserves a newer choice from another tab when changing an unrelated setting', async () => {
    await saveMemoryBehaviorPreferences({
      ...DEFAULT_MEMORY_BEHAVIOR,
      categories: { ...DEFAULT_MEMORY_BEHAVIOR.categories, health_wellbeing: true },
    });

    act(() => { radio('Attentive').click(); });
    await waitForSaved();

    const stored = await loadMemoryBehaviorPreferences();
    expect(stored.rememberingStyle).toBe('attentive');
    expect(stored.categories.health_wellbeing).toBe(true);
    expect(switchByLabel('Health & wellbeing').getAttribute('aria-checked')).toBe('true');
  });

  it('preserves detailed choices while the master switch is off', async () => {
    await act(async () => { switchByLabel('Health & wellbeing').click(); });
    await waitForSaved();
    await act(async () => { radio('Attentive').click(); });
    await waitForSaved();
    await act(async () => { switchByLabel('Use memory in conversation').click(); });
    await waitForSaved();

    const stored = await loadMemoryBehaviorPreferences();
    expect(stored.enabled).toBe(false);
    expect(stored.rememberingStyle).toBe('attentive');
    expect(stored.categories.health_wellbeing).toBe(true);
    expect(container.textContent).toContain('Existing memories stay in the Memory Bank');
  });
});
