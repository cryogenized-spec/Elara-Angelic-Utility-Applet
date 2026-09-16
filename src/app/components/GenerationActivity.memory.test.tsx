// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GenerationActivityRecord } from '../../domain/chat';
import { GenerationActivity } from './GenerationTrace';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

function renderExpanded(record: GenerationActivityRecord): void {
  act(() => { root.render(<GenerationActivity record={record} />); });
  const button = container.querySelector<HTMLButtonElement>('.generation-activity__header');
  if (!button) throw new Error('expected Generation Activity header');
  act(() => { button.click(); });
}

describe('Generation Activity memory presentation', () => {
  it('uses the dedicated Lucide memory icon for deliberate memory tools and organic capture', () => {
    renderExpanded({
      id: 'memory-activity-turn',
      durationMs: 1250,
      steps: [
        {
          id: 'memory-tool',
          kind: 'tool',
          state: 'done',
          durationMs: 200,
          label: 'memory.save',
          toolName: 'memory.save',
        },
        {
          id: 'memory-organic',
          kind: 'context',
          state: 'done',
          durationMs: 90,
          label: 'Saved to memory',
          detail: 'Recorded 1 durable observation.',
          contextCategory: 'memory',
        },
      ],
    });

    expect(container.textContent).toContain('Memory · Save');
    expect(container.textContent).toContain('Saved to memory');
    expect(container.textContent).toContain('Recorded 1 durable observation.');
    expect(container.querySelectorAll('svg.lucide-brain')).toHaveLength(2);
  });

  it('uses the same dedicated icon for recalled durable context without relabeling it as a tool', () => {
    renderExpanded({
      id: 'memory-recall-turn',
      durationMs: 700,
      steps: [
        {
          id: 'memory-recall',
          kind: 'context',
          state: 'done',
          durationMs: 40,
          label: 'Memory',
          detail: 'Recalled relevant durable memory.',
          contextCategory: 'memory',
        },
      ],
    });

    expect(container.textContent).toContain('Memory');
    expect(container.textContent).toContain('Recalled relevant durable memory.');
    expect(container.textContent).not.toContain('Tool invocations');
    expect(container.querySelectorAll('svg.lucide-brain')).toHaveLength(1);
  });
});
