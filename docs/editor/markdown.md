# Live preview

The note editor renders markdown as you write it: headings grow, `**bold**` turns bold, `[[links]]` become links, tasks get checkboxes, and the syntax characters disappear until you move onto them. The file on disk stays plain markdown; live preview only changes how it is drawn.

Read this page to learn what each markdown construct looks like in the editor and how to get back to its source. The same rendering runs in table cells and in the editor fields on cards.

## What each construct looks like

| You write | You see | To edit it |
|---|---|---|
| `# Heading` to `###### Heading` | A sized heading with the `#`s hidden; levels 5 and 6 are small, muted labels | Put the cursor on the line to show the `#`s |
| `**bold**` or `__bold__` | Bold text | Move the caret into or next to the word to show its `**` |
| `*italic*` | Italic text (`_italic_` is not rendered) | Same |
| `~~strike~~` | Struck-through text | Same |
| `` `code` `` | Code in a small box | Same; ``` ``a`b`` ``` holds a backtick |
| `[text](url)` | The link text; click opens the URL in your browser | Move the caret onto the link to show `[` and `](url)` |
| `https://example.com` | A link, always shown in full; click opens it | Edit it as text |
| `[[Note]]` or `[[folder/Note#Heading\|alias]]` | Only the alias, or the note's file name; click opens the note | Move the caret onto the link to show the whole token |
| `??slug` | A violet link to a memory note; click opens it | Edit it as text; nothing is hidden |
| `#tag` | The tag in the accent color; nothing is hidden | Edit it as text |
| `- item`, `* item`, `+ item` | A bullet: a filled dot at even nesting levels, a hollow dot at odd levels | Click onto the bullet itself to show `- ` |
| `1. item` or `1) item` | The number, in the same column as a bullet | Click onto the number to show it raw |
| `- [ ] task` | A checkbox | Click onto the checkbox marker to show `- [ ]` |
| `> quote` | A quote with a left rule and `>` hidden | Put the cursor on the line |
| `> [!tip] Title` | A callout card with an icon | Double-click it, select across it, or type inside it |
| `---`, `***` or `___` on a line | A horizontal rule | Put the cursor on the line |
| `---` block at the top of the file | A shaded properties panel with dimmed keys | Edit it in place |
| ` ```lang ` fence | A code block with a language label, a copy button and line numbers | Double-click it, or type inside |
| `\| a \| b \|` table | An editable table; see [tables](tables.md) | Right-click a cell, then Edit source |
| `$x^2$` | Typeset math, inline | Move the caret onto it to show the LaTeX |
| `$$` on its own line, then LaTeX, then `$$` | A typeset display equation | Move the caret into the block |
| `<div>...</div>` | The HTML, rendered | Click it, or move the caret into it |
| `![[image.png]]` | The image, PDF, audio, video or note, inline; see [attachments](../vault/attachments.md) | Move the caret into the embed |
| ` ```query `, ` ```graph `, ` ```draw ` | A live view, graph or drawing; see [query blocks](../bases/query-block.md), [graph block](graph-block.md) and [ink](ink.md) | The block's own source button |

Outside code, math and links, the word "bismuth" is drawn with the app's iridescent gradient.

## When do I see raw markdown?

Raw source appears under three rules, from smallest to largest:

- **A token**: bold, italic, strike, code, a link, a wikilink or a math span shows its markers when your caret or selection touches it, including the position right before or after its markers. In `**bold** *italic*`, putting the caret in the bold word reveals only `**bold**`.
- **A line prefix**: a bullet, number or checkbox shows its raw marker only when the caret is on the marker itself. Pressing `Home` puts the caret just past the marker and keeps it rendered, so click the marker to edit it.
- **A line or block**: headings, quotes and rules show their raw syntax on any line the caret or selection touches. Code blocks, callouts, tables, HTML blocks and multi-line math show theirs when you enter them, as the table above says.

An editor without focus shows everything rendered. Card editors rely on this, so a card never shows its first line as raw source.

To turn live preview off and edit plain source everywhere, set `editor.livePreview: false` in `.settings`. The related keys are:

| Key | Default | Effect |
|---|---|---|
| `editor.livePreview` | `true` | Render markdown inline as you type |
| `editor.lineWrapping` | `true` | Wrap long lines |
| `editor.lineNumbers` | `false` | Show line numbers in the margin |
| `editor.wrapSelection` | `true` | Typing a wrap character with text selected surrounds it |
| `editor.wrapSelectionChars` | `* _ ~` and a backtick | The characters that wrap a selection |
| `editor.mathMacros` | empty | A LaTeX preamble applied to all math |

