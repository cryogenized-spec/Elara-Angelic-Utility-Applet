import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The shell used to be styled by two sheets that disagreed. app.css carried a
 * legacy `.message` / `.message-body` / `.conversation` block and, because it
 * was emitted *after* components/conversation-surface.css, it silently won
 * every tie: a 1.55 line-height over the declared 1.62, an 88% message width
 * over min(96%, 580px), and a bordered `.message` box wrapped around a second
 * bordered bubble. The rendered UI matched neither stylesheet.
 *
 * These tests make the single-authority rule enforceable instead of
 * aspirational: every geometry-owning selector below may have exactly one
 * owner, and the values that define the layout contract are pinned here so a
 * regression to "make it fit" CSS fails in unit CI.
 */

const SHELL_SHEETS = [
  'src/app/layout.css',
  'src/app/app.css',
  'src/app/quick-action-rail.css',
  'src/app/components/conversation-surface.css',
  'src/app/components/portrait-banner.css',
  'src/app/components/workspace-menu.css',
  'src/app/components/composer.css',
  'src/app/components/composer-layout.css',
] as const;

const sheets = Object.fromEntries(
  SHELL_SHEETS.map((path) => [path, readFileSync(resolve(process.cwd(), path), 'utf8')]),
) as Record<(typeof SHELL_SHEETS)[number], string>;

const layoutCss = sheets['src/app/layout.css'];
const conversationCss = sheets['src/app/components/conversation-surface.css'];
const portraitCss = sheets['src/app/components/portrait-banner.css'];
const railCss = sheets['src/app/quick-action-rail.css'];
const workspaceCss = sheets['src/app/components/workspace-menu.css'];
const bannerTsx = readFileSync(resolve(process.cwd(), 'src/app/components/PortraitBanner.tsx'), 'utf8');

/** Every selector in a sheet, including the ones nested inside @media blocks. */
function selectorsOf(css: string): string[] {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import[^;]+;/g, '');
  const found: string[] = [];
  let prelude = '';
  for (const character of source) {
    if (character === '{') {
      const candidate = prelude.trim();
      // An at-rule prelude opens a block, not a rule, so it names no selector.
      if (candidate && !candidate.startsWith('@')) {
        for (const part of candidate.split(',')) {
          const selector = part.trim();
          if (selector) found.push(selector);
        }
      }
      prelude = '';
    } else if (character === '}') {
      prelude = '';
    } else {
      prelude += character;
    }
  }
  return found;
}

function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
}

