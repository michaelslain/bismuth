# Block Editor (true-WYSIWYG)

The **Block Editor** is Bismuth's second editor surface, alongside the CodeMirror `Editor`. It is a Notion-like, true-WYSIWYG note surface built on per-block [Milkdown](https://milkdown.dev) (ProseMirror) instances: headings render large, `**bold**` renders bold, `[[wikilinks]]`/`#tags`/`$math$`/embeds become live chips with **no markdown symbols shown**, and the whole note is a vertical stack of draggable blocks with a `/` slash menu, a selection-anchored format bar, and inline wikilink/tag autocomplete. A note opens in this surface (versus the raw-markdown CodeMirror editor) controlled **entirely** by the single `editor.defaultMode` setting — there is no per-note UI toggle. Critically, the surface replicates `Editor.tsx`'s anti-clobber autosave contract byte-for-byte: a note's source of truth is the **raw markdown string**, parsed into a *lossless* block model whose serialize is just the verbatim frontmatter plus every block's verbatim source, so a whole-file write never corrupts unmodelled content.

The implementation is three layers:

- **`blocks/blockModel.ts`** — pure, DOM-free, lossless markdown ↔ blocks parse/serialize (runs under `bun test`).
- **`blocks/milkdownEditor.ts`** + **`blocks/inlineNodes.ts`** + **`blocks/emphasisMarker.ts`** + **`blocks/preserveWhitespace.ts`** — the Milkdown bridge: one per-block WYSIWYG surface, the custom inline atoms, and the serializer fidelity shims.
- **`BlockEditor.tsx`** + **`blocks/FormatBar.tsx`** — the Solid orchestration: the block store, autosave/SSE contract, slash menu, autocomplete, format bar, lazy viewport mounting, and the per-type renderers.

## The lossless block model (`blocks/blockModel.ts`)

### The hard invariant

The model's release gate is one equation, asserted for *any* markdown `md`:

```
serializeBlocksToMarkdown(parseMarkdownToBlocks(md)) === md
```

This holds because every block carries the **exact original source slice** in its `raw` field (including its trailing blank-line spacing), and `serializeBlocksToMarkdown(frontmatter, blocks)` simply concatenates the verbatim `frontmatter` prefix and every block's `raw`. Output is **never** derived from a block's editable `text` — only from `raw`. The module is pure and DOM-free (no CodeMirror, no Solid).

### Frontmatter split

`parseMarkdownToBlocks` first calls `splitFrontmatter`, which matches `FRONTMATTER_REGEX` (`/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/`, identical to `core/src/frontmatter.ts`) and keeps the **verbatim** matched prefix as `ParsedDocument.frontmatter` — it is never re-stringified from parsed YAML. `parseFrontmatter` is still invoked (for validation / to mirror malformed-YAML tolerance), but its parsed data is not used to rebuild bytes. Frontmatter is *never* a block; it is concatenated byte-for-byte by serialize.

### Block segmentation

The body (everything after the frontmatter prefix) is segmented line-by-line by `parseBody` into a `Block[]`. Each block's `Block.raw` is the exact concatenation of its source lines *with their original terminators* (`splitLines` keeps `\n`, `\r\n`, and a missing final newline distinct via parallel `lines`/`terms` arrays), so joining every `raw` reproduces the body byte-for-byte. The recognized `BlockType`s and how they segment:

