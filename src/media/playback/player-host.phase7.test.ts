import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./player-host.css', import.meta.url), 'utf8');

describe('Phase 7 player surface CSS contract', () => {
  it('defines exactly the three durable outer-shell preset selectors', () => {
    for (const preset of ['minimal', 'glass', 'cinema']) {
      expect(css).toContain(`:root[data-elara-media-player-preset='${preset}'] .playback-player-surface`);
    }
    expect(css).not.toContain("data-elara-media-player-preset='minimal'] .playback-player-host");
    expect(css).not.toContain("data-elara-media-player-preset='glass'] .playback-player-host");
    expect(css).not.toContain("data-elara-media-player-preset='cinema'] .playback-player-host");
  });

  it('keeps the YouTube iframe rule limited to sizing/display and never layers Elara visuals over it', () => {
    const iframeRule = css.match(/\.playback-player-host iframe\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(iframeRule).toContain('min-height: 200px');
    expect(iframeRule).toContain('border: 0');
    expect(iframeRule).not.toMatch(/position\s*:|z-index\s*:|transform\s*:|filter\s*:|opacity\s*:|pointer-events\s*:|clip(?:-path)?\s*:|mask\s*:/);
    expect(css).not.toContain('.playback-player-host::before');
    expect(css).not.toContain('.playback-player-host::after');
    expect(css).not.toContain('.playback-player-host iframe::before');
    expect(css).not.toContain('.playback-player-host iframe::after');
  });

  it('preserves YouTube minimum viewport geometry in every preset', () => {
    const hostRule = css.match(/\.playback-player-host\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(hostRule).toContain('min-height: 200px');
    expect(hostRule).toContain('aspect-ratio: 16 / 9');
    expect(css).toContain('min-width: 200px');
  });
});