See the [settings reference](../settings/reference.md) for every editor key.

## Format text with the keyboard

`Mod+B` and `Mod+I` toggle bold and italic on the selection. Pressing the chord again removes the markers, and with nothing selected the caret lands between a fresh pair of markers. Both are rebindable as `toggle-bold` and `toggle-italic`; a rebind takes effect after the note is reopened.

With text selected, typing a character from `editor.wrapSelectionChars` wraps the selection instead of replacing it: select a word and press `*` for `*word*`, then `*` again for `**word**`. Brackets and quotes already wrap through auto-close.

## Check boxes and tasks

- Click a checkbox to flip done and not done. Right-click it to choose To do, In progress, Done or Cancelled.
- The box characters are space (to do), `x` (done), `/` or `\` (in progress) and `-` (cancelled). Done and cancelled text is struck through and dimmed.
- Completing a task moves it to the bottom of its list, under a "N completed" toggle that hides the finished items.
- A bracket field such as `[due 2026-09-14]`, `[high]` or `[every week]` is drawn as a chip when the parser accepts it. `[due 2026-02-30]` and `[chapter 3]` stay plain text. The field syntax is in [task syntax](../tasks/syntax.md), and typing `due` or `high` on a task line completes them; see [autocomplete](autocomplete.md).

## Fold headings and list items

Each foldable heading and list item has a small triangle in the left margin. Left-click it to fold or unfold for now, until the note is reloaded; right-click it to lock the fold so it survives closing the note. Locked folds are saved in the browser, per note.

## Code blocks

A fenced code block shows its language and a copy button above the code, with line numbers in the margin and colors that follow the active theme. The language comes from the info string: names and aliases of the standard CodeMirror language list, plus `matlab`, `py`, `jl` and `hs`.

Double-click inside the block, or start typing in it, to show the raw fences. Moving the cursor out hides them again. Frontmatter and ` ```yaml ` blocks color their keys the same way.

## Math

Inline math renders at display size but flows in the sentence, so `$\frac{a}{b}$` looks like the block form. A `$...$` span can run across several lines; an unclosed `$` ends at a blank line or code fence, so a price like `$5` does not swallow the note.

Set `editor.mathMacros` to a preamble of `\newcommand`, `\renewcommand`, `\providecommand` and `\def` definitions to use your own commands in every note:

```yaml
editor:
  mathMacros: "\\newcommand{\\R}{\\mathbb{R}} \\newcommand{\\norm}[1]{\\left\\lVert #1 \\right\\rVert}"
```

Your definitions override built-in commands without an error. A definition that cannot be parsed is skipped and the rest still apply. Chemistry notation `\ce{...}` and `\pu{...}` renders too. Math loads on first use, so the first equation in a session can appear a moment late.

## HTML

Raw HTML in a note is drawn, not shown as text. A block starting with a block-level tag such as `div`, `details`, `table` or `figure`, or with `<!--`, renders as a unit until the next blank line; click it to edit its source. Inline tags such as `<mark>`, `<sub>` and `<br>` render in place. Every piece of HTML is sanitized first: scripts, event handlers and `javascript:` links are removed, while formatting, images, links, tables and `style` and `class` attributes are kept.

## Find in a note

`Mod+F` (the rebindable `find` keybinding) opens a find bar at the top of the note. Matches highlight as you type, the bar shows `current/total` or "No results", `Enter` and `Shift+Enter` step through matches, `Aa` toggles case sensitivity, and `Escape` closes it. Matches inside tables highlight in place without opening the table's source.

## Dates in properties

Click the value of a `date` or `datetime` property in the frontmatter and a date picker opens with a calendar input and quick choices such as today and tomorrow. See [autocomplete](autocomplete.md).

## How it works

Live preview is not a markdown-to-HTML pipeline. A CodeMirror `ViewPlugin` in `app/src/editor/livePreview.ts` adds `Decoration` objects to the source on each cursor move, viewport change, document change and focus change. The source stays the ground truth, and the plugin visits only `view.visibleRanges`. Block decorations (tables, HTML blocks, callouts, multi-line math, embeds) come from `StateField`s, because CodeMirror forbids them from view plugins.

`computeBlockRegions(doc)` in `blockRegions.ts` is a pure, CodeMirror-free scan, recomputed only when the document changes. It finds fenced code, frontmatter, tables, HTML blocks, callouts and draw fences. Lines in those regions are handled first and skipped, so the markdown pass never reads code, YAML, table pipes or raw HTML as headings, lists or inline tokens. `query` and `graph` fences are left to `queryBlock.ts` and `graphBlock.ts`.