| Type | Recognition | Notes |
| --- | --- | --- |
| `blank` | a run of empty/whitespace-only lines | one block per run; the spacing safety net |
| `code` | `FENCE_RE` (```` ``` ```` or `~~~`, length ≥ 3) | grouped through a CommonMark close (a line of *only* the same fence char, at least as long as the opener) or EOF; `lang` = info string, `text` = body lines |
| `mathBlock` | a standalone `$$` line | consumed through the closing `$$`; `text` = inner lines |
| `table` | a pipe row whose **next** line is `TABLE_SEP_RE` (`isTableStart`) | header + separator + contiguous pipe rows; **opaque** (no `text`, edited as raw) |
| `html` | `HTML_OPEN_RE` (`<tag` / `<!--` at line start) | consumed to the next blank line; opaque |
| `quote` | contiguous `>` lines (`QUOTE_RE`) | `text` strips the `> ` prefix per line |
| `divider` | `DIVIDER_RE` (`---`/`***`/`___`) | single line, no `text` |
| `heading` | `HEADING_RE` (`#{1,6}`) | single line; `level` 1–6, `text` is the title with trailing `#`s stripped |
| `task` | `TASK_RE` (a `- [ ]`/`- [x]` checkbox item) | one line; `checked`, `indent` (exact leading whitespace), `text` |
| `bulletItem` | `BULLET_RE` (`-`/`*`/`+`) | `indent`, `marker` (exact token), `ordered:false`, `text` |
| `orderedItem` | `ORDERED_RE` (`\d+[.)]`) | `indent`, `marker` (e.g. `1.`/`2)`), `ordered:true`, `text` |
| `image` | `IMAGE_RE` (a standalone `![alt](url)` line) | `text` = the trimmed line |
| `paragraph` | a run of non-blank lines starting no other structure | bounded by `startsNewBlock`, so adjacent constructs aren't swallowed |
| `frontmatter` / `unknown` | safety-net types | round-trip verbatim via `raw`; shouldn't appear in a body |

`text` is the editable, marker-stripped content surfaced to the UI; it is **absent** for blocks with no editable content (`divider`) or opaque blocks (`table`/`html`/`unknown`). A documented limitation: a `---` directly under a paragraph line is a CommonMark setext-H2, but the model classifies it as paragraph + `divider` (setext isn't modeled). This is visual-only — serialization stays byte-for-byte verbatim, nothing is lost on disk.

The fenced-code grouping deliberately requires the close fence to be *at least as long* as the opener (so a ```` ```` ```` block can contain a shorter ```` ``` ```` line) and to be *only* fence chars (so an info-string line like ```` ```js ```` doesn't close it).

### Editing & raw regeneration

Editing a block means rewriting *that block's* `raw`; untouched blocks stay byte-identical. The helpers:

- **`renderBlockToMarkdown(block)`** — renders a block's editable attributes back to its markdown source line(s) *without* trailing spacing. It re-emits the structural prefix the model owns: `# ` for headings, `- [x] `/`- [ ] ` for tasks (with `indent`), the `marker` for list items, `> ` per quote line, a backtick fence + `lang` for code (choosing a fence **longer than any all-backtick line in the body** so an embedded ```` ``` ```` can't close early), `$$\n…\n$$` for math, `---` for dividers, and the verbatim `text` for paragraphs/images. Opaque types return their `raw` unchanged.
- **`regenerateRaw(block)`** — splits the current `raw` into content + trailing blank-line spacing (`splitTrailingBlanks`), preserves the original EOL style (`\r\n` vs `\n` vs none), re-renders via `renderBlockToMarkdown`, normalizes multi-line output to the block's own EOL, and reassembles `content + eol + trailing`. Opaque blocks (`table`/`html`/`frontmatter`/`blank`/`unknown`) are returned unchanged. Returns a **new** block.
- **`setBlockText`**, **`toggleTaskChecked`**, **`setHeadingLevel`** — thin wrappers that mutate an attribute and re-run `regenerateRaw`.

### `reconcileEditedBlock` — realigning the model with disk

An *edit* can make a block's regenerated source describe a different structure than the block claims: a heading whose `text` gains a newline (Shift+Enter / paste) serializes to lines that re-parse as several blocks; a paragraph whose text becomes `# x` / `- x` / `> x` re-parses as a heading / list / quote. Left unreconciled, the in-memory model would diverge from disk and the note would visibly restructure on the next reload.

`reconcileEditedBlock(block)` closes that gap: it `regenerateRaw`s the block, re-parses the regenerated *content* through the shared `parseBody`, and:

- opaque blocks → just `[regenerateRaw(block)]` (their raw is the source of truth);
- emptied content → keeps an empty block of its own type (doesn't collapse to `blank`);
- single block of the **same type** → keep `regen` as-is;
- **structure changed** → adopt the parsed blocks (markdown-shortcut behaviour, and lossless multi-block splitting). The first keeps the edited block's `id` (focus continuity), the last carries the original trailing spacing, and extras get fresh `re<n>` ids.

No bytes are ever lost either way — this only realigns block boundaries with the source. (The orchestrator runs this on **blur** for the code textarea; rich-text structure shortcuts go through the bridge's split/store path instead.)

### Slash-item mapping

`blockTypeForSlashItem(id)` maps a slash-menu item id (from `editor/slashMenu.ts` `SLASH_ITEMS`) to the `BlockType` it inserts (`h1`/`h2`/`h3`→`heading`, `ul`→`bulletItem`, `ol`→`orderedItem`, `task`, `quote`, `table`, `code`/`query`→`code`, `math`→`mathBlock`, `divider`, `embed`→`image`, `wikilink`→`paragraph`, `properties`→`frontmatter`). `SLASH_ITEM_BLOCK_TYPES` is the full table, derived from `SLASH_ITEMS` so the catalog stays in lockstep.

## The Milkdown bridge (`blocks/milkdownEditor.ts`)

`createBlockEditor(opts)` is the one factory that mounts a true-WYSIWYG ProseMirror surface for **one** text-editable block. It and `inlineNodes.ts` are the only modules that import `@milkdown/*`; the whole bundle is code-split behind a dynamic `import()` from `BlockEditor.tsx` (the `sheet/univerSheet.ts` pattern) so ProseMirror/remark stay out of app boot.

### Per-block, inline-content only

The block model owns block *structure* — the `#`, `- `, `> `, `- [ ]` prefixes live in `blockModel`'s render. A Milkdown surface holds **only the block's inner inline content**, so it serializes inline markdown (`**bold** [[wikilink]] #tag`) — never a list/heading/task wrapper. This sidesteps GFM-task and loose-list serialization drift entirely and keeps the block store the single source of truth. The surface is seeded from `opts.value` (the block's `block.text`) and serialized back via `getMarkdown()` (which strips the serializer's single trailing `\n` to match what the store stores).

Structural ops stay in the store: a high-priority ProseMirror `keymap` maps:

- **Enter** → `onEnter(caret)` (split the block; `caret` is the markdown offset, computed by `markdownCaretOffset` via `doc.cut(0, head)` serialized — *not* a raw PM position, because an inline atom is 1 PM unit but many markdown chars and marks add chars not in the doc text). When the slash or autocomplete menu is open, Enter is routed to it instead.
- **Shift-Enter** → falls through to commonmark's hardbreak (a literal newline within the block).
- **Backspace at the textblock start** (`$from.parentOffset === 0`) → `onBackspaceAtStart()` (merge into previous).
- **ArrowUp at first line** / **ArrowDown at last line** (`atFirstLine`/`atLastLine`, which check for a hardbreak node before/after the caret) → `onArrowOut(dir)`.
- **Escape** → routed to an open autocomplete/slash menu.
- **Mod-b/i/e/k** → `toggleStrongCommand` / `toggleEmphasisCommand` / `toggleInlineCodeCommand` / `toggleLinkCommand`.

The editor is assembled with `preserveAffixWhitespace` **first** (it must read original parse positions before commonmark re-splits text), then `commonmark`, then `inlineAtoms`. `remarkStringifyOptionsCtx` is set to `STRINGIFY_OPTIONS`.

### Anti-clobber on the bridge

The bridge guards against the two ProseMirror failure modes that would clobber the file:

- A module-scoped `lastEmitted` plus an `applyingExternal` flag mean a doc-changing transaction fires `onChange` **only** when the serialized markdown actually changed (caret moves / mark-only no-ops don't churn the store + save), and **never** during a programmatic replace.
- `setMarkdown(md)` is a **no-op** when `serialize() === md`. While the user types, the store's value equals the bridge's last emit, so the host's content-sync effect never replaces the doc and the caret never jumps. A real external change replaces the doc via a `replaceWith` transaction with `addToHistory: false` (an external reload isn't a user undo step). This is the ProseMirror equivalent of `Editor.tsx`'s `el.value !== v` guard.

### The serializer-fidelity shims

`STRINGIFY_OPTIONS` pins the canonical bytes the rest of the project writes — `-` bullets, `*` emphasis/strong default, fenced code, `-` thematic rules, and `resourceLink: false` so an explicit `<https://x>` autolink round-trips as an autolink (not `[https://x](https://x)`). Three custom handlers protect byte fidelity:

- **`verbatimText`** (`text` handler) emits plain text *verbatim* instead of mdast-util-to-markdown's conservative escaping (`snake_case`→`snake\_case`, `array[0]`→`array\[0]`, `R&D`→`R\&D`). That defensive escaping is valid markdown but diverges byte-for-byte from what the block model + CodeMirror Editor store, and would rewrite the `.md` on the first visual edit and ping-pong the two surfaces. Because every Obsidian construct that needs protection is pulled into verbatim `html` atom nodes (see below), a residual `text` node is genuinely literal prose and emits raw. (A documented, accepted normalization: a source backslash escape in prose is consumed at parse before the text node exists and re-parses as the bare char, which is idempotent; HTML entities decode to their char and can't be recovered.)
- **`markerAwareEmphasis` / `markerAwareStrong`** (`blocks/emphasisMarker.ts`) honour the *authored* marker so `_italic_` round-trips as `_italic_` (not `*italic*`) and `__bold__` as `__bold__`. The marker is already preserved through parse by commonmark's `remarkMarker` (onto `node.marker`); the only gap is the stock serializer, which ignores `node.marker` and reads the hard-pinned `*`. These handlers emit `marker + content + marker` directly, also dodging the stock handler's `_`-run attention encoding (`_a_ _b_`→`_a&#x5F; &#x5F;b_`) that would be a byte divergence here. They default to `*` for programmatically-built (toggle/paste) nodes.

`preserveAffixWhitespace` (`blocks/preserveWhitespace.ts`) is a `$remark` transformer that recovers the leading + trailing inline whitespace CommonMark strips from a paragraph at parse time, so `"foo   "` round-trips to `"foo   "` (not `"foo"`). The stripped affixes aren't in any `text` node but are locatable: the `paragraph` node's `position` spans the full source (incl. the affixes) while its first/last child's position covers only kept content; the gap, read back out of the source vfile, is re-attached as explicit `text` leaves. It only fills a **pure-whitespace** gap at the very start/end (never an interior run, which would be a hard-break owned by Shift-Enter), runs before the inline-atom tokenizers (so positions are intact), and re-seeds a paragraph for an entirely-whitespace source (which CommonMark drops to an empty root).

### `setMarkdown` / `getMarkdown` / `focus` / `exec` / `applyAutocomplete` / `destroy`

The returned `BlockEditorHandle` exposes: `setMarkdown` and `getMarkdown` (above); `focus(caret)` placing the caret at `"start"`/`"end"`/a markdown offset (mapped back to a PM position by `mdOffsetToDocPos`, which walks nodes accumulating markdown length — text char-by-char, an atom by its full `raw` length → one PM step — so an offset never over-shoots an atom); `exec("bold"|"italic"|"code"|"link")` running the inline-mark toggle (the toolbar/keybinding hook); `applyAutocomplete(from, text, caretAfter?)` which **re-parses `text` as inline markdown** and splices its inline content into `[fromPos, toPos]` so a chosen `[[Note]]`/`#tag` lands as a live atom chip (not literal characters) and fires `onChange`; and `destroy()` tearing down the view.

### Slash + autocomplete + selection detection

After each doc-changing transaction the onChange plugin runs `detectSlash` (fires `onSlash(query, rect)` when the whole block content is a lone `/query` in a single child, else `onSlashDismiss`), `detectAutocomplete` (uses the **same** `matchWikilinkPrefix`/`matchTagPrefix` matchers as the CodeMirror editor over the text up to the caret, firing `onAutocomplete(kind, query, from, rect)` where `from` is the markdown offset where the query starts), and `reportSelection` (fires `onSelectionChange(rect)` with the bounding rect of a non-empty range, or `null` for a collapsed caret / lost focus, so the host floats/hides the format bar).

## The custom inline atoms (`blocks/inlineNodes.ts`)

The Obsidian-flavoured inline syntax CommonMark doesn't model is rendered as ProseMirror **inline atoms** — `contenteditable=false` chips, indivisible as a unit, rendered with **no markdown symbols visible**. Each atom follows a `$remark` + `$node` + `toMarkdown` pattern built by the generic `makeAtom(def)` factory:

1. a `$remark` transformer walks the mdast tree, splitting every `text` node on the atom's `pattern` into alternating text + a custom inline mdast node carrying the **verbatim `raw`** source slice (it recurses into emphasis/strong prose containers but **not** into link/image labels — descending would break autolink round-tripping and is semantically wrong);
2. a `$node` maps that to a ProseMirror inline atom (`atom:true`, `selectable:true`) whose `toDOM` re-runs the pattern on `raw` to build the styled chip;
3. `toMarkdown` re-emits the atom as an **`html` mdast node** so mdast-util-to-markdown passes it through *untouched* — this is the round-trip linchpin: emitting the raw syntax as a `text` node would escape it to `\[\[Note]]` / `\#tag` / `\$x\$`.

The concrete atoms (registered in this order so longer/prefixed patterns tokenize first — embeds before wikilinks/images):

- **`bismuthEmbedWiki`** — `![[Embed]]` / `![[image.png]]`, an opaque `▦ name` chip.
- **`bismuthEmbedImg`** — `![alt](url)`, an opaque `▦ alt` chip.
- **`bismuthWikilink`** — `[[target#heading|alias]]`, displayed as `alias || basename` (`wikilinkDisplay`, the same rule as the CodeMirror live preview + `renderNoteBody`), carrying `data-href` (`wikilinkTarget`).
- **`bismuthTag`** — `#tag` (incl. nested `#a/b`), requiring start-of-line or whitespace before `#` so it doesn't match a heading or `C#` (matches `editor/tag.ts`); `raw`/chip cover only the `#tag` token.
- **`bismuthMath`** — inline `$math$`, rendered via the **same shared KaTeX** renderer (`renderMath`/`onMathReady`) the CodeMirror live-preview + `renderNoteBody` use, so the chip shows typeset math. KaTeX loads lazily (~280 KB); until it lands the chip paints the raw `$…$` as a `.bismuth-math[data-math]` placeholder and `scheduleMathUpgrade` fills every still-empty placeholder (scoped to `.bismuth-block-milkdown span.bismuth-math[data-math]`) once the chunk resolves.
- **`bismuthUrl`** — bare `https://…` URLs (mirrors `editor/urls.ts`), a `.bismuth-bareurl` chip with `data-href`.

## Orchestration (`BlockEditor.tsx`)

`BlockEditor` shares the **exact same props contract** as `Editor` (`{ path, initialText, onSaved, noteNames, tagNames }`) so `FileView` swaps one for the other based solely on `editor.defaultMode`.

### The block store

Document state is a verbatim `frontmatter()` signal + a **fine-grained `createStore<Block[]>`**. Plain edits update individual block fields in place (`setBlocks(i, "text", v)`, `setBlocks(i, "raw", raw)`) so the focused DOM row persists across a keystroke. Structural changes go through `replaceBlocks(next)` = `setBlocks(reconcile(next, { key: "id" }))`, which diffs by `id` so an insert/remove/split/merge/reorder/type-change only remounts the rows that actually changed. Runtime-created blocks get `rt<n>` ids (distinct from parse's `b<n>` and reconcile's `re<n>`), so keyed rendering never collides across a reparse.

`docText()` / the save path always read the store via `serializeBlocksToMarkdown(frontmatter(), blocks)` — never the DOM.

### The anti-clobber / autosave contract (mirrors `Editor.tsx`)

A note's source of truth is the raw markdown string and there is **no** server-side conflict detection (last-write-wins on `PUT /file`), so this surface replicates the CodeMirror editor's contract verbatim:

- **Parse on open** into the lossless block model; output is `frontmatter` + every block's verbatim `raw`, never re-derived from `text`.
- **`normalizeFrontmatterSpacing`** is applied on open *and* in the save path, byte-identically to `Editor.tsx`, so the two surfaces don't fight; the open-time normalize self-heals the file (and records `lastSavedText` so its echo is a clean no-op).
- **Debounced autosave** (`scheduleSave`): plain typing flows `onChange(md)` → `onPlainInput(id, md)` → granular store writes (`text` + regenerated `raw`) → `scheduleSave`, which sets `pendingSave = true` and arms a timer at `settings.editor.autoSaveDelay`. On fire it serializes the store, `save()`s (→ `api.write` → `primeNoteCache` → `props.onSaved` → optional `api.backup()` when `vault.backupOnSave`), recording `lastSavedText` *before* the await so a fast echo still matches, and clears `pendingSave` only if nothing changed during the write. `scheduleSave` deliberately does **not** re-parse/re-normalize (that would churn every block with fresh ids and recreate the focused surface mid-type).
- **SSE reconcile** (`createEffect` over `lastChange()`): on a change affecting this path it re-reads disk, but is **skipped while `pendingSave`** is true (disk is stale, our write is about to land — reverting would clobber the local edit), skipped when the serialized doc already equals disk (no-op refresh), and skipped when disk equals `lastSavedText` but we've edited further (the echo of our own save). A *real* external change re-parses from disk and `replaceBlocks` (keyed rows keep untouched DOM stable). It tracks `lastIgnoredVersion` to dedupe echoes.
- **`flushSave`** runs on unmount / file-switch (`onCleanup` in the load effect) and via a once-registered **`beforeunload` keepalive** PUT (`keepalive: true`), so a debounced edit can never drop. `currentText` is reassigned per buffer so the once-added unload handler always reads the live document.

### Slash menu, autocomplete, and the format bar

- **Slash menu** — a lone `/query` in a paragraph/bullet/ordered block fires `onSlash`; the host renders a `PopoverList` (driven by `createMenuNav`) over `filterSlashItems(SLASH_ITEMS …)` (with `wikilink`/`embed`/`properties` filtered out, since those insert inline text not a block). `chooseSlash` transforms the empty trigger block into a block of that type via `makeBlock` (`/query` instead opens the visual `QueryBuilder`, which on confirm rewrites the block as a ```` ```query ```` fence). While the menu is open, the bridge routes Arrow/Enter/Escape to it.
- **Wikilink / tag autocomplete** — the bridge's `onAutocomplete` reports an open `[[…`/`#tag` trigger; the host renders the same `PopoverList` + `createMenuNav`, ranks candidates from `noteNames()`/`tagNames()` (`matchScore`: exact/prefix/substring), and `chooseAuto` commits via the handle's `applyAutocomplete` anchored at the **opening delimiter** (`from - 2` for `[[`, `from - 1` for `#`) so the inserted whole token re-parses into a live chip.
- **Format bar** (`blocks/FormatBar.tsx`) — shown on a non-empty selection (bridge `onSelectionChange` reports the rect). Its mark buttons (Bold/Italic/Code/Link) route to the handle's `exec()` (same path as Mod+B/I/E/K); its block buttons (H1/H2/H3/Bullet) route to the **store** via `changeBlockKind`, which changes the *block's type* (preserving `text`, re-running `regenerateRaw`) — never wrapping a node inside the inline surface, because the block prefix lives in `blockModel`.

### Viewport-lazy mounting

A rich-text block hosts a full ProseMirror `EditorView`, heavy to construct and paint. On a long note, Milkdown mounts **only** for blocks in or near the viewport; an offscreen block renders a lightweight, read-only **static `renderNoteBody` preview** into the same root until scrolled in. One shared `IntersectionObserver` (created lazily once `host` mounts, with `root: host` and `rootMargin: "100% 0px 100% 0px"` — a full viewport of pre-mount margin each edge so a block mounts *before* it scrolls into sight) dispatches `isIntersecting` to each block's visibility callback. In headless/jsdom (`typeof IntersectionObserver === "undefined"`) blocks are always mounted, preserving test behaviour. The Milkdown chunk is warmed via `loadMilkdown()` on `onMount`.

Each `RichTextBlock` is a three-state PREVIEW ⇄ MOUNTED lifecycle gated by `shouldMount = near() || forceMount()`; it unmounts only when both are false **and** focus isn't inside (`!root.contains(document.activeElement)`), with `focusin`/`focusout` re-running the effect so a just-blurred offscreen block unmounts promptly. Because **the store is the single source of truth** — every keystroke flows `onChange` → `onPlainInput` → store synchronously — an unmount can never lose data: serialize reads the store, never the DOM. `focusById` registers each block's focus closure **synchronously** (independent of mount state), so a `queueFocus`/`focusSibling`/split/merge targeting an offscreen block **force-mounts** it (`setForceMount(true)`, remembering a `pendingCaret`) and places the caret once the async `create()` resolves. Clicking a still-static preview mid-mount calls `queueFocus(id)` so the caret lands rather than being swallowed by the read-only DOM.

### Per-type renderers

`renderBlock` routes by type: a ```` ```query ```` code block → a live `QueryBlockBlock` (a `BaseView`, flat-vs-config branch matching `editor/queryBlock.ts`, with a Pencil that re-opens the builder when `isBuilderRepresentable`); `divider` → `<hr>`; `blank` → an invisible spacer row (kept so the gutter still lets you insert/reorder around the gap); `table`/`image`/`html`/`mathBlock` → a read-only `RenderedBlock` (click toggles a raw-editing textarea, whose blur `reparseRaw`s); the rich-text types (paragraph/heading/quote/list/task) → `RichTextBlock` (Milkdown); and **`code`** → a `CodeBlock` monospace textarea (raw is the point — no WYSIWYG; granular `onPlainInput`, structural keys via `onTextKeyDown`, blur `reconcileEditedBlock` via `onTextBlur`, caret-safe controlled value-sync). Frontmatter is surfaced as a read-only **properties strip** (key + value chips via `propValues`/`scalarText`), never edited here. Each row carries a gutter with a "+" (insert paragraph below) and a drag handle for reorder.

## Choosing the surface: `editor.defaultMode`

Which surface a note opens in is controlled **entirely** by `editor.defaultMode` (`core/src/schema/settingsSchema.ts`, an `enum(["source","visual"])`, default `"source"`) — *the only control; there is no per-note toggle*. `FileView` reads `settings.editor.defaultMode === "visual"` and renders `BlockEditor` when visual, else the CodeMirror `Editor`, as the fallback. Because `settings` is reactive, flipping `editor.defaultMode` in `.settings` swaps **every open note's surface live**. Both surfaces are interchangeable over the same file (same `body()` as `initialText`, same `onSaved`), and both honour the identical anti-clobber save contract, so the swap never loses an edit.

Source: `app/src/blocks/blockModel.ts`, `app/src/blocks/milkdownEditor.ts`, `app/src/blocks/inlineNodes.ts`, `app/src/blocks/emphasisMarker.ts`, `app/src/blocks/preserveWhitespace.ts`, `app/src/blocks/FormatBar.tsx`, `app/src/BlockEditor.tsx`, `app/src/FileView.tsx`, `app/src/PaneContent.tsx`, `app/src/editor/slashMenu.ts`, `core/src/schema/settingsSchema.ts`, `core/src/settings.ts`
