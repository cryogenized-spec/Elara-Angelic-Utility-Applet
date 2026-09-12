import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Until 2026-09-12 the Workspace shortcut buttons worked by synthesizing a
 * user turn the user never wrote — "Execute the saved Workspace shortcut …"
 * — and streaming it to the provider with no persisted transcript message.
 * That violated the standing architecture rule that hidden chat prompts must
 * not implement UI shortcuts: it corrupted the provider chain and made any
 * later audit of "what did the user ask for" impossible.
 *
 * The replacement is a visible, editable composer prefill (see
 * `prefillWorkspaceShortcut` in App.tsx). These tests keep it that way. They
 * are source-level on purpose, like layout-authority.test.ts: the invariant
 * is about what code may exist, and a behavioral test cannot distinguish an
 * invented prompt from a user's real one without reimplementing the app.
 */

const appSource = readFileSync(resolve(process.cwd(), 'src/app/App.tsx'), 'utf8');

describe('Workspace shortcuts must not author model input', () => {
  it('never passes a string literal as streamAssistantTurn input anywhere', () => {
    // Every legal call site passes a variable whose value is user-authored
    // text (composer draft, transcript message, or a captured attempt of one).
    // A literal at the call site is by construction app-authored input.
    const literalInputs = [...appSource.matchAll(/streamAssistantTurn\s*\(\s*(?=['"`])/g)];
    expect(literalInputs.map((match) => appSource.slice(match.index, (match.index ?? 0) + 60))).toEqual([]);
  });

  it('contains no streaming call inside any Workspace shortcut entry point', () => {
    const entryPoints = ['prefillWorkspaceShortcut', 'handleQuickShortcut'];
    for (const name of entryPoints) {
      const body = appSource.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n  \\}`));
      expect(body, `${name} must exist — if it was renamed, update this guard`).not.toBeNull();
      expect(body![0], `${name} must not stream a model turn`).not.toContain('streamAssistantTurn');
      expect(body![0], `${name} must not construct task text`).not.toMatch(/hiddenTask|hidden\s+prompt/);
    }
  });

  it('no longer contains the removed synthesized shortcut prompt', () => {
    expect(appSource).not.toContain('Execute the saved Workspace shortcut');
  });
});
