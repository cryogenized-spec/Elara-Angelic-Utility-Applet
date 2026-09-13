import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(resolve(process.cwd(), 'src/app/App.tsx'), 'utf8');

function bodyOf(name: string): string {
  const start = appSource.search(new RegExp(`(?:async )?function ${name}\\(`));
  if (start < 0) throw new Error(`${name} must exist — update this guard if it was intentionally renamed`);
  const open = appSource.indexOf('{', start);
  if (open < 0) throw new Error(`${name} has no function body`);
  let depth = 0;
  for (let cursor = open; cursor < appSource.length; cursor += 1) {
    if (appSource[cursor] === '{') depth += 1;
    else if (appSource[cursor] === '}') {
      depth -= 1;
      if (depth === 0) return appSource.slice(start, cursor + 1);
    }
  }
  throw new Error(`${name} has an unterminated function body`);
}

describe('terminal persistence navigation ownership', () => {
  it('does not convert saving to idle from cancel or navigation entry points', () => {
    for (const name of ['cancel', 'switchThread', 'startNewChat']) {
      const body = bodyOf(name);
      expect(body).toContain('statusAfterNavigation');
      expect(body).not.toContain("setStatus('idle')");
    }
  });

  it('releases the global saving lock after settlement even when another thread is visible', () => {
    const turn = bodyOf('streamAssistantTurn');
    expect(turn).toContain("if (generationArbiterRef.current.isActive(generationId)) setStatus('idle')");
    expect(turn).toContain('The user may navigate while saving');
  });

  it('closes the upstream iterator as soon as the reducer becomes terminal', () => {
    const turn = bodyOf('streamAssistantTurn');
    expect(turn).toContain('if (isTerminalPhase(current.phase)) break;');
  });

  it('blocks thread metadata/destructive mutations while terminal persistence owns storage', () => {
    for (const name of ['handleRename', 'handleArchive', 'handleDelete']) {
      expect(bodyOf(name)).toContain("if (status === 'saving') return;");
    }
  });
});