Reveal is decided by three predicates built from the selection ranges, and all of them are empty while the editor is unfocused:

- `revealsRange(from, to)` is true when a selection range touches the token's span, boundaries included.
- `revealsPrefix(from, to)` is true when a range lies within a line-prefix marker, half-open so a caret just past the marker does not count.
- `isRevealed(lineNumber)` is true when a selection covers the line.

Hidden delimiters carry `cm-hidden-syntax` (`display: none`); revealed ones carry `cm-syntax-mark` (dim mono). An empty list or task item with the caret on it keeps its raw marker so the caret has somewhere to sit. Nesting depth for lists comes from the parse tree, falling back to the raw indent at four spaces per level (`listDepth`), and the hanging indent uses `LIST_STEP` from `listLayout.ts`.

Each inline token has its own pass: `pushEmphasis` in `inlineEmphasis.ts`, then math widgets, an inline-code loop that matches equal-length backtick runs, `pushMarkdownLinks`, `pushBareUrls`, `pushWikilinks`, `pushMemoryRefs`, `pushTags` and `pushBismuth`. Inline math widgets and inline HTML widgets are both replace decorations, and overlapping replaces throw, so the math pass skips ranges that `pushInlineHtml` already claimed. Frontmatter rows get only the link passes.

A click on a rendered link is handled in `Editor.tsx`, which scans the raw line text rather than the DOM, so the same code opens links in frontmatter. The click handler only runs when the target has `.cm-link` or `.cm-wikilink`, which are absent on a link the caret is revealing. Checkbox clicks and right-clicks are handled in `livePreview.ts`; completion reordering uses `reorderAroundLine` from `taskFold.ts`.

Code blocks and frontmatter share the classes `cm-block-top`, `cm-block-mid` and `cm-block-bottom`. Their fill is painted by an `::after` pseudo-element with a negative `z-index`, not a `background`, because CodeMirror paints the text selection in a layer below in-flow backgrounds; an opaque line background would hide the selection on those rows. `numberedLine` in `codeLineNumbers.ts` draws the in-block line numbers from `data-codeline` through `::before`. `BlockSelection.stories.tsx` is the regression story. Fence languages are resolved by `codeLanguages` in `codeLanguages.ts` through `LanguageDescription.matchLanguageName`, never by file extension, and `codeHighlightStyle` colors tokens with theme CSS variables.

The shared markdown stack, `markdownEditingExtensions` in `cellEditorExtensions.ts`, bundles live preview, math, the markdown language, list continuation on `Enter`, vault completion and the bold and italic toggles. The note editor, table cells and card editors all spread it, so they render alike. `Editor.tsx` adds the date picker, find panel (`findPanel.ts`) and fold triangles (`foldBlocks.ts`) on top.

Math is rendered by KaTeX, loaded lazily through `katexLoader.ts`; widgets render empty until `onMathReady` fires. `mathMacros.ts` parses the preamble into KaTeX's `macros` option, caching on the trimmed string. `latexHighlight.ts` colors revealed LaTeX source: commands, brackets, scripts, numbers and `%` comments. Multi-line `$$` blocks and multi-line `$...$` spans belong to `mathBlock.ts`, a `StateField`.

All rendered HTML goes through `sanitizeHtml` in `app/src/sanitizeHtml.ts`, DOMPurify configured with the HTML, MathML and SVG profiles and `target` allowed on links. With no DOM available (Bun tests), it returns its input unchanged. A live HTML artifact embed (`![[viz.html]]`) runs in a sandboxed iframe from `embedBlock.ts` instead, since `<script>` is always stripped here.

Source: `app/src/editor/livePreview.ts`, `app/src/editor/blockRegions.ts`, `app/src/editor/inlineEmphasis.ts`, `app/src/editor/listLayout.ts`, `app/src/editor/callout.ts`, `app/src/editor/htmlPreview.ts`, `app/src/editor/mathBlock.ts`, `app/src/editor/latexHighlight.ts`, `app/src/editor/mathMacros.ts`, `app/src/editor/katexLoader.ts`, `app/src/editor/codeHighlight.ts`, `app/src/editor/codeLanguages.ts`, `app/src/editor/codeLineNumbers.ts`, `app/src/editor/foldBlocks.ts`, `app/src/editor/taskFold.ts`, `app/src/editor/findPanel.ts`, `app/src/editor/markdownFormat.ts`, `app/src/editor/wrapSelection.ts`, `app/src/editor/cellEditorExtensions.ts`, `app/src/editor/datePickerExtension.tsx`, `app/src/sanitizeHtml.ts`, `app/src/Editor.tsx`
