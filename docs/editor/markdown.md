# Editor Live-Preview Rendering

This document covers every block and inline rendering transformation that Bismuth's CodeMirror editor applies to markdown source text, including the exact trigger conditions, the block kinds supported, how math, raw HTML, and code are processed, and the sanitization pipeline. The live-preview is implemented as a set of CodeMirror extensions in `app/src/editor/livePreview.ts`, `htmlPreview.ts`, `mathBlock.ts`, `codeHighlight.ts`, and `codeLineNumbers.ts`, backed by `sanitizeHtml.ts` and `katexLoader.ts`.

---

## Overview

The live-preview layer is NOT a markdown-to-HTML pipeline. It is a per-line CodeMirror `ViewPlugin` that applies `Decoration` objects directly to editor ranges. This means:

- The markdown source is always the ground truth; decorations are overlays.
- Most decorations **hide syntax characters** and **reveal** them only when a selection range touches that specific token (per-token, not per-line — see [Reveal Rule](#reveal-rule-render-when)). An unfocused editor reveals nothing.
- Block-level decorations (table widgets, HTML block widgets, multi-line math block widgets) must live in `StateField` instances, not the `ViewPlugin`, because CodeMirror prohibits `block: true` decorations from plugins.
- The `ViewPlugin` (`buildDecorations`) runs on every cursor move, viewport change, document change, or active-block change. It is cheap because it only iterates `view.visibleRanges` and recomputes the heavier `BlockRegions` scan only when the document content actually changes.

---

## Reveal Rule ("Render When")

Reveal is **per-token, not per-line**, and gated on editor focus. There are three reveal predicates in `buildDecorations`, all built from `view.state.selection.ranges`:

- **`revealsRange(from, to)`** — `selRanges.some((r) => r.from <= to && r.to >= from)`. An **inline** token (bold/italic/strike/code/link/wikilink/math) reveals its raw syntax only when a selection range actually **touches that token's character span** — not merely because the caret is somewhere on the same line. Touching the boundary counts (caret right before/after the markers), matching Obsidian's live preview. So in `**bold** *italic*`, putting the caret inside `**bold**` reveals only `**bold**`; `*italic*` stays rendered.
- **`revealsPrefix(from, to)`** — `selRanges.some((r) => r.from < to && r.to >= from)`. A line-prefix marker (list bullet / task checkbox) reveals its raw `- ` / `- [ ]` **only when the caret sits within the marker itself**. The half-open `[from, to)` interval means Home (caret just past the marker, at the start of the text) keeps the bullet/checkbox rendered — you must click onto the marker to edit it raw.
- **`isRevealed(lineNumber)`** — line-level structure (headings, blockquotes, thematic breaks) still keys on whether the **line** is touched by a selection (`selSpans.some(([a, b]) => n >= a && n <= b)`, where each `selSpans` entry is `[doc.lineAt(r.from).number, doc.lineAt(r.to).number]`). Selecting across multiple lines reveals each line's structural syntax.

In every case:

- **Hidden** (not revealed): syntax delimiters (e.g. `**`, `*`, `~~`, backtick, `>`, `[[`, `]]`, `#`) get `cm-hidden-syntax` (`display:none`) and the inner content is styled (bold, italic, strikethrough, link color).
- **Revealed**: delimiters are rendered in dim `Monaspace Xenon` monospace via the `cm-syntax-mark` class, so the raw source is always readable while editing.
- **Heading `#` marks** when revealed get `cm-heading-mark` (monospace + `--fg` + weight 500) rather than the dim `cm-syntax-mark`, to match the inline note-title `#` aesthetic.

**Focus gate**: an **unfocused** editor (`!view.hasFocus`) reveals **nothing** — `selSpans` is `[]`, so every line renders as live-preview. This matters for multi-editor surfaces like the Bases cards grid: each card's editor keeps its caret at offset 0, so without the focus gate every unfocused card would expose its first line as raw markdown. The `ViewPlugin.update` re-runs the pass on `u.focusChanged`, so the reveal flips in/out as focus moves.

For block constructs (code fences, frontmatter, HTML blocks, math blocks, tables), the reveal condition is cursor-inside-the-block (any line within the block), not a per-token test.

---

## Block Regions Pre-Scan

`computeBlockRegions` (and the types/regexes it needs — `CodeBlock`, `BlockRegions`, `CalloutLineBlock`, `FENCE_OPEN_RE`/`FENCE_RE`, `scanCalloutLineBlocks`) live in `blockRegions.ts`, not `livePreview.ts` — a pure module with no CodeMirror `view` / DOM / JSX imports, so this scan (which decides exactly which lines are a block's top/mid/bottom, per [Fenced Code Blocks](#fenced-code-blocks) and [YAML Frontmatter](#yaml-frontmatter) above) is unit-testable under `bun test` (`blockRegions.test.ts`) without mounting a real `EditorView`. `livePreview.ts` imports it.

On every document change, `computeBlockRegions(doc)` does a single full-document scan and returns:

| Field | Contents |
|---|---|
| `fenceLines` | Set of line numbers that are ` ``` ` fence lines |
| `codeLines` | Set of line numbers strictly inside a closed fence (not the fences themselves) |
| `codeBlockByLine` | Map from any line number to its `CodeBlock` (open/close/lang/body) |
| `frontmatterLines` | Set of all line numbers covered by the YAML frontmatter block |
| `frontmatterOpen` / `frontmatterClose` | Line numbers of the opening and closing `---` delimiters |
| `tableBlocks` / `tableBlockByLine` | GFM table blocks grouped by `tableModel.ts` |
| `htmlBlockLines` | Set of line numbers covered by blank-line-delimited HTML blocks |

Lines that belong to these regions are handled first in the per-line pass and `continue` out, so markdown interpretation never misreads raw HTML, frontmatter YAML, code content, or table pipes as headings / lists / inline tokens.

---

## YAML Frontmatter

Frontmatter is detected by `extractFrontmatterBoundary` (in `frontmatterUtils.ts`): the document must start with `---\n` on line 1, closed by a later `---` line. The content between the fences is the YAML body.

**Rendering behavior** (bug #10, 5th round — the definitive spec, combining the earlier card and fence-band rounds): the whole block renders as **one homogeneous container** — a uniform subtle background tint across ALL lines, rounded top/bottom corners, and a **continuous left vertical accent line** running the block's full height — with **one delta**: the opening/closing `---` fence rows get a **darker grey band** across the container width, and the left line's segment along those rows **shifts to grey seamlessly** (same thickness/position, just grey there, accent elsewhere). Built from per-line classes, since a CodeMirror line decoration can't span multiple lines: `cm-block-mid` (uniform tint + `var(--accent)` left line, on every body line) plus `cm-block-top` / `cm-block-bottom` (only on the opening/closing `---`: the darker grey band — `color-mix(fg 12%)` vs the body's `color-mix(fg 5%)` — the grey left-line segment `color-mix(fg 40%)`, and that end's two rounded corners).

- **Opening and closing `---` delimiters** always carry `cm-block-top` / `cm-block-bottom` — the container's roof/floor — regardless of cursor state. The literal dashes stay **always visible** in very dim mono (`cm-fence-syntax`, `color-mix(fg 30%)`) — the #10 ask ("the em dashes should always be visible") — and brighten to `cm-syntax-mark` when the cursor is on that exact delimiter line. Never `display:none`-hidden: a fully-hidden line collapses to zero height, which would erase that line's rounded corners and grey band. This ensures both delimiters look the same even though the markdown tokenizer handles them differently, and the container itself never flickers as the cursor enters/leaves.
- **Property rows** (lines between the delimiters): each gets `cm-frontmatter cm-block-mid` (Monaspace Xenon, `--mono-scale` font-size; the container's uniform tint + accent left line come from `cm-block-mid`). In-block 1-based line numbers are displayed via the `numberedLine` mechanism (see [Code Line Numbers](#code-line-numbers-in-block-line-numbers) below).
- **`key:` portion**: The regex `/^(\s*)([A-Za-z0-9_$.-]+)\s*:/` is used to detect the key name on each property row. The key receives `cm-fm-key` (color: `--accent`), while the value portion inherits `--fg`.
- **Links in property values** are styled so the value reads as a clickable link, the same as in the body: wikilinks (e.g. `source: "[[Note]]"`) via `pushWikilinks`, markdown links (e.g. `link: "[Anthropic](https://anthropic.com)"`) via `pushMarkdownLinks`, and bare URLs (e.g. `homepage: https://example.com`) via `pushBareUrls`. All three calls sit together on the frontmatter branch (`pushWikilinks(...); pushMarkdownLinks(deco, text, line.from, revealsRange); pushBareUrls(deco, text, line.from);`) before the `continue`, so they are the only inline treatments applied inside frontmatter; other inline markdown (bold, italic, tags) is skipped. Click handling is shared with the body — `Editor.tsx`'s `mousedown` handler scans the raw line text, so it resolves frontmatter link clicks (open URL / navigate to note) without any frontmatter-specific code.
- **No heading/list/tag/math treatment** on frontmatter lines — after the link styling, the `continue` skips the rest of the per-line pass entirely.

---

## Fenced Code Blocks

A fenced code block is a pair of ` ``` ` lines (optionally with a language info string after the opening fence). Unclosed fences (no matching close in the document) are treated as ordinary lines.

**Special case**: ` ```query ` blocks are **excluded** from code-block rendering here. They are owned by `queryBlock.ts`, which replaces the entire fence with a rendered base/task view. `computeBlockRegions` advances past query blocks without recording them, so livePreview does not double-render them.

Like frontmatter, the whole block ALWAYS renders as one homogeneous container (bug #10, 5th round) — `cm-block-top` on the opening fence, `cm-block-mid` on every body line (uniform tint + continuous accent left line), `cm-block-bottom` on the closing fence (the fence rows being the darker grey bands with grey left-line segments) — regardless of cursor state, so the container never flickers as the cursor enters/leaves. See [YAML Frontmatter](#yaml-frontmatter) above for the shared class design.

### Rendered mode (cursor outside the block)

- **Opening fence line** (`codeBlock.open`): gets `cm-block-top` (darker grey band, grey left-line segment, top rounded corners), and its text is replaced by a `CodeHeaderWidget`. The widget mounts the `<CodeHeader>` Solid component, which renders a dim language label on the left (`cm-code-lang`, shows `"text"` if no info string) and a copy-to-clipboard icon button on the right (`cm-code-copy`) — riding the band (it inherits `cm-block-top`'s padding).
- **Closing fence line** (`codeBlock.close`): gets `cm-block-bottom`, with its raw ` ``` ` always visible in very dim mono (`cm-fence-syntax` — same rationale as the frontmatter dashes: always-visible per the #10 ask, and a hidden line would collapse and erase the container's bottom rounded corners).
- **Body lines**: each gets `cm-codeblock cm-block-mid` (Monaspace Xenon, `--mono-scale` font-size, `line-height:1.5`; uniform tint + accent left line from `cm-block-mid`) and a 1-based in-block line number via `numberedLine("cm-codeblock cm-block-mid", lineNumber - openLine)`.
- **Syntax highlighting**: `codeHighlightStyle` (see [Code Syntax Highlighting](#code-syntax-highlighting)) applies One Dark colors to the body lines via CodeMirror's `HighlightStyle`.

### Edit mode (cursor inside the block)

- Entered by: double-clicking inside the block (dispatches `setActiveCodeEffect`), or by typing inside the block (a `docChanged` transaction while the cursor is in the block).
- Exited by: moving the cursor outside the block (selection-only move clears the active block).
- In edit mode, the opening/closing fence lines keep their `cm-block-top`/`cm-block-bottom` styling (the container never keys off reveal state) but show their raw ` ``` ` text at full mono contrast instead of the header widget / dim `cm-fence-syntax`; body lines are unaffected.
- The active block is tracked as its opening line number (or `null`) in `activeCodeField` (a `StateField`).

**Double-click detail**: `dblclick` handler calls `findCodeBlock` (a full-document scan for the enclosing fence pair) and dispatches `setActiveCodeEffect.of(block.open)`. The default word-selection behavior is preserved (`return false`).

---

## Code Syntax Highlighting

`codeHighlightStyle` in `codeHighlight.ts` defines a `HighlightStyle` for fenced code blocks using the **One Dark palette**:

| Token category | Color |
|---|---|
| Comments | `#7f848e`, italic |
| Keywords, control, module, operator keywords | `#c678dd` |
| Strings, characters | `#98c379` |
| Numbers, integers, floats, booleans, atoms | `#d19a66` |
| Function names (variable/property), label names | `#61afef` |
| Type names, class names, namespaces | `#e5c07b` |
| Property names, attribute names | `var(--accent)` — matches the frontmatter key accent |
| Tag names (HTML/XML) | `#e06c75` |
| Self, null, constant variables | `#d19a66` |
| Operators, punctuation, separators, brackets | `#abb2bf` |
| Regexps, escape sequences | `#56b6c2` |
| Meta, annotations, processing instructions | `#7f848e` |
| Invalid | `#e06c75` |

**Note**: Markdown structural tokens (heading, emphasis, strong, link, list, quote) are explicitly NOT styled by `codeHighlightStyle`. Those are handled entirely by the `livePreview` decorations.

---

## Code Line Numbers (In-Block Line Numbers)

`numberedLine(cls, n)` in `codeLineNumbers.ts` returns a cached `Decoration.line` that adds both the `cls` class and `cm-code-numbered`, with `data-codeline="${n}"` on the line's DOM element. The number is drawn as a CSS pseudo-element:

```css
.cm-code-numbered::before {
  content: attr(data-codeline);
  position: absolute;
  left: -2.7em;
  width: 2em;
  text-align: right;
  color: color-mix(in srgb, var(--fg) 28%, transparent);
  font-variant-numeric: tabular-nums;
  user-select: none;
  pointer-events: none;
}
```

This gutter number sits in the editor's left padding and adds no layout shift to the code text. It is shared by:
- Fenced code body lines (`cm-codeblock`, `numberedLine("cm-codeblock", lineNumber - openLine)`)
- Frontmatter property rows (`cm-frontmatter`, `numberedLine("cm-frontmatter", lineNumber - frontmatterOpenLine)`)
- The revealed ```` ```query ```` source view (in `queryBlock.ts`)

The cache is keyed by `"${cls}:${n}"` so each (class, number) pair produces exactly one `Decoration` instance.

---

## Headings

Regex: `/^(#{1,6})\s+/` on the first characters of the line.

Heading level 1–6 receive line decorations `cm-h1` through `cm-h6` with the following sizes:

| Level | Class | Font-size | Font-weight | Notes |
|---|---|---|---|---|
| H1 | `cm-h1` | 1.94em | 600 | `letter-spacing:-0.015em`, `line-height:1.1` |
| H2 | `cm-h2` | 1.5em | 600 | `letter-spacing:-0.01em`, `line-height:1.25` |
| H3 | `cm-h3` | 1.3em | 600 | — |
| H4 | `cm-h4` | 1.15em | 600 | — |
| H5 | `cm-h5` | 1.05em | 600 | — |
| H6 | `cm-h6` | 1em | 600 | `opacity:0.85` |

**Off cursor line**: the leading `#` characters + trailing space are hidden (`cm-hidden-syntax`). Only the heading text remains visible.

**On cursor line**: the `#` characters get `cm-heading-mark` (Monaspace Xenon, `--fg`, weight 500). The space after the `#`s and the heading text render normally.

**Tag interaction**: `pushTags` is skipped for heading lines (`if (!hm) pushTags(...)`) because a heading's `#` must never be colored as a hashtag.

---

## Blockquotes

Regex: `/^>\s?/` on the line start.

- The whole line receives `cm-quote` (left border `3px solid #555`, `padding-left:8px`, `opacity:0.85`).
- **Off cursor line**: the `>` and optional space are hidden.
- **On cursor line**: they get `cm-syntax-mark` (dim Monaspace).
- Blockquotes do not nest visually (each line is treated independently). All subsequent inline markup (bold, italic, wikilinks, etc.) still applies inside a blockquote line.

---

## Bullet Lists

Regex: `/^(\s*)([-*+])(\s+)/` — captures indent, marker, and trailing whitespace.

**Thematic break detection**: lines matching `/^\s*([-*_])(?:[ \t]*\1){2,}[ \t]*$/` (3+ of the same character optionally separated by spaces) are excluded from bullet treatment even though they match the marker regex.

**Indent depth**: `listDepth(state, pos, indent)` derives the nesting level from the **parse tree first**, falling back to raw indent. It walks `syntaxTree(state).resolveInner(pos, 1)` up its parent chain counting `ListItem` ancestors — the innermost item is itself a `ListItem`, so the structural depth is `Math.max(0, count - 1)`. It also computes a raw-indent depth (`Math.floor(indent.replace(/\t/g, "    ").length / 4)` — tabs expand to 4 spaces, 4 spaces per level) and returns `Math.max(structural, raw)`. So a markdown-recognized nested item gets its true tree depth even when the source indentation is shallow, while a freshly-typed or not-yet-parsed line still indents off its raw whitespace. This 4-space-per-level rule matches `EditorState.tabSize.of(4)` / `indentUnit.of("    ")` for notes — the old `floor(cols / 2)` (tabs-as-2-spaces) rule is gone.

**Bullet glyphs by depth (parity rule)**: the glyph alternates by depth parity, only two variants — even depth → `•` (filled), odd depth → `◦` (hollow): `const glyph = this.depth % 2 === 0 ? "•" : "◦";` in `BulletWidget.toDOM()`. So depth 0 → `•`, depth 1 → `◦`, depth 2 → `•`, depth 3 → `◦`, and so on. The earlier three-variant scheme (`•` / `◦` / `▪` with a `▪` square at depth 2+) no longer exists.

**Hanging indent**: `indentLine("cm-li", depth)` applies a line decoration with:
```
padding-left: (depth + 1) * 1.6em
text-indent: -1.6em
line-height: 1.55
```
`LIST_STEP` (1.6em, the per-level step) lives in `app/src/editor/listLayout.ts` as a dependency-free leaf module shared with `foldBlocks.ts`; `LIST_GUTTER = LIST_STEP` (so the marker gutter is exactly one step wide and the text aligns across levels). The bullet glyph hangs in that gutter via the `text-indent: -1.6em` pulling the marker back into the padding.

The reveal here is keyed on `revealsPrefix(line.from, prefixEnd)` — the caret must sit **within the `- ` marker itself** (half-open `[from, to)`, so a caret at the start of the text just past the marker keeps the bullet rendered).

**Empty-item caret anchoring** (`emptyActive`): the raw branch is also taken when `prefixEnd === line.to && onCursor` — i.e. the line is an *empty* list item (`- ` with nothing after) and the caret is on it. Without this, replacing the whole prefix with a `BulletWidget` on an otherwise-empty line would leave nowhere for the caret and shove it to the far left of the line. Keeping the raw `- ` marker (still indented + mono via `cm-li`/`cm-list-marker`) anchors the end-of-line caret right after the marker where you're about to type. The same `emptyActive` guard appears on the task and ordered-list branches.

**Marker not revealed** (caret not on the marker):
1. The entire prefix (indent + marker + spaces) is replaced by a `BulletWidget` (the depth-appropriate glyph, class `cm-bullet`). The bullet glyph is right-aligned in a 1.6em inline-block column with `padding-right:0.62em`.
2. The literal leading whitespace is hidden (the indent comes from CSS, not the markdown).

**Marker revealed** (caret within the marker):
1. Leading whitespace chars are hidden; the `cm-li` line decoration drives indent from CSS.
2. The marker (`- `, `* `, `+ `) gets `cm-list-marker` (Monaspace Xenon), so the raw dash shows in a monospace font rather than the serif body face.

---

## Ordered Lists

Regex: `/^(\s*)(\d+)([.)])(\s+)/` — captures indent, the number, the `.`/`)` delimiter, and trailing whitespace. The match is **only attempted when the line is neither a task line nor a bullet line** (`const orderedMatch = isTaskLine || bulletMatch ? null : text.match(...)`), and thematic breaks have already `continue`d, so the three list kinds never collide.

Ordered items share the **exact same hanging gutter as bullets** so numbered and bulleted lists line up identically — the only difference is the glyph (the real number stays visible; there is no glyph swap). Depth comes from the same parse-tree-aware `listDepth(...)`, and the line gets the same `indentLine("cm-li", depth)` hanging-indent decoration.

**Rendered** (caret not on the marker, item not empty): the whole prefix (indent + number + delimiter + trailing spaces) is replaced by an `OrderedWidget` carrying `marker = orderedMatch[2] + orderedMatch[3]` (e.g. `"1."` or `"2)"`) and the depth. Its `toDOM()` emits `<span class="cm-ol-number">` with the marker text; a min-width keeps single/double digits aligned in the bullet gutter while letting bigger numbers grow rather than overlap the text. Because `LIST_GUTTER === LIST_STEP`, a `1.` number and a `•` bullet occupy the same column.

**Raw** (`emptyActive` empty-item-with-caret, or `revealsPrefix` caret-within-marker): the same `cm-li` hanging indent is kept, the literal indent whitespace is hidden (when present), and the `1. ` marker span gets `cm-list-marker` (Monaspace) — the number shows in mono, not the serif body face.

Enter/Backspace handling for ordered lists (inserting the next number, renumbering, outdenting an empty item) lives in `markdownKeymap` (registered before `defaultKeymap` in `Editor.tsx`), not in the live-preview decorator.

---

## Task Lists (Checkboxes)

Regex: `/^(\s*)([-*+])(\s+)\[([ xX/\\-])\](\s)/`

Task lines are processed **before** bullet lines, and `isTaskLine = true` guards the bullet match so task lines never also get a bullet glyph.

**Status characters and their meanings**:

| Character | `TaskStatus` | Visual behavior |
|---|---|---|
| ` ` (space) | `"todo"` | Empty checkbox |
| `x` or `X` | `"done"` | Checked box (accent fill + check glyph), text struck-through + dimmed |
| `/` or `\` | `"doing"` | Purple border, slash glyph |
| `-` | `"cancelled"` | Dim border, dash glyph, text struck-through + dimmed |

**Strikethrough**: applied to task text (not the checkbox gutter) for `done` and `cancelled` via `cm-task-done` (`text-decoration:line-through; opacity:0.55`).

Reveal is keyed on `revealsPrefix` over the prefix span (same as bullets), plus the `emptyActive` guard (`prefixEnd === line.to && onCursor`) for an empty checkbox line so its end-of-line caret stays anchored after the marker.

**Marker not revealed**: the entire prefix (indent + `- ` + `[ ]` + trailing space) is replaced by a `CheckboxWidget` (a Solid `<TaskCheckbox>` component). The widget uses `updateDOM()` to drive status changes through a reactive signal, so status transitions animate via CSS transitions rather than snapping on widget recreate.

**Marker revealed**: Same hanging-indent treatment as bullets — leading whitespace hidden, `cm-task` line decoration drives indent; the `- [ ]` marker chars get `cm-list-marker` (Monaspace).

**Click behavior**: `mousedown` handler intercepts clicks on `.cm-task-checkbox` elements. It prevents the default (so the cursor stays put and the line stays in preview mode). The handler reads the line text, identifies the `[ x ]` char, and toggles: `x/X → space`, anything else → `x`. It never produces `doing` or `cancelled` via click — those are typing-only states.

---

## GFM Pipe Tables

Table detection is done by `groupTableBlocks` from `tableModel.ts`, which finds header + separator + body row sequences. A separator row requires at least one `-` character and `|`.

**Block-level widget (StateField)**: `tableWidgetField` (a `StateField`) replaces each non-active table block with a `TableWidget` spanning its entire source range (`block:true`). Block decorations cannot come from a `ViewPlugin`.

**Rendered table** (cursor outside the block):
- The table lines are replaced by the `TableWidget` (an editable `<table>` element with `contenteditable` cells). See `tableWidget.ts` (not covered in detail here).
- The `cm-table-wrap` div has `position:relative; width:fit-content` so the hover toolbar aligns to the table's top-right corner.

**Raw mode** (cursor inside the block):
- The table's lines get `cm-table` (Monaspace Xenon, `--mono-scale` font-size) so pipe structure is readable.
- The active block is tracked in `activeTableField` as the block's header line number.

---

## Inline Formatting

All inline tokens use the same `pushInline(deco, text, lineFrom, reveals, re, markLen, mark)` helper. For each match it computes `onCursor = reveals(s, end)` — the per-token `revealsRange` predicate, so reveal is decided per match, not per line — and then:
1. Applies the styled mark to the inner content.
2. Not revealed: hides the delimiters (`cm-hidden-syntax`).
3. Revealed: applies `cm-syntax-mark` to the delimiters (dim Monaspace reveal).

| Syntax | Regex | Mark length | CSS class |
|---|---|---|---|
| `**bold**` | `/\*\*([^*]+)\*\*/g` | 2 | `cm-strong` (`font-weight:bold`) |
| `__bold__` | `/__([^_]+)__/g` | 2 | `cm-strong` |
| `*italic*` | `/(?<![*\w])\*(?!\*)([^*\n]+?)\*(?![*\w])/g` | 1 | `cm-em` (`font-style:italic`) |
| `~~strike~~` | `/~~([^~]+)~~/g` | 2 | `cm-strike` (`text-decoration:line-through; opacity:0.7`) |
| `` `code` `` | `/(`+)((?:(?!\1)[^\n])*?)\1/g` | run-length | `cm-inline-code` |

**Inline code — CommonMark backtick-run parsing**: inline code does NOT go through `pushInline` (its fixed-length-fence helper can't handle variable fences). It is its own loop over `/(`+)((?:(?!\1)[^\n])*?)\1/g`. The leading `(`+)` captures a run of N backticks that **opens** the span; the inner `(?:(?!\1)[^\n])*?` matches any non-newline chars that are not the full N-backtick run; and the closing `\1` requires a run of **exactly** N backticks to close. So ``` ``a`b`` ``` (a 2-backtick fence) treats the inner single `` ` `` as literal content rather than a closer — a backtick can live *inside* a code span. The old single-backtick `/`([^`]+)`/` regex couldn't do this (it closed on the first inner backtick). The loop computes `fenceLen = m[1].length`, derives `innerStart`/`innerEnd` from it, skips empty spans (`innerEnd <= innerStart`), styles the inner with `cm-inline-code`, and — mirroring `pushInline`'s fence logic — hides both fences (`cm-hidden-syntax`) when not revealed or dims them (`cm-syntax-mark`, Monaspace) when the caret/selection touches the span (`revealsRange(s, end)`). It is kept in the **same inline-token position** (before links/wikilinks) so `[[x]]` inside a code span isn't styled as a wikilink. This mirrors `core/src/wikilinks.ts`'s `stripCode` + CommonMark's run-length code-span rule.

**Inline code styling** (`cm-inline-code`): Monaspace Xenon, `calc(1em * var(--mono-scale, 0.85))` font-size, `rgba(140,140,140,0.18)` background, `3px` border-radius, `0 3px` padding. Note: `--mono-scale` (default 0.85) is an optical correction for monospace-next-to-serif so the inline code matches the surrounding body text size visually.

**Note on italic**: The italic regex uses lookbehind/lookahead `(?<![*\w])\*(?!\*)` and `\*(?![*\w])` to avoid matching `**bold**` patterns as italic. There is no `_italic_` support (only `*`).

**Wrap-on-selection** (input, not rendering): with text selected, typing one of `editor.wrapSelectionChars` (default `* _ ~ `` ` ``) surrounds the selection instead of replacing it — select a word and press `*` to get `*word*`, press again for `**word**`. The selection stays on the inner text so wraps nest. Brackets and quotes `( [ { ' " $` already do this via auto-close, so they're excluded from the default set; the feature is the `wrapSelection` extension (`app/src/editor/wrapSelection.ts`), gated by the `editor.wrapSelection` setting.

### Cmd+B / Cmd+I emphasis toggles

`app/src/editor/markdownFormat.ts` adds keyboard **toggles** for bold and italic, registered **only on note buffers** (the non-YAML branch in `Editor.tsx`) and at `Prec.high` so they beat any default `Mod-b`/`Mod-i` binding:

```ts
Prec.high(keymap.of([
  { key: "Mod-b", run: toggleBold },
  { key: "Mod-i", run: toggleItalic },
]))
```

`toggleBold` = `toggleWrap("**")`, `toggleItalic` = `toggleWrap("*")`. Both are `StateCommand`s built by the same `toggleWrap(marker)` factory, which runs `state.changeByRange` so it handles every cursor and a multi-cursor selection uniformly. For each range, in order:

1. **Markers just outside the selection** → unwrap. If `sliceDoc(from - m, from) === marker` *and* `sliceDoc(to, to + m) === marker` (the caret/selection sits *inside* an already-wrapped span, e.g. `**x**` with `x` selected), it deletes both flanking marker runs and shifts the selection left by `m`. So `**hi**` with `hi` (offsets 2–4) selected becomes `hi` with `0–2` selected.
2. **Selection itself carries the markers** → strip them. If the selected text is `>= 2*m` long and both `startsWith`/`endsWith` the marker, it replaces the selection with the inner slice (`selected.slice(m, length - m)`) and contracts the selection by `2*m`. So selecting the whole `**hi**` toggles it back to `hi`.
3. **Otherwise** → wrap. It inserts `marker + selected + marker`. An **empty** selection lands the caret *between* the two markers (`EditorSelection.cursor(from + m)`) so you can start typing inside — e.g. `Cmd+B` on empty text gives `****` with the caret between the pairs. A non-empty selection keeps the selection on the inner text (`range(from + m, to + m)`), matching the wrap-on-selection feel.

The dispatch uses `userEvent: "input"` with `scrollIntoView: true`. Unlike wrap-on-selection (which only wraps and only fires on a literal keystroke of a wrap char), these are true toggles bound to the platform Cmd/Ctrl chord, so pressing the chord a second time on the same span removes the emphasis. Unit-tested in `markdownFormat.test.ts`.

---

## Markdown Links

Regex: `/\[([^\]]+)\]\(([^)]+)\)/g`

- The visible link text (between `[` and `]`) gets `cm-link` (accent color, accent-soft bottom border, `cursor:pointer`).
- Reveal is per-token (`onCursor = revealsRange(s, end)`): only the link the caret/selection touches shows its syntax.
- **Not revealed**: the `[`, `](url)` are hidden.
- **Revealed**: the `[` and `](url)` portions get `cm-syntax-mark`.

The URL itself is never shown unless that specific link is revealed (hidden along with the brackets).

Extracted as `pushMarkdownLinks(deco, text, lineFrom, reveals)`, called on both body lines and frontmatter property rows (so `link: "[Anthropic](https://anthropic.com)"` in frontmatter renders as a link).

---

## Bare URLs

`findBareUrls(text)` in `urls.ts` finds `https?://` followed by non-space, non-delimiter characters. Trailing sentence punctuation (`.`, `,`, `;`, `:`, `!`, `?`) is trimmed. Unbalanced closing parentheses are also trimmed (e.g. `(https://x.com)` → `https://x.com`), but balanced parens inside URLs (e.g. Wikipedia's `Foo_(bar)`) are preserved.

URLs inside markdown link syntax `](url)` are skipped (handled by the markdown-link path instead).

The entire URL text is styled with `cm-link` (same as markdown links). Nothing is hidden — the URL is the visible text. Bare URLs are never revealed/hidden on cursor — they always render as colored links.

Extracted as `pushBareUrls(deco, text, lineFrom)`, called on both body lines and frontmatter property rows (so `homepage: https://example.com` in frontmatter renders as a link).

---

## Wikilinks

Regex: `/(?<!!)\[\[([^\]]+?)\]\]/g` — the `(?<!!)` negative lookbehind excludes embed syntax `![[...]]` (handled by `embedBlock.ts`).

The **visible range** is computed by `wikilinkVisibleRange(inner, start)`:
1. If `|` is present in the inner text: the alias (text after `|`) is the visible range.
2. Else: the basename of the target (text after the last `/`, up to any `#`) is the visible range.

Reveal is per-token (`pushWikilinks` calls `onCursor = reveals(s, end)` per match, with `reveals = revealsRange`):

**Not revealed**: everything outside the visible range is hidden — the `[[`, any folder path prefix, any `#heading` fragment, and the `]]`. Only the basename or alias is shown, styled `cm-wikilink` (accent color, accent-soft bottom border, `cursor:pointer`).

**Revealed** (a selection touches this wikilink): the `[[`, folder path, `#heading`, and `]]` get `cm-syntax-mark` (dim Monaspace reveal). The visible range still gets `cm-wikilink`.

**Edge case**: a degenerate token where `visTo <= visFrom` (e.g. `[[#heading]]` which has an empty basename) applies `cm-wikilink` to the entire `[[...]]` span.

**Frontmatter wikilinks**: `pushWikilinks` is also called on frontmatter property rows, so `source: "[[Base]]"` in frontmatter renders as a wikilink. Markdown links and bare URLs get the same frontmatter treatment via `pushMarkdownLinks` / `pushBareUrls` (see those sections).

---

## Hashtags

`pushTags(deco, text, lineFrom)` applies to every non-heading, non-frontmatter, non-code, non-table, non-HTML line.

Regex: `/(^|\s)(#[\p{L}\d/_-]+)/gu` — `#` followed by one or more Unicode letters/digits/`/`/`_`/`-`.

The entire tag (including the `#`) gets `cm-tag` (`color: var(--teal)`). No text is hidden — the `#` is always visible and colored. This applies on both cursor and non-cursor lines (there is no reveal/hide for tags).

Tags are skipped on heading lines (the `if (!hm) pushTags(...)` guard) so heading `#` characters are never colored teal.

---

## Math (KaTeX)

Math rendering is **lazy-loaded**: KaTeX (~280KB) loads only when a note first contains math. Before the library loads, math widgets render empty and re-render once `onMathReady` fires.

Both inline and single-line block math reveal **per token** (`revealsRange(s, end)`), not per line: only the `$…$` / `$$…$$` the caret/selection touches shows its raw source. Block math (`$$…$$`) is processed **before** inline math (`$…$`) so the `$$` form wins.

### Inline math: `$expr$`

Regex: `/(?<!\$)\$([^$\n]+)\$(?!\$)/g`

- Negative lookbehind/ahead `(?<!\$)...\$(?!\$)` prevents matching `$$...$$` as inline math.
- **Not revealed**: the entire `$expr$` span is replaced by a `MathWidget`. The expression is wrapped as `` `\displaystyle ${expr}` `` and rendered with **`displayMode: false`**. This is deliberate: `\displaystyle` makes fractions/sums/limits render at **full display size** (the same typography as a `$$` block), while `displayMode: false` keeps the math **inline** (it flows in the sentence rather than breaking onto its own centered line). So `$\frac{a}{b}$` looks like the block form instead of the cramped default inline style. `\displaystyle` is a valid KaTeX switch; `throwOnError: false` shrugs off anything malformed.
- **Revealed**: the two `$` delimiters get `cm-syntax-mark` (`syntaxMark.range(s, s + 1)` / `syntaxMark.range(end - 1, end)`), and the inner LaTeX is syntax-highlighted by `latexTokenDecorations(s + 1, expr)` (see [LaTeX Source Highlighting](#latex-source-highlighting)).
- Inline math widgets must not overlap with inline HTML widget spans (the `inHtmlSpan(s, end)` guard skips them if they do).

### Single-line block math: `$$expr$$`

Regex: `/\$\$([^$]+)\$\$/g`

- The `$$` delimiters and the expression are all on one line.
- **Not revealed**: replaced by a `MathWidget` with `displayMode: true`. The widget's `<span>` gets `cm-math cm-math-display` (a full-width block wrapper so KaTeX equation tags / auto-numbers — `\tag`, numbered `align`/`equation` — sit flush at the right margin rather than overlapping the equation).
- **Revealed**: the two `$$` delimiters get `cm-syntax-mark` and the inner LaTeX is highlighted via `latexTokenDecorations(s + 2, expr)`.
- Also guarded against overlap with HTML widget spans.

### Multi-line block math: `$$\n...\n$$`

Handled by `mathBlock()` in `mathBlock.ts`, which is a separate `StateField`.

- Detected by: a line whose entire trimmed content is `$$` (opening fence), followed by content lines, then another line whose entire trimmed content is `$$` (closing fence).
- `$$` lines inside fenced code blocks are ignored (tracked by `CODE_FENCE` toggle).
- When the cursor is **outside** the block: replaced by a `MathBlockWidget` (`block:true`), rendered with `displayMode: true`, styled `cm-math-block` (`display:block; text-align:left; margin:0.4em 0`).
- When the cursor is **inside** the block (any position from the opening `$$` to the closing `$$`): raw source is shown, no replacement.
- KaTeX is loaded lazily via `katexLoader.ts`; `onMathReady` is used to re-render the widget after the library arrives.

### KaTeX rendering

`renderMath(expr, displayMode)` calls `katex.renderToString(expr, { throwOnError: false, displayMode })`. `throwOnError: false` means malformed expressions render as an error message rather than throwing.

Both inline and block math widgets register via `onMathReady` in their `toDOM()` if `renderMath` returned an empty string (library not yet loaded). A widget destroyed before KaTeX loads drops its pending `onMathReady` callback via the stored unsubscribe.

### LaTeX Source Highlighting

When a math token **is** revealed (the caret/selection touches it), the raw LaTeX source is shown — and `app/src/editor/latexHighlight.ts` colors it so editing math reads like code instead of flat prose, rather than just dumping plain text. `latexTokenDecorations(offset, src)` runs the pure, DOM-free `tokenizeLatex(src)` and maps each token to a cached `Decoration.mark`. Both reveal sites push these alongside the `cm-syntax-mark` delimiters (`latexTokenDecorations(s + 1, expr)` for inline, `s + 2` for `$$`).

`tokenizeLatex` recognizes a small lexical grammar (offsets relative to `src`):

| Token | Match | Class | Color (One Dark) |
|---|---|---|---|
| Control sequence | `\` + letters (`\frac`, `\alpha`) **or** `\` + one non-letter (`\{`, `\\`, `\,`, `\%`) | `cm-tex-command` | `#c678dd` (keyword purple) |
| Grouping / optional-arg brackets | `{` `}` `[` `]` | `cm-tex-bracket` | `#abb2bf` (punctuation grey) |
| Sub/superscript markers | `^` `_` | `cm-tex-script` | `#56b6c2` (escape cyan) |
| Numbers | digit run with interior dots (`3`, `3.14`) | `cm-tex-number` | `#d19a66` (number orange) |
| `%` line comment | `%` to end of line | `cm-tex-comment` | `#7f848e` italic |
| `$` / `$$` delimiters | (via `texDelim`) | `cm-tex-delim` | `#7f848e` (dim, recedes) |

Everything else (letters, operators) inherits the editor foreground. Colors live in `latexHighlightTheme`, matching `codeHighlight.ts`'s One Dark palette so math source and fenced code read consistently. `tokenizeLatex` is unit-tested in `latexHighlight.test.ts`.

### Math Macros & mhchem (preamble)

`app/src/editor/mathMacros.ts` parses a LaTeX math preamble (Obsidian `preamble.sty` style) into a KaTeX `macros` object (`{ "\\name": "body" }`). The preamble text comes from the `editor.mathMacros` setting; `katexLoader.ts` parses it (caching on the trimmed raw string so a whitespace-only edit doesn't bust the cache) and passes the result as KaTeX's `macros` option, merged over a set of no-op MathJax-ism macros (`{ ...NOOP_MACROS, ...userMacros() }`). So a note can define reusable commands (e.g. `\R`, `\norm`). User definitions silently **override** builtins (no redefinition error — matching MathJax/Obsidian, unlike KaTeX's `\newcommand`, which throws on redefining `\R`). KaTeX re-infers each macro's argument count from the highest `#n` in its body, so the parser drops any `[argc]` count.

`parseMathMacros(preamble)` supports:

- `\newcommand{\name}{body}` / `\newcommand\name{body}`
- `\newcommand{\name}[2]{body}` (and an optional `[default]`)
- `\renewcommand{...}{...}` / `\providecommand{...}{...}`
- `\def\name{body}` / `\def\name#1#2{body}`

Bodies may contain balanced nested braces and `\{` / `\}` escapes (`readGroup` tracks brace depth and skips the char after a `\`). A braced name (`{\name}`) is validated as a real control-sequence name via `isValidCsName` (a control **word** of ≥1 letters, or a single-char control **symbol**) — `\1st` / `\123` are rejected rather than registered as dead macros (`\(` is accepted as a single-char symbol). Unparseable fragments are **skipped** rather than aborting the whole preamble, so one bad macro can't disable the rest. `%` comments are NOT stripped (KaTeX has no comment syntax either). `parseMathMacros` is unit-tested in `mathMacros.test.ts`.

**mhchem**: `katexLoader.ts` side-effect-imports `katex/contrib/mhchem` (it mutates the KaTeX singleton), so `\ce{...}` / `\pu{...}` chemistry notation renders alongside ordinary math — matching Obsidian's MathJax + mhchem stack.

---

## Raw HTML Rendering

All rendered HTML is passed through `sanitizeHtml()` before `innerHTML` injection (see [Sanitization](#sanitization) below).

### Block HTML

A **block HTML** block is a blank-line-delimited run of lines starting with a CommonMark type-6 HTML block tag or `<!--`. The tag set includes: `address`, `article`, `aside`, `blockquote`, `details`, `div`, `dl`, `figure`, `footer`, `form`, `header`, `hr`, `iframe`, `li`, `main`, `nav`, `ol`, `p`, `section`, `summary`, `table`, `tbody`, `td`, `tfoot`, `th`, `thead`, `tr`, `ul`, and others. Inline-only tags (`span`, `b`, `i`, `mark`, `sub`, `sup`) are **not** block tags and render inline instead.

Detection is pure/synchronous (`scanHtmlBlocks` in `htmlPreview.ts`) — independent of the async Lezer parse — so block decorations never flicker on edit.

**Rendered mode** (cursor outside the block):
- The entire block is replaced by an `HtmlBlockWidget` (`block:true`), a `<div class="cm-html-block">` containing the sanitized HTML. `data-from` attribute stores the block's start offset for click-to-edit targeting.
- Clicks on the rendered block (except on links) move the cursor to the block start, which puts the cursor inside the block and collapses the widget to show raw source.

**Edit mode** (cursor inside the block):
- Raw source is shown; the `htmlBlockField` `StateField` checks `headLine >= b.fromLine && headLine <= b.toLine` and skips the replacement.

HTML block lines are registered in `htmlBlockLines` so the per-line markdown pass skips them entirely (no double-decoration of raw HTML as headings/lists/etc.).

### Inline HTML

Inline HTML is detected using the Lezer syntax tree (`HTMLTag` nodes via `syntaxTree(state).iterate`), which means tags inside inline code or fenced blocks are correctly excluded.

**Grouping**: `groupInlineHtml(tags)` groups an outermost open…matching-close pair into one span, or a lone void/comment tag into its own span. Depth tracking is name-agnostic (any open tag increments depth, any close tag decrements it). Unmatched close tags are ignored.

**Tag kinds** (`classifyTag`):
- `"comment"`: starts with `<!--`
- `"void"`: self-closing `/>` suffix, or a void element name (`area`, `base`, `br`, `col`, `embed`, `hr`, `img`, `input`, `link`, `meta`, `param`, `source`, `track`, `wbr`)
- `"open"`: any other opening tag
- `"close"`: starts with `</`

**Off cursor line**: each grouped span is replaced by an `HtmlInlineWidget` (`<span class="cm-html-inline">` with sanitized `innerHTML`).

**On cursor line**: each raw `HTMLTag` node gets `cm-syntax-mark` (dim Monaspace reveal). No widget replacement.

`pushInlineHtml` returns the covered spans so the math handler can skip overlapping `Decoration.replace` operations (two overlapping replace decorations would throw).

---

## Sanitization

`sanitizeHtml(dirty)` in `sanitizeHtml.ts` wraps DOMPurify with the following config:

```js
{
  USE_PROFILES: { html: true, mathMl: true, svg: true },  // HTML + inline MathML/SVG islands (KaTeX)
  ADD_ATTR: ["target"],                                    // allow <a target="_blank">
}
```

The MathML/SVG profiles are on so KaTeX's rendered `<math>`/`<svg>` output (path/circle geometry) survives sanitization; the plain HTML profile alone would strip those islands.

DOMPurify strips: `<script>`, inline event handlers (`onclick=…`, `onerror=…`, etc.), `javascript:` URLs, and other XSS vectors, while **keeping** benign formatting elements: `<b>`, `<i>`, `<u>`, `<span>`, `<mark>`, `<sub>`, `<sup>`, `<div>`, `<details>`, `<img>`, `<a>`, `<table>`, etc., along with `style`, `align`, and `class` attributes. Note `<script>` is always stripped, which is why a live HTML artifact (`![[viz.html]]`) can only run inside a **sandboxed iframe** (`embedBlock.ts`), never inlined through this path — see [Vault Attachments & Embeds](../vault/attachments.md).

**Headless fallback**: In Bun tests / SSR (no `window`), DOMPurify cannot sanitize (no DOM). `sanitizeHtml` detects this and passes through the input unchanged — this is safe because `innerHTML` is never called in a headless context.

Sanitization is applied in:
- `HtmlBlockWidget.toDOM()` (block HTML)
- `HtmlInlineWidget.toDOM()` (inline HTML)
- `bases/markdown.ts` `renderMarkdown` (card faces, calendar descriptions, `.md` transclusion, export)

---

## In-Note Find Bar

`app/src/editor/findPanel.ts` provides an in-editor "Find" bar (default `Cmd`/`Ctrl+F`; the keybinding is owned by `Editor.tsx`, reading `settings.keybindings.find`, so it is user-rebindable). It is a custom CodeMirror search **panel** (`createFindPanel`) wired through `@codemirror/search` via `findExtension()` (`search({ top: true, literal: true, createPanel })`), so match **highlighting** and next/prev navigation come for free while the bar's DOM is fully app-styled (`.bismuth-find`). A custom panel — not a Solid overlay — is required because `@codemirror/search`'s highlighter returns `Decoration.none` whenever `state.panel` is null; registering `createPanel` keeps highlighting alive.

- **Live highlight**: every keystroke fires `runQuery`, which dispatches a `setSearchQuery` (`{ search, caseSensitive, literal: true }`) so all matches highlight as you type, then reveals the nearest match at/after the current selection (`revealFrom`, wrapping to doc start). It deliberately does **not** call CM's `findNext` on the typing path, because `findNext` select-all's the search field on every call (the "one character at a time" bug); the input is intentionally **not** tagged `main-field` for the same reason.
- **Match count**: `matchStats(view, query)` walks the query cursor to compute `{ total, current }` — `total` matches and the 1-based index of the one currently selected (0 when the selection isn't on a match). The count renders as `current/total` (`–/total` when off a match), `"No results"` when none, blank when the query is empty. The scan is capped at `MAX_COUNT = 10000` so a 1-char query in a huge doc can't stall the UI.
- **Case toggle**: the `Aa` button (`.bismuth-find-case`) flips `caseSensitive` and re-runs the query; the active state shows `.bismuth-find-active`.
- **Navigation**: `Enter` → `findNext`, `Shift+Enter` → `findPrevious` (also the prev/next icon buttons); `Esc` (or the close button) calls `closeSearchPanel` and refocuses the editor.
- **Key isolation**: the bar `stopPropagation`s its own `keydown`/`mousedown` so typed keys don't bubble to the editor keymap or `App.tsx`'s global shortcut handler.
- **Lifecycle/sync**: `mount()` seeds the input + count from the active query (which `openSearchPanel` itself seeds from a single-line `<100`-char selection) and focuses/selects the input; `update()` refreshes the count on doc/selection/query change and syncs an external query change into the field **only when the input isn't focused**, so it never clobbers what the user is typing.

---

## Summary Table: All Block Kinds

| Block kind | Trigger | Rendered off-cursor | Edit trigger | Raw appearance |
|---|---|---|---|---|
| YAML frontmatter | Doc starts with `---\n` | `---` delimiters collapsed; property rows shown in Monaspace + accent keys | Cursor inside block | Both `---` dim Monaspace; rows Monaspace |
| Fenced code block | ` ``` ` pair | Opening → CodeHeader widget; body → Monaspace + line numbers; closing → hidden | Double-click or type inside | Opening/closing ` ``` ` visible, raw code |
| GFM table | Header + sep + body rows | Replaced by editable `TableWidget` | Cursor inside block | Pipe-separated Monaspace |
| Block HTML | Block tag or `<!--` to blank line | `HtmlBlockWidget` (sanitized `innerHTML`) | Click inside rendered block | Raw HTML tags |
| Multi-line `$$` math | `$$` fence lines | `MathBlockWidget` (KaTeX display mode) | Cursor inside block | Raw LaTeX source |
| Blockquote | `^>\s?` | `cm-quote` border; `>` hidden | Cursor on line | `>` in `cm-syntax-mark` |
| Heading H1–H6 | `^#{1,6}\s+` | Sized line; `#`s hidden | Cursor on line | `#`s in `cm-heading-mark` |
| Bullet list | `^\s*([-*+])\s+` | `BulletWidget` glyph (`•`/`◦` by depth parity); hanging indent | Caret **within the marker** (`revealsPrefix`) or empty item (`emptyActive`) | `- ` in `cm-list-marker` |
| Ordered list | `^\s*\d+[.)]\s+` | `OrderedWidget` (number visible, `cm-ol-number`); same gutter as bullets | Caret **within the marker** (`revealsPrefix`) or empty item (`emptyActive`) | `1. ` in `cm-list-marker` |
| Task list | `^\s*([-*+])\s+\[…\]\s` | `CheckboxWidget`; hanging indent | Caret **within the marker** (`revealsPrefix`) or empty item (`emptyActive`) | `- [ ]` in `cm-list-marker` |

---

## Summary Table: All Inline Kinds

Reveal is **per token** (`revealsRange`): only the token a selection range touches shows its raw syntax, and an unfocused editor reveals none.

| Syntax | Rendering (not revealed) | Per-token reveal |
|---|---|---|
| `**bold**` / `__bold__` | Bold text; delimiters hidden | Delimiters in `cm-syntax-mark` |
| `*italic*` | Italic text; delimiters hidden | Delimiter `*` in `cm-syntax-mark` |
| `~~strike~~` | Strikethrough + 0.7 opacity; delimiters hidden | Delimiters in `cm-syntax-mark` |
| `` `code` `` | Monaspace background box; backtick run hidden | Backtick run in `cm-syntax-mark` (run-length-aware: N backticks open, only an equal run closes — a backtick can live inside) |
| `[text](url)` | Accent-colored text; `[`, `](url)` hidden | `[` and `](url)` in `cm-syntax-mark` |
| `https://…` bare URL | Accent-colored URL text; nothing hidden | Always shown as link, no hide/reveal |
| `[[target\|alias]]` | Alias or basename in accent; brackets/path/heading hidden | `[[`, path, `#heading`, `]]` in `cm-syntax-mark` |
| `#hashtag` | Teal (`--teal`) text including `#`; nothing hidden | Always shown teal, no hide/reveal |
| `$expr$` inline math | KaTeX widget — `\displaystyle` + `displayMode:false` (display-size math, inline flow); all hidden | Raw `$expr$` source, `$` dim + LaTeX-highlighted (no widget) |
| `$$expr$$` same-line block math | KaTeX widget (`displayMode:true`, full-width block); all hidden | Raw `$$expr$$` source, `$$` dim + LaTeX-highlighted (no widget) |
| Inline HTML span | `HtmlInlineWidget` (sanitized); all hidden | Tags in `cm-syntax-mark` |

---

## Extension Composition

The `livePreview` export (an array) composes all pieces:

```ts
export const livePreview = [
  activeCodeField,      // StateField: which code block is in edit mode
  activeTableField,     // StateField: which table block is in edit mode (from tableState.ts)
  tableWidgetField,     // StateField: block-replace widgets for non-active tables
  htmlBlockField,       // StateField: block-replace widgets for non-active HTML blocks
  codeLineNumberTheme,  // EditorView.theme: .cm-code-numbered::before gutter
  // dblclick → enter code edit mode
  // mousedown → HTML block cursor drop + checkbox toggle
  EditorView.domEventHandlers({ dblclick, mousedown }),
  ViewPlugin,           // per-visible-line decoration (cheap, runs on every update)
  EditorView.theme(…),  // all livePreview CSS rules
];
```

`mathBlock()` (from `mathBlock.ts`) is a separate export combined elsewhere in `Editor.tsx`. `codeHighlightStyle` is consumed via CodeMirror's `syntaxHighlighting()`. The `Mod-b`/`Mod-i` keymap (`markdownFormat.ts`) and the `datePropertyPicker` extension are added directly in `Editor.tsx`'s note branch, not inside the `livePreview` array.

---

## Date / Time Property Picker

`app/src/editor/datePicker.ts` (`datePropertyPicker(getSchema)`) opens a small calendar popover when the caret sits in the **value** of a note-frontmatter property whose registered type is `date` or `datetime` (the property type comes from the `properties:` section of `.settings`, surfaced to the editor as the `propertyRegistry`). The popover offers a native `<input type="date">` (plus an `<input type="time">` for `datetime`), defaulting to today / now — the same native controls the calendar `EventModal` uses — above a list of relative-date quick options (today, tomorrow, in a week…, from `relativeDateOptions()` in `taskComplete.ts`).

It is a `showTooltip` tooltip, **not** a CodeMirror autocomplete source, on purpose: the autocomplete popup closes the moment the editor loses focus, so a focusable native date input inside it would be dismissed the instant you click it to open the OS calendar. A `showTooltip` tooltip is state-driven (tied to the cursor/selection via a `StateField`, not focus), so the native input can take focus freely. The relative-date rows apply on `mousedown` + `preventDefault`, so clicking them never blurs the editor.

- **State**: a `StateField<PickerState>` recomputes only when the caret or doc changed, calling the pure `findDateTarget(doc, head, schema)` (in `datePickerCore.ts`). It preserves tooltip identity (so the native inputs don't remount and lose focus) while the caret stays on the same property at the same anchor, rebuilding only when the value's start position shifts. A dismissed property's signature is held in `dismissed` so the picker stays closed until the caret leaves that property.
- **Applying a value**: `composeDateValue(kind, dateStr, timeStr)` builds the value and it's spliced over the property's value range. A bare `date` closes the popover and returns focus to the editor; a `datetime` keeps the popover open after the date is set so the time can still be entered (and vice-versa).
- **Keymap** (`Prec.highest`): `Escape` dismisses, `ArrowUp`/`ArrowDown` move the relative-option highlight, `Enter` picks the highlighted option (falling through to a normal Enter when nothing is highlighted).
- Pure helpers (`findDateTarget` / `parseDateValue` / `composeDateValue` / `nowHHMM`) live in `datePickerCore.ts` and are unit-tested in `datePicker.test.ts`.

---

Source: `app/src/editor/livePreview.ts`, `app/src/editor/markdownFormat.ts`, `app/src/editor/listLayout.ts`, `app/src/editor/datePicker.ts`, `app/src/editor/datePickerCore.ts`, `app/src/editor/htmlPreview.ts`, `app/src/editor/mathBlock.ts`, `app/src/editor/latexHighlight.ts`, `app/src/editor/mathMacros.ts`, `app/src/editor/findPanel.ts`, `app/src/editor/codeHighlight.ts`, `app/src/editor/codeLineNumbers.ts`, `app/src/sanitizeHtml.ts`, `app/src/editor/katexLoader.ts`, `app/src/editor/urls.ts`, `app/src/editor/wikilink.ts`, `app/src/editor/frontmatterUtils.ts`, `app/src/editor/TaskCheckbox.tsx`, `app/src/editor/CodeHeader.tsx`, `app/src/editor/tableModel.ts`, `app/src/Editor.tsx`
