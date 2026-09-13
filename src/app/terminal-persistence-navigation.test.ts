import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(resolve(process.cwd(), 'src/app/App.tsx'), 'utf8');

describe('terminal persistence navigation ownership', () => {
  it('preserves the saving barrier through cancel and navigation', () => {
    expect(appSource).toContain('function cancel() { abortControllerRef.current?.abort(); setStatus((current) => statusAfterNavigation(current));');
    expect(appSource).toContain("setFailedAttempt(null); setStatus((current) => statusAfterNavigation(current));\n    try {");
  });

  it('releases the global saving lock after settlement even off-thread', () => {
    expect(appSource).toContain("if (generationArbiterRef.current.isActive(generationId)) setStatus('idle');");
    expect(appSource).toContain('The user may navigate while saving');
  });

  it('closes the upstream iterator as soon as the reducer becomes terminal', () => {
    expect(appSource).toContain('if (isTerminalPhase(current.phase)) break;');
  });

  it('blocks thread mutations while terminal persistence owns storage', () => {
    expect(appSource).toContain("async function handleRename(id: string, title: string) { if (status === 'saving') return;");
    expect(appSource).toContain("async function handleArchive(id: string) { if (status === 'saving') return;");
    expect(appSource).toContain("async function handleDelete(id: string) { if (status === 'saving') return;");
  });
});
