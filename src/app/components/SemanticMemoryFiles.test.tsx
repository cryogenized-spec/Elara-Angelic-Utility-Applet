// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../persistence/conversation';
import { saveMemory } from '../../memory/store';
import { getSemanticFile, listSemanticFiles, writeSemanticFile, type SemanticMemoryFile } from '../../memory/semantic-file';
import { SemanticMemoryFiles } from './SemanticMemoryFiles';

vi.mock('../../gemini/semantic-synthesis', () => ({
  geminiSemanticSynthesisExtractor: vi.fn(() => async () => SYNTHESIS_OUTPUT),
}));

const SYNTHESIS_OUTPUT = {
  summary: 'Zuhayr owns the project and prefers the compact kanban layout.',
  recentObservations: ['Zuhayr is the owner of the project.'],
  openConflicts: [],
  aliases: ['Z'],
};

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function waitForText(text: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (container.textContent?.includes(text)) return;
    await settle();
  }
  throw new Error(`Expected UI text "${text}" was not rendered.`);
}

function changeTextArea(textarea: HTMLTextAreaElement, value: string): void {
  act(() => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    if (!descriptor?.set) throw new Error('HTMLTextAreaElement value setter unavailable');
    descriptor.set.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function buttonByText(text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find((element) => element.textContent?.trim() === text);
  if (!button) throw new Error(`Button "${text}" not found.`);
  return button;
}

function cardSummaryButton(titleText: string): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>('button.semantic-files__card-summary')]
    .find((element) => element.textContent?.includes(titleText));
  if (!button) throw new Error(`Card "${titleText}" not found.`);
  return button;
}

function fileTemplate(overrides: Partial<SemanticMemoryFile> = {}): SemanticMemoryFile {
  return {
    id: `semantic_ui_${Math.random().toString(36).slice(2, 10)}`,
    kind: 'person',
    title: 'Zuhayr',
    aliases: ['Z'],
    summary: 'The owner of the project.',
    recentObservations: ['Zuhayr is the owner of the project.'],
    openConflicts: [],
    sourceMemoryIds: [],
    updatedAt: Date.now() - 86_400_000,
    generatedAt: Date.now() - 86_400_000,
    version: 1,
    ...overrides,
  };
}

