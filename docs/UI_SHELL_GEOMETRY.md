# UI Shell Geometry

## Purpose

This document is the authoritative description of how the Elara shell is laid
out. It exists because the shell was previously styled by two stylesheets that
disagreed with each other, and the rendered UI matched neither of them.

## The problem this replaces

`src/app/app.css` carried a legacy `.message` / `.message-body` /
`.conversation` block. Vite emitted `components/conversation-surface.css`
*before* `app.css`, so at equal specificity the legacy block won every tie:

| Declaration                | `conversation-surface.css` said | rendered (app.css won) |
| -------------------------- | ------------------------------- | ---------------------- |
| `.message-body` line-height | `1.62`                          | `1.55`                 |
| `.message` max-width        | `min(92%, 560px)`               | `88%`                  |
| `.message` box              | `padding: 0; border: 0`         | bordered, padded box   |

The last row was the visible bug: `.message` drew a bordered, padded box and
`.message-user .message-body` drew a *second* bordered bubble inside it, so
every user message rendered as a bubble inside a bubble. The user's configured
`--user-surface-color` only showed through as a ring around a hardcoded
gradient.

Alongside that, three separate coordinate systems positioned the header: an
absolute `.left-spine` for the hamburger, a `margin-left: 54px` on the tool
rail and the conversation to clear it, and a portrait sized with
`transform: scale()` — a post-layout transform, so the artwork reserved a small
rectangle while painting a much larger one and overflowing the banner.

## The rule

**Every measurement that positions a shell region has exactly one owner.**

`src/app/layout.css` owns the shell box model. Component sheets own the inside
of their own component and consume the tokens; they never invent an offset.

This is enforced in CI by `src/app/layout-authority.test.ts`, which fails if a
geometry-owning selector is declared in more than one shell stylesheet.

## Tokens

Declared in `src/app/layout.css`:

| Token                    | Value   | Meaning                                            |
| ------------------------ | ------- | -------------------------------------------------- |
| `--gutter`               | `14px`  | The only horizontal inset in the app               |
| `--control-size`         | `44px`  | Shared height of the hamburger and Workspace button |
| `--control-gap`          | `10px`  | Vertical gap between the two controls              |
| `--control-width`        | `132px` | Width of the control column                        |
| `--chat-line-height`     | `1.45`  | Unitless body line ratio                           |
| `--chat-paragraph-gap`   | `.55em` | Space between Markdown paragraphs                  |

`--control-size` is 44px, not 42px, because these are touch targets and the
Android portrait suite asserts a ≥44px minimum
(`e2e/mobile-reliability.spec.ts`).

## Region map

```text
.app-shell                    flex column; padding: top --gutter bottom
├── .control-stack            absolute overlay, top-left of the header
│     ├── .glass-menu-button  --control-size square
│     └── .tool-rail          Workspace launcher, --control-size tall
├── .elara-banner             header band
├── .conversation             flex: 1 1 auto
│     └── .conversation__stream
├── .error
└── form.composer
```

The control cluster is an **overlay, never a layout ruler**. Nothing indents
itself to clear it, which is what removed the 54px left indent and made the
conversation gutters symmetric: `.conversation` has `padding: var(--gutter) 0`
and the shell supplies both sides.

## Conversation typography

Vertical rhythm is derived from the selected text size — never hardcoded.
`--chat-line-height` is a unitless ratio and `--chat-paragraph-gap` is in `em`,
so 10px text reads tight and 24px text reads proportionally airier.

Spacing between blocks is the renderer's decision, not the model's. Markdown is
free to express paragraphs; a paragraph is worth exactly one
`--chat-paragraph-gap` and has no bottom margin. This replaced a stack of
`line-height` + bottom margin + top margin that compounded into oversized gaps.
Gemini is **not** instructed to avoid blank lines — that would paper over a
presentation concern.

Whitespace: assistant output is Markdown and gets `white-space: normal`, so the
parser owns structure. User input is literal text and keeps `pre-line`, so the
line breaks a person typed survive.

## Portrait presentation

The portrait is a **real layout box**. `--portrait-width` is
`calc(var(--portrait-unit) * var(--portrait-scale))` and `aspect-ratio: 4 / 5`
derives the height. There is no `transform: scale()` and no
`transform-origin`.

The banner height follows the artwork
(`min-height: calc(var(--portrait-height) + var(--banner-inset) * 2)`), and its
top padding reserves the control cluster
(`--cluster-block: calc(var(--control-size) * 2 + var(--control-gap))`), so the
portrait, the controls and the identity copy can never overlap.

The decorative `ANGELIC UTILITY APPLET` label was removed: the portrait, the
character name and the presence indicator already establish identity.

## Verifying the geometry

- `src/app/layout-authority.test.ts` — single ownership, the token contract, and
  the resolved header arithmetic across 320–520px viewports at every portrait
  scale.
- `e2e/mobile-reliability.spec.ts` — real measured boxes: the control cluster
  stacks in one column, the flyout stays on screen, and the portrait keeps its
  ratio inside the banner.