describe('single authoritative layout structure', () => {
  /**
   * Selectors that position a shell region. Each one must have exactly one
   * owner; a second declaration is how the previous geometry drifted apart.
   */
  const GEOMETRY_OWNERS: Record<string, (typeof SHELL_SHEETS)[number]> = {
    '.app-shell': 'src/app/layout.css',
    '.control-stack': 'src/app/layout.css',
    '.glass-menu-button': 'src/app/layout.css',
    '.conversation': 'src/app/layout.css',
    '.conversation__stream': 'src/app/layout.css',
    '.elara-banner': 'src/app/components/portrait-banner.css',
    '.elara-banner__portrait-float': 'src/app/components/portrait-banner.css',
    '.workspace-trigger': 'src/app/components/workspace-menu.css',
    '.tool-rail': 'src/app/quick-action-rail.css',
    '.tool-rail--workspace': 'src/app/quick-action-rail.css',
    '.message': 'src/app/components/conversation-surface.css',
    '.message-user': 'src/app/components/conversation-surface.css',
    '.message-assistant': 'src/app/components/conversation-surface.css',
    '.message-meta': 'src/app/components/conversation-surface.css',
    '.message-body': 'src/app/components/conversation-surface.css',
  };

  for (const [selector, owner] of Object.entries(GEOMETRY_OWNERS)) {
    it(`gives \`${selector}\` exactly one owner (${owner})`, () => {
      const owners = SHELL_SHEETS.filter((path) => selectorsOf(sheets[path]).includes(selector));
      expect(owners).toEqual([owner]);
    });
  }

  it('has no surviving left-spine overlay', () => {
    expect(layoutCss + sheets['src/app/app.css']).not.toMatch(/\.left-spine/);
  });

  it('indents nothing by the retired 54px spine offset', () => {
    for (const [path, css] of Object.entries(sheets)) {
      const declarations = css.replace(/\/\*[\s\S]*?\*\//g, '');
      expect(declarations, path).not.toMatch(/(?:margin|padding|left|inset)[^;{}]*\b54px/);
    }
  });
});

describe('left control cluster', () => {
  const stack = rule(layoutCss, '.control-stack');

  it('stacks the hamburger above the Workspace launcher in one column', () => {
    expect(stack).toMatch(/display:\s*grid/);
    expect(stack).toMatch(/grid-template-columns:\s*var\(--control-width\)/);
    expect(stack).toMatch(/gap:\s*var\(--control-gap\)/);
  });

  it('anchors the cluster to the shell gutter instead of a bespoke offset', () => {
    expect(stack).toMatch(/left:\s*var\(--gutter\)/);
  });

  it('gives both controls the same height token', () => {
    expect(rule(layoutCss, '.glass-menu-button')).toMatch(/height:\s*var\(--control-size\)/);
    expect(rule(workspaceCss, '.workspace-trigger')).toMatch(/height:\s*var\(--control-size\)/);
  });

  it('keeps the touch target at the 44px platform minimum', () => {
    expect(layoutCss).toMatch(/--control-size:\s*(\d+)px/);
    const size = Number(/--control-size:\s*(\d+)px/.exec(layoutCss)![1]);
    expect(size).toBeGreaterThanOrEqual(44);
  });

  it('lets the launcher fill the shared column', () => {
    expect(rule(workspaceCss, '.workspace-trigger')).toMatch(/width:\s*100%/);
    expect(rule(railCss, '.tool-rail--workspace')).toMatch(/width:\s*100%/);
    expect(rule(railCss, '.tool-rail--workspace')).toMatch(/margin:\s*0/);
  });

  it('still opens the services flyout to the right of the trigger', () => {
    expect(rule(workspaceCss, '.workspace-menu')).toMatch(/left:\s*calc\(100% \+ 8px\)/);
  });
});

describe('conversation geometry', () => {
  const conversation = rule(layoutCss, '.conversation');

  it('takes the symmetric gutter from the shell and adds no horizontal padding', () => {
    // `padding: var(--gutter) 0` — vertical only. A horizontal value here is
    // what produced the asymmetric 54px left indent.
    expect(conversation).toMatch(/padding:\s*var\(--gutter\) 0/);
  });

  it('lets the shell own the only horizontal inset', () => {
    expect(rule(layoutCss, '.app-shell')).toMatch(/padding:\s*max\(12px, env\(safe-area-inset-top\)\) var\(--gutter\)/);
  });

  it('gives the assistant message a wider measure than the user bubble', () => {
    expect(rule(conversationCss, '.message-assistant')).toMatch(/max-width:\s*min\(96%, 620px\)/);
  });
});

describe('conversation typography', () => {
  const body = rule(conversationCss, '.message-body');

  it('derives vertical rhythm from the selected text size, not a pixel constant', () => {
    expect(body).toMatch(/font-size:\s*var\(--body-font-size\)/);
    // A unitless ratio scales with font-size by definition.
    expect(body).toMatch(/line-height:\s*var\(--chat-line-height\)/);
    expect(layoutCss).toMatch(/--chat-line-height:\s*[\d.]+;/);
    expect(layoutCss).not.toMatch(/--chat-line-height:\s*[\d.]+px/);
  });

  it('uses a proportional paragraph gap', () => {
    expect(layoutCss).toMatch(/--chat-paragraph-gap:\s*[\d.]+em/);
    expect(rule(conversationCss, '.message-body p + p')).toMatch(/margin-top:\s*var\(--chat-paragraph-gap\)/);
  });

  it('pays for a paragraph exactly once', () => {
    // The previous stack compounded line-height + bottom margin + top margin
    // into the oversized gaps; a paragraph now has no bottom margin at all.
    expect(rule(conversationCss, '.message-body p')).toMatch(/^\s*margin:\s*0;?\s*$/);
  });

  it('hands whitespace to the Markdown parser for model output', () => {
    expect(body).toMatch(/white-space:\s*normal/);
    // …while a person's own line breaks survive in their bubble.
    expect(rule(conversationCss, '.message-user .message-body')).toMatch(/white-space:\s*pre-line/);
  });

  it('draws exactly one bubble per message', () => {
    // `.message` is a transparent wrapper; the surface lives on `.message-body`.
    expect(rule(conversationCss, '.message')).toMatch(/background:\s*transparent/);
    expect(rule(conversationCss, '.message')).toMatch(/padding:\s*0/);
    expect(conversationCss).not.toMatch(/\.message \{[^}]*border:\s*1px/);
    expect(rule(conversationCss, '.message-user .message-body')).toMatch(/border-radius:/);
  });

  it('still honours the user-selected surface colour', () => {
    expect(rule(conversationCss, '.message-user .message-body')).toMatch(/var\(--user-surface-color/);
  });
});

describe('portrait presentation', () => {
  const float = rule(portraitCss, '.elara-banner__portrait-float');
  it('sizes the artwork with real layout instead of a transform', () => {
    expect(float).toMatch(/width:\s*var\(--portrait-width\)/);
    expect(portraitCss).not.toMatch(/transform:\s*scale\(var\(--portrait-scale\)\)/);
    expect(portraitCss).not.toMatch(/transform-origin/);
  });

  it('makes the selected scale the measured width', () => {
    expect(portraitCss).toMatch(/--portrait-width:\s*calc\(var\(--portrait-unit\) \* var\(--portrait-scale\)\)/);
    expect(portraitCss).toMatch(/aspect-ratio:\s*4 \/ 5/);
  });

  it('pins the portrait to the top-right corner', () => {
    expect(float).toMatch(/top:\s*var\(--banner-inset\)/);
    expect(float).toMatch(/right:\s*var\(--banner-inset\)/);
    expect(portraitCss).toMatch(/--banner-inset:\s*8px/);
  });

  it('grows the banner with the portrait instead of letting it overflow', () => {
    expect(rule(portraitCss, '.elara-banner')).toMatch(/min-height:\s*calc\(var\(--portrait-height\) \+ var\(--banner-inset\) \* 2\)/);
  });

  it('clears the control cluster so identity copy never sits under it', () => {
    expect(portraitCss).toMatch(/--cluster-block:\s*calc\(var\(--control-size\) \* 2 \+ var\(--control-gap\)\)/);
    expect(rule(portraitCss, '.elara-banner')).toMatch(/padding:\s*calc\(var\(--cluster-block\) \+ var\(--gutter\)\)/);
  });

  it('retires the decorative banner label', () => {
    expect(bannerTsx).not.toMatch(/ANGELIC UTILITY APPLET/);
    // The portrait plus name and presence already establish identity.
    expect(bannerTsx).toMatch(/<h1>\{characterName\}<\/h1>/);
    expect(bannerTsx).toMatch(/Online · ready/);
  });
});

/**
 * Resolved-geometry check. There is no browser in unit CI, so this parses the
 * real token declarations out of the shipped stylesheets and evaluates the
 * arithmetic they imply. It is not a substitute for the Playwright suite
 * (e2e/mobile-reliability.spec.ts measures real boxes); it exists so that a
 * token change which would make the portrait overlap the control cluster, or
 * push the banner off a 320px screen, fails before anyone sees it.
 */
describe('resolved header geometry (from the declared tokens)', () => {
  const number = (pattern: RegExp): number => {
    const match = pattern.exec(layoutCss + portraitCss);
    expect(match, `${pattern} not declared`).toBeTruthy();
    return Number(match![1]);
  };
  const gutter = number(/--gutter:\s*([\d.]+)px/);
  const controlSize = number(/--control-size:\s*([\d.]+)px/);
  const controlWidth = number(/--control-width:\s*([\d.]+)px/);
  const bannerInset = number(/--banner-inset:\s*([\d.]+)px/);
  const [unitMin, unitVw, unitMax] = /--portrait-unit:\s*clamp\(([\d.]+)px,\s*([\d.]+)vw,\s*([\d.]+)px\)/
    .exec(portraitCss)!
    .slice(1)
    .map(Number);

  const portraitUnit = (viewport: number): number =>
    Math.min(Math.max(unitMin, (unitVw / 100) * viewport), unitMax);

  for (const viewport of [320, 360, 390, 412, 520]) {
    for (const scale of [1, 1.5, 2, 2.5, 3]) {
      const label = `${viewport}px viewport at scale ${scale}`;
      const portraitWidth = portraitUnit(viewport) * scale;
      const bannerContentWidth = viewport - gutter * 2;
      const clusterRightEdge = controlWidth; // relative to the banner's content box
      const portraitLeftEdge = bannerContentWidth - bannerInset - portraitWidth;

      it(`keeps the portrait inside the banner at a ${label}`, () => {
        expect(portraitWidth + bannerInset).toBeLessThanOrEqual(bannerContentWidth);
      });

      it(`keeps the portrait clear of the control cluster at a ${label}`, () => {
        expect(portraitLeftEdge).toBeGreaterThanOrEqual(clusterRightEdge);
      });

      it(`keeps the banner on screen at a ${label}`, () => {
        const portraitHeight = portraitWidth * 1.25;
        const clusterBlock = controlSize * 2 + 10;
        const bannerHeight = Math.max(portraitHeight + bannerInset * 2, clusterBlock + gutter + bannerInset);
        expect(bannerHeight).toBeLessThanOrEqual(0.45 * 915);
      });
    }
  }

  it('makes the largest portrait fit the narrowest supported viewport', () => {
    const portraitWidth = portraitUnit(320) * 3;
    expect(portraitWidth + controlWidth + bannerInset).toBeLessThanOrEqual(320 - gutter * 2);
  });
});