describe('SemanticMemoryFiles (memory topics surface)', () => {
  beforeEach(async () => {
    await db.transaction('rw', db.memories, db.semanticMemories, async () => {
      await db.memories.clear();
      await db.semanticMemories.clear();
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
    vi.restoreAllMocks();
  });

  it('shows the empty state until summary files exist', async () => {
    act(() => { root.render(<SemanticMemoryFiles />); });
    await waitForText('No summaries yet.');
    expect(container.textContent).toContain('Memory topics');
    expect(container.textContent).toContain('a map, not a second memory store');
  });

  it('groups summary files by concept and exposes provenance at a glance', async () => {
    const source = await saveMemory({ title: 'Project owner', body: 'Zuhayr is the owner of the project.' });
    await writeSemanticFile(fileTemplate({ sourceMemoryIds: [source.id], updatedAt: source.updatedAt }), 0);
    await writeSemanticFile(fileTemplate({ id: 'semantic_ui_project', kind: 'project', title: 'Elara app', summary: 'The companion app.', sourceMemoryIds: [source.id], updatedAt: source.updatedAt }), 0);

    act(() => { root.render(<SemanticMemoryFiles />); });
    await waitForText('Zuhayr');
    expect(container.textContent).toContain('People');
    expect(container.textContent).toContain('Projects');
    expect(container.textContent).toContain('Elara app');
    expect(container.textContent).toContain('The owner of the project.');
    expect(container.textContent).toContain('also Z');
    expect(container.textContent).toContain('Built from 1 memory');

    await act(async () => { cardSummaryButton('Zuhayr').click(); });
    expect(container.textContent).toContain('Underlying memories');
    expect(container.textContent).toContain('Project owner');
    expect(container.textContent).toContain('Recent details');
    expect(container.textContent).toContain('Memory Bank below');
  });

  it('flags stale and conflicting summaries in plain language', async () => {
    const source = await saveMemory({ title: 'Project owner', body: 'Zuhayr is the owner of the project.' });
    await saveMemory({ title: 'Layout', body: 'The compact layout was chosen.' });
    const file = fileTemplate({ sourceMemoryIds: [source.id], updatedAt: 1_000_000_000_000, openConflicts: ['The deploy window is Tuesday.'] });
    await writeSemanticFile(file, 0);

    act(() => { root.render(<SemanticMemoryFiles />); });
    await waitForText('May be out of date');
    expect(container.textContent).toContain('Has conflicting claims');
  });

  it('edits the synthesis only and bumps the version without touching canonical memory', async () => {
    const source = await saveMemory({ title: 'Project owner', body: 'Zuhayr is the owner of the project.' });
    const file = fileTemplate({ sourceMemoryIds: [source.id], updatedAt: source.updatedAt });
    await writeSemanticFile(file, 0);
    const before = (await getSemanticFile(file.id))!;

    act(() => { root.render(<SemanticMemoryFiles />); });
    await waitForText('Zuhayr');
    await act(async () => { cardSummaryButton('Zuhayr').click(); });
    await act(async () => { buttonByText('Edit summary').click(); });

    changeTextArea(container.querySelector('textarea') as HTMLTextAreaElement, 'A human-edited summary of Zuhayr.');
    await act(async () => { buttonByText('Save summary').click(); });
    await waitForText('Summary updated.');

    const after = (await getSemanticFile(file.id))!;
    expect(after.summary).toBe('A human-edited summary of Zuhayr.');
    expect(after.version).toBe(before.version + 1);
    expect(after.id).toBe(file.id);
    // Canonical evidence is untouched.
    expect(await db.memories.count()).toBe(1);
    expect(await db.semanticMemories.count()).toBe(1);
  });

  it('removes only the derived file; underlying memories survive', async () => {
    const source = await saveMemory({ title: 'Project owner', body: 'Zuhayr is the owner of the project.' });
    const file = fileTemplate({ sourceMemoryIds: [source.id], updatedAt: source.updatedAt });
    await writeSemanticFile(file, 0);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    act(() => { root.render(<SemanticMemoryFiles />); });
    await waitForText('Zuhayr');
    await act(async () => { cardSummaryButton('Zuhayr').click(); });
    await act(async () => { buttonByText('Remove file').click(); });
    await waitForText('Summary file removed.');

    expect(await listSemanticFiles()).toHaveLength(0);
    expect(await db.memories.count()).toBe(1);
  });

  it('refreshes a summary from canonical evidence through the bounded rebuild pipeline', async () => {
    const source = await saveMemory({ title: 'Project owner', body: 'Zuhayr is the owner of the project.' });
    const file = fileTemplate({ summary: 'Outdated summary.', sourceMemoryIds: [source.id], updatedAt: 1_000_000_000_000 });
    await writeSemanticFile(file, 0);

    act(() => { root.render(<SemanticMemoryFiles />); });
    await waitForText('Zuhayr');
    await act(async () => { cardSummaryButton('Zuhayr').click(); });
    await act(async () => { buttonByText('Refresh from memories').click(); });
    await waitForText('Summary refreshed from the underlying memories.');

    const refreshed = (await getSemanticFile(file.id))!;
    expect(refreshed.summary).toBe(SYNTHESIS_OUTPUT.summary);
    expect(refreshed.aliases).toContain('Z');
    expect(refreshed.version).toBeGreaterThan(1);
  });

  it('offers a bounded maintenance sweep for stale topics', async () => {
    const source = await saveMemory({ title: 'Project owner', body: 'Zuhayr is the owner of the project.' });
    await writeSemanticFile(fileTemplate({ id: 'semantic_ui_sweep', sourceMemoryIds: [source.id] }), 0);

    act(() => { root.render(<SemanticMemoryFiles />); });
    await waitForText('Refresh 1 stale topic');
    await act(async () => { buttonByText('Refresh 1 stale topic').click(); });
    await waitForText('Maintenance: Refreshed 1 stale topic.');

    const after = (await getSemanticFile('semantic_ui_sweep'))!;
    expect(after.version).toBe(2);
    expect(after.summary).toBe(SYNTHESIS_OUTPUT.summary);
    expect(container.textContent).not.toContain('Refresh 1 stale topic');
    expect(container.textContent).not.toContain('May be out of date');
    expect(await db.memories.count()).toBe(1);
  });
});
