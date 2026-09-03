# Elara Markdown Format

Elara renders a deliberately restricted GitHub-Flavored Markdown subset. The goal is readable chat formatting without allowing arbitrary browser-active markup.

## Supported syntax

| Feature | Syntax |
| --- | --- |
| Italic | `*text*` |
| Bold | `**text**` |
| Bold italic | `***text***` |
| Strikethrough | `~~text~~` |
| Inline code | `` `code` `` |
| Fenced code | triple-backtick fenced blocks |
| Bullets | `- item` or `* item` |
| Numbered lists | `1. item` |
| Quote | `> text` |
| Links | `[name](https://example.com)` |
| Horizontal rule | `---` |

## Roleplay convention

During Roleplay Mode, physical action and scene narration use italics:

`*Elara steps closer and looks toward the window.*`

Spoken dialogue remains normal text:

`That view is beautiful.`

## Intentionally unsupported

Raw HTML, scripts, event handlers, arbitrary CSS/style attributes, inline SVG, iframe/embed/object content, browser navigation schemes, and other executable or browser-active markup are not part of Elara Markdown.

Unsupported HTML is never inserted into the DOM as executable HTML. The renderer treats it as text or neutralises it according to the rendering boundary.

## Link policy

Only ordinary web links using `https:` (and other explicitly approved non-active schemes when a future policy allows them) are accepted. `javascript:`, `data:`, `vbscript:`, and similar active schemes are rejected.

## Rendering boundary

Assistant and user messages are rendered through the same restricted Markdown parser configuration. The parser produces React rendering data; arbitrary model/user HTML is not passed to `dangerouslySetInnerHTML`.

Plain text remains valid input and does not require Markdown syntax.
