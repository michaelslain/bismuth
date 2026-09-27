# Editor Autocomplete

Bismuth's editors share a single CodeMirror `autocompletion()` extension for every completion source, registered in `app/src/editor/autocomplete.ts`. Use this reference when adding a completion trigger or tracking down why two sources fight for the same keystroke.

Because multiple `autocompletion()` extensions conflict, every source — wikilinks, tags, emoji, frontmatter properties, task metadata, `query` block keys, and `.settings` fields — lives in one `override` array. The `.settings` editor uses a separate extension (`settingsComplete.ts`) registered only on the vault's `.settings` file. Each source is a pure `CompletionSource` function with a matching pure helper (in `wikilink.ts`, `tag.ts`, `emoji.ts`, `templateToken.ts`) that can be unit-tested without a browser.

---

## How Completion Works (Shared Infrastructure)

Every source applies through the shared helper in `app/src/editor/applyCompletion.ts`. `applyCompletion(view, completion, from, to, insert, cursorOffset, trigger?)` replaces `[from, to)` with `insert`, puts the caret `cursorOffset` chars past `from`, and dispatches a single `view.dispatch({changes, selection, annotations: pickedCompletion.of(completion)})`. Using `pickedCompletion.of` is mandatory so CodeMirror's internal bookkeeping (closing the popup, etc.) stays correct. `autocomplete.ts` imports it under the alias `applyInsert` (`import { applyCompletion as applyInsert } from "./applyCompletion"`); `taskComplete.ts` and `queryComplete.ts` use the `makeApply(insert, cursorOffset, trigger?)` factory in the same module, which returns a ready-made `Completion.apply` handler that calls `applyCompletion` with those fixed args. This is one place, not copy-pasted across `taskComplete`/`queryComplete`/`autocomplete`.

**Trigger-reopen pattern.** When `applyCompletion` is called with `trigger = true` (or `makeApply(..., true)`), it runs `startCompletion(view)` after the dispatch to immediately re-open the popup for the next step — enabling chained completions. Examples: after inserting a task signifier emoji it re-opens to show date / recurrence options, and after picking a query key like `view:`/`group:` it re-opens to show the value list (and `of:`/`from:` insert `[[]]` and re-trigger so the wikilink source can offer base/note names).

`completionDisplayConfig` (from `completionDisplay.ts`) is spread into every `autocompletion({})` call. It sets `icons: false` to suppress CodeMirror's default glyphs, and injects a custom `addToOptions` render hook that places a Lucide icon at position 20 (before the label). Per-row icons can be overridden via `lucideIcon` on the `IconedCompletion` type.

---

## Source Priority Order

Sources are listed in the `override` array in the following order (first match wins per keypress):

1. `propertyKeySource` — frontmatter property key (gated to frontmatter position)
2. `iconValueSource` — `icon:` value (gated to frontmatter)
3. `enumValueSource` — enum property value (gated to frontmatter)
4. `tagListSource` — `tags:` value comma list (gated to frontmatter)
5. `slashSource` — `/` at the start of a line (composer-only opt-out via `slashMenu: false`)
6. `querySource` — inside a ` ```query ` block
7. `taskSource` — on a `- [ ]` task line
8. `templateTokenSource` — `{{token}}` in body or frontmatter
9. `atMentionSource` — `@file` mention (only when the host supplies `getFiles`; composer-only)
10. `wikilinkSource` — `[[wikilink]]`
11. `memoryRefSource` — `??memory-ref` (only when the host supplies `getMemories`)
12. `tagSource` — `#tag`
13. `emojiSource` — `:emoji:`

---

## Wikilink Completion (`[[…]]`)

**File:** `app/src/editor/autocomplete.ts` → `wikilinkSource`, helpers in `wikilink.ts`

**Trigger:** The caret sits inside an open `[[` with no closing `]]` on the same line yet (regex `/\[\[([^\]\n]*)$/`). Fires as soon as `[[` is typed.

**Behavior:**
- Calls `getNotes()` lazily on each popup open to get the current vault's note list.
- Each option shows the note's basename as `label` and its **full parent directory path** (`dirOf(path)`, `''` at vault root) as `detail` — not just the top-level folder.
- The `apply` function inserts `o.target`, not the bare label: `target` is the bare basename (`baseOf(path)`) when it is unique among the vault's notes, but the **full vault path** when another note shares that basename — this is `wikilinkOptions()` (`wikilinkOptions.ts`), counted by `baseOf(path)` over the whole candidate list. It then checks whether `]]` is already immediately ahead of the cursor (to avoid double `]]`); if not, it appends `]]`. In both cases the cursor lands just past the `]]`.
- `validFor: /^[^\]\n]*$/` — the popup stays open as long as the typed text contains no `]` or newline.

**Example:** Typing `[[Proj` opens a popup listing all notes; picking "Project Alpha" (a unique basename) inserts `[[Project Alpha]]` with the cursor after `]]`. If a second note anywhere in the vault is also named "Project Alpha.md", picking either one instead inserts its full path, e.g. `[[work/Project Alpha]]`.

**Note resolution:** `resolveNotePath` in `wikilink.ts` matches exact vault paths first, then basenames via `pickByBase` (`core/src/linkTarget.ts`). `[[My Note]]` matches `reading/My Note.md` by basename. A basename collision is no longer left undefined — `pickByBase` deterministically picks one match via `preferId` (shortest path wins; a tie breaks alphabetically).

---

## Memory Reference Completion (`??slug`)

**File:** `app/src/editor/autocomplete.ts` → `memoryRefSource`, grammar in `core/src/memoryRef.ts`

A memory reference is to a **3rd-brain memory note** exactly what a `[[wikilink]]` is to a vault
note: a plain reference. `??slug` is the **syntax, not just a trigger** — it persists verbatim in the
saved markdown and is re-resolved every time the file is read.

**Trigger:** `??` preceded by start-of-line or whitespace, followed by zero or more slug chars
(regex `/(?:^|\s)\?\?([\w/-]*)$/`). Fires as soon as `??` is typed, like `[[`. The
start-of-line/whitespace rule keeps prose punctuation (`really??`) literal.

**Surfaces:** the note editor **and** the chat composer — both mount `markdownEditingExtensions`,
so the one source lights up both. Not wired into table cells (no `getMemories` supplied there).

**Behavior:**
- `getMemories()` is read lazily per popup open; candidates come from the graph's `memory` nodes
  (`App.tsx` → `memoryCandidates`, `mem:` prefix stripped via `memorySlugFromNodeId`).
- Each option shows the memory note's basename as `label`; a subfoldered note also shows its
  relative slug as `detail`.
- `apply` inserts the bare slug after the already-typed `??`, so the text becomes `??slug`.
- `validFor: /^[\w/-]*$/`.

**Example:** Typing `??cron` lists `cron-run-preference`; picking it leaves `??cron-run-preference`
in the document — and in the file on disk.

**Resolution:** `resolveMemorySlug` matches the exact slug first, then the basename (mirroring
`resolveNotePath`). A ref points at `.daemon/memory/<slug>.md` (`memoryRefPath`), a real vault path,
so clicking one opens it like any note. Rendering: `??slug` becomes an
`a.bismuth-wikilink.bismuth-memory-ref[data-href]` anchor (`app/src/bases/markdown.ts`) — it reuses
the wikilink class so every existing `bismuth-open` click host navigates it; in-editor it is colored
by `.cm-memory-ref` (violet — a link to the *third* brain) without hiding anything, because `??slug`
is the persisted text.

**Daemon gating:** memory only exists while `settings.daemon.enabled` is on — the server only builds
`<vault>/.daemon/memory` into the graph then. With the daemon off there are no `memory` nodes → no
candidates → the popup never opens. There is no separate gate to keep in sync.

**SRS interaction:** a line that is exactly `??` is the multi-reversed flashcard separator
(`core/src/srs/parser.ts`). A ref requires at least one slug char, so a bare `??` can never parse as
one; and because CodeMirror binds Enter to `acceptCompletion`, `srsSeparatorEnterGuard` (Prec.highest,
registered before `autocompletion()`) closes the popup and lets Enter through as a newline on such a
line. Authoring a flashcard with `??`↵ is unaffected.

---

## Tag Completion (`#tag`)

**File:** `app/src/editor/autocomplete.ts` → `tagSource`, helpers in `tag.ts`

**Trigger:** A `#` preceded by start-of-line or whitespace, followed by zero or more word chars / `/` / `-` (regex `/(?:^|\s)#([\w/-]*)$/`). This intentionally excludes markdown headings (`# Heading`) and mid-word `#` like `C#`.

**Behavior:**
- `getTags()` returns bare tag names (no leading `#`), read lazily.
- Inserts the bare tag name after the existing `#`; cursor lands at the end of the inserted name.
- `validFor: /^[\w/-]*$/` — popup stays open during continued typing of tag characters including nested separators like `/`.

**Example:** Typing `#prog` shows `programming`, `project`; picking `programming` inserts `programming`, resulting in `#programming`.

---

## Frontmatter Property Completions

**File:** `app/src/editor/autocomplete.ts` → `propertyKeySource`, `iconValueSource`, `enumValueSource`, `tagListSource`

All frontmatter completions are gated by the `inFrontmatter(ctx: CompletionContext) => boolean` predicate passed to `vaultCompletion`. They fire only when the cursor is between the `---` YAML fences.

**The schema behind Property Key and Enum Value completion is a live registry, not a static
snapshot.** `app/src/propertyRegistry.ts` holds it as a Solid signal, seeded empty (`{}`) so no
consumer derefs it before the first fetch resolves, then hydrated two ways: once at boot
(`refreshPropertyRegistry()` → `api.schema()` → `GET /schema`), and again on every relevant SSE
change — a `createEffect` on `lastChange()` (`app/src/serverVersion.ts`) calls
`registryShouldRefresh(paths)`, which returns `true` whenever any changed path is a settings path
(`isSettingsPath`) or the path list is empty (unknown extent — the initial snapshot or the
`/version` fallback poll, when it's safer to assume it may have changed). So editing `.settings` to
add or retype a property — in this window, another pane, or the CLI — updates what `Property Key`
and `Enum Value` completion offer without a reload. `Editor.tsx` is the consumer: it passes
`propertyRegistry` (the accessor) into the completion/lint wiring and re-runs whenever the signal
updates.

### Property Key Completion

**Trigger:** The current line has no `:`, is not indented, and contains only `[\w-]` characters (a partial key at column 0).

**Behavior:**
- Calls `keySuggestions(schema, query)` from `core/src/schema/suggest.ts` which returns keys that case-insensitively start with the typed prefix, sorted alphabetically.
- Returns `null` (no popup) if there are no matching keys.
- Inserts `name: ` (with trailing space and colon) so the cursor lands ready to type the value.
- `validFor: /^[\w-]*$/`.

**Example:** Typing `ty` on a blank frontmatter line suggests `type` from the vault's property schema. Selecting it inserts `type: `.

### Enum Value Completion

**Trigger:** Line matches `/^([\w-]+):\s*(.*)$/` and the key is registered in the schema with an enumerable type (`boolean` or `{ kind: "enum", values: [...] }`).

**Behavior:**
- Calls `valueSuggestions(type, typedPrefix)` from `suggest.ts` which filters values by case-insensitive prefix match.
- Returns `null` if no values match or the key is not in the schema.
- `validFor: /^[^,\n]*$/`.

**Example:** On a `type: ` line where `type` is schema-registered as an enum `["note", "base", "person"]`, typing `b` suggests `base`.

### Icon Value Completion (`icon:`)

**Trigger:** Line matches `/^icon:\s*(.*)$/` (exact key match).

**Behavior:**
- Fetches Lucide icon names from `getIconNames()` (kept out of this module because Lucide can't load outside a DOM).
- Ranks: prefix matches first, then substring matches, capped at 50 results.
- `validFor: /^[^\n]*$/`.
- Emoji are also allowed in the `icon:` field — this source only *suggests* Lucide names, never blocks other input.

**Example:** `icon: arr` suggests `ArrowLeft`, `ArrowRight`, `ArrowUp`, etc.

### Tag List Value Completion (`tags:`)

**Trigger:** Line matches `/^tags:\s*(.*)$/` (exact key match).

**Behavior:**
- Completes the current segment after the last comma in the comma-separated list.
- Strips leading whitespace from the segment before comparing.
- Calls `normalizeTag` on each candidate before display.
- Case-insensitive prefix filter.
- `validFor: /^[^,\n]*$/` — popup stays open until a comma is typed (which starts a new segment).

**Example:** `tags: prog, pers` → positions completion at `pers`, offering tags that start with `pers`.

---

## Slash Block-Insert Menu (`/`)

**File:** `app/src/editor/slashComplete.ts` → `slashSource`, catalog + pure matcher in `slashMenu.ts`

**Trigger:** The `/` must be the **first content character on the line** (Notion-style), ignoring leading indentation and an optional list/number marker — `/^(\s*(?:[-*+]\s+|\d+[.)]\s+)?)\/(\w*)$/` (`matchSlashPrefix`). This is what keeps the menu quiet on a mid-text slash (`and/or`, a file path, `TODO: 6/9`) while still firing after a `- ` bullet or `1. ` number. Gated out of frontmatter (the property sources own that position) and out of a fenced code/query block (`inCodeFence`).

**Behavior:**
- `filterSlashItems` ranks the catalog against the typed query in three tiers — exact label/keyword match, prefix match, subsequence match (`tbl` finds "table", `h1` finds "Heading 1") — ties keep declared order; an empty query returns the whole catalog in declared order.
- Each item's `apply` replaces the `/query` span with its `snippet`, a literal string with a single `$0` marking where the caret lands (`parseSnippet`). An item with `reTrigger: true` calls `startCompletion(view)` after inserting, so e.g. picking "Link to note" immediately re-opens completion with the wikilink source live inside the fresh `[[]]`.
- `filter: false` (the source owns ranking) and no `validFor` — it re-queries every keystroke, so the list narrows live and a space or other non-word character closes the menu.

**Item catalog** (`SLASH_ITEMS` in `slashMenu.ts`, in declared/default order), plus one dynamic item (today's date) appended after it:

| Item | Snippet inserted | Notes |
|---|---|---|
| Heading 1 / 2 / 3 | `# `, `## `, `### ` | |
| Bulleted list | `- ` | |
| Numbered list | `1. ` | |
| Task | `- [ ] ` | |
| Quote | `> ` | |
| Callout | a `> [!note]` block | |
| Table | a starter GFM pipe table | |
| Code block | a ` ``` ` fence | |
| Query block | a ` ```query ` fence | `reTrigger: true` — re-opens completion so `querySource` can offer keys inside the fresh fence |
| **Query builder** | *(no snippet — opens a modal instead)* | `action: 'queryBuilder'`; only offered when the host supplies `getHostPath` (the note Editor only, never the chat composer or a table cell) — see below |
| Graph block | a ` ```graph ` fence | embedded editable node/edge graph |
| Math block | a `$$` block | |
| Divider | a leading blank line + `---` | the blank line forces a real `<hr>` rather than a SETEXT heading underline |
| Page break | `<!-- pagebreak -->` | invisible on screen; the PDF exporter slices a new page at it |
| Link to note | `[[]]` | `reTrigger: true` |
| Embed | `![[]]` | `reTrigger: true` |
| Properties | a `---`/`tags: `/`---` frontmatter block | `when: 'docStart'` — offered only when the `/` sits at the true start of the document (line 1, column 0) **and** no frontmatter block already exists below, so a stray `/` above existing frontmatter can't insert a second `---` block |
| Today's date | today's ISO date | built dynamically (`dateItem()`), not part of the static catalog, so it can't go stale |

**The "Query builder" item** deletes the `/…` trigger text, opens the `QueryBuilder` modal (dynamically imported, since it transitively pulls in a Solid component bun's headless test transform can't compile), and on confirm inserts the generated ` ```query ` fence at the trigger's original position; on cancel nothing is inserted. The position-tracking lives in `queryBuilderInsert.ts`.

---

## `@`-Mention Completion (chat composer only)

**File:** `app/src/editor/autocomplete.ts` → `atMentionSource`, matcher in `atMention.ts`

Lets the chat composer's `@file` mention reference any vault file, wired into the same shared `override` array as every other source but gated on `opts.getFiles` — the note editor and table cells supply no `getFiles`, so the source is simply absent there (`atMentionSource` is never added to the array).

**Trigger:** `matchAtMentionPrefix` (`atMention.ts`), and only outside code (`inCode`/`inInlineCode` both return `false`) — `@` is left literal in a code span or block (decorators, npm scopes).

**Behavior:**
- `rankFileCandidates(getFiles(), query)` ranks the full vault file list against the typed query, capped at 50 results; each option shows the file's label with its folder as `detail`.
- `filter: false` (own ranking) and no `validFor` — re-queries every keystroke, mirroring the emoji source.
- `apply` fires the optional `onPick(path)` callback (so `ChatView` can wire the picked file into the chat's context via `chatContext.ts`) and inserts `[[Name]] ` — built from the display label, so the popup pick and the inserted text always agree — with the caret parked just past the trailing space.

---

## Template Token Completion (`{{token}}`)

**File:** `app/src/editor/autocomplete.ts` → `templateTokenSource`, helpers in `templateToken.ts`

**Trigger:** The caret is inside an open `{{` with no matching `}}` already closed, and the text after `{{` matches `/^[\w+:-]*$/`. Fires in BOTH the document body and frontmatter.

**Tokens offered** (from `core/src/templates.ts` `TEMPLATE_TOKENS`):

| Token | Description |
|---|---|
| `{{date}}` | Current date (YYYY-MM-DD). Supports offset (`{{date+1d}}`) and format (`{{date:YYYY-MM}}`). |
| `{{time}}` | Current time (HH:mm). Supports offset (`{{time+1h}}`) and format (`{{time:h:mm A}}`). |
| `{{title}}` | Note's filename without `.md`. |
| `{{cursor}}` | Where the caret lands after template insertion. |

Each option has an `info` tooltip with its documentation string.

**Behavior:** Selecting an option replaces the whole `{{…` prefix (from `open` to cursor) with the full token string. The cursor lands just past the closing `}}`.
`validFor: /^\{\{[\w+:-]*$/` — popup stays open as offset/format is typed.

**Note:** `templateTokenSource` deliberately does not collide with other sources because it only matches an unclosed `{{` prefix, which no other trigger uses.

---

## Emoji / Special Character Completion (`:emoji:`)

**File:** `app/src/editor/autocomplete.ts` → `emojiSource`, helpers in `emoji.ts`

**Trigger:** A `:` preceded by start-of-line or whitespace, followed by zero or more `[A-Za-z0-9_+-]` and an optional closing `:` (regex `/(?:^|\s)(:[A-Za-z0-9_+-]*:?)$/`). A lone `:` matches (empty query) so the popup opens instantly. Does NOT fire when inside an open `[[` (the wikilink source takes precedence there).

**Behavior:**
- `filter: false` — CodeMirror's built-in label filter is disabled. The source owns all ranking so keyword matches (`:happy` → 😄) work even though the label starts with the glyph, not the query.
- No `validFor` — re-queries on every keystroke.
- The `apply` callback inserts the raw glyph character, replacing the full `:query[:]` span (both `from` and `to` are set).
- The popup is **emoji only** — the best-matching glyph is always the first, default-selected option, so `:rocket`↵ inserts 🚀 (#67). It carries **no "Open emoji gallery" row** (an earlier version did, pinned last, but it still drew the eye and, in some builds, floated above the match). The full emoji library now lives behind the always-visible **`emoji-library`** toolbar command / palette entry (`h.openEmojiLibrary` → `openGallery({ source: emojiSource })` → `insertIntoFocusedEditor`), not inside this list. When nothing matches (e.g. `:zzzz`) the source returns `null`, so no empty popup appears. Ordering is pinned by `app/src/editor/emojiSource.test.ts` (covers both the note editor and the in-cell table editor, which share this source via `vaultCompletion()`).

**Search algorithm** (in `emoji.ts` `rankEmoji`):

1. **Empty query:** returns the curated most-used 40 emojis in popularity order (face_with_tears_of_joy, red_heart, etc.).
2. **Tiered precise match:** six tiers sorted by ascending score: exact shortcode, shortcode-prefix, exact keyword, shortcode-substring, keyword-prefix, keyword-substring. Ties broken by popularity rank → shorter shortcode → alphabetical → glyph codepoint.
3. **Fuzzy phase** (query ≥ 3 chars): Damerau-Levenshtein edit distance over individual name tokens (shortcode split on `_`, keywords). Max edits: 1 for ≤3 chars, 2 for ≤6, 3 for longer. Fuzzy results are appended after precise matches. This allows `:rocekt` → 🚀, `:hart` → ❤️, `:smlie` → 🙂.
4. Results are deduped by glyph (some emojis have alias shortcodes), capped at 50.

**Gotcha:** Queries with no letter/digit characters (`:_`, `:-`) return an empty list.

**Right-click quick-action rail (#67).** Besides `:emoji:` autocomplete and the `emoji-library` toolbar command, the emoji gallery is reachable from a **rail hanging off the left edge of the right-click context menu** — always visible on every right-click, outside the option list (not buried among Cut/Copy/Paste/fix actions), one click. `app/src/editor/emojiQuickAction.ts` `emojiQuickAction({ focus, insert? })` builds the shared `QuickActionSpec` (a `Smile`-icon "Emoji library" action) used by both the note-editor menu (`editor/contextMenu.ts`) and the in-cell table menu (`editor/tableWidget.ts`). It re-focuses the surface, then dispatches the `bismuth-open-emoji-library` window event that `App.tsx` listens for to pop the gallery and insert the glyph. The module is deliberately dependency-free (no `@codemirror/*`, no Solid) so `tableWidget.ts`'s headless unit tests stay import-light. The note editor omits `insert` (App's default targets the last-focused editor caret); a **table cell passes its own `insert`** because CodeMirror's outer selection never tracks a cell edit (the cell is a contenteditable island), so the default would drop the glyph at a stale position elsewhere in the note.

---

## Task Metadata Completion

**File:** `app/src/editor/taskComplete.ts` → `taskSource`

This source provides inline task-field discovery on checkbox task lines,
inserting bracket fields (`[due 2026-09-14]`, `[every week]`, `[high]` — see
[task syntax](../tasks/syntax.md)) exclusively. `core/src/tasks.ts` no longer
reads the old Obsidian-Tasks emoji signifiers at all — `core/src/taskLegacy.ts`
holds that reader now, for migration only — so there is nothing left to
complete inside one: a signifier still sitting in an un-migrated note is
inert description text to the parser, and this source offers no value
context for it. It operates in three modes depending on what is immediately
before the cursor.

**Line guard:** `taskDescStart(lineText)` checks that the current line matches `/^(\s*[-*+] \[.\] )/` and returns the column where the task description begins. The source returns `null` when the cursor is in the bullet/checkbox prefix rather than the description.

### Mode 1: Keyword → Bracket Field

**Trigger:** The trailing word before the cursor is a "keyword" context — no open date/recurrence bracket immediately before it (see modes 2/3). Suppressed unless `context.explicit` is true OR the typed word is ≥ 2 characters. `classifyTaskContext` runs **two separate matches**, each with its own guard, rather than one combined regex with an optional `[?`:
- The **bracket arm**, `/(?<!\[)\[([\p{L}]+)$/u`, fires on a keyword typed right after an **open bracket** the user typed by hand (`[due`); `from` is set to the bracket's own position rather than past it, so accepting the completion **replaces** the existing `[` instead of inserting a second one next to it. Its only guard is `(?<!\[)` (keep a wikilink's second `[` out) — a preceding **letter** is allowed, so `pay[due` completes too, matching what `parseFields` (`core/src/taskFields.ts`) already accepts.
- The **bare-word arm**, `/(?<![\p{L}\[])([\p{L}]+)$/u`, fires on a bare keyword with no open bracket. Its lookbehind excludes a preceding letter as well as `[`, which is what keeps `[[due` (a wikilink being typed) from matching a truncated `ue` and completing into the middle of it.

**Behavior:** Calls `matchTaskFields(query)` which returns all `TASK_FIELDS` entries where any keyword starts with the query (case-insensitive). Selecting a field inserts the bracket opener (and, for a bare priority field, the whole closed bracket) then, for a dated or recurring field, calls `startCompletion(view)` to immediately re-open the popup for the value (mode 2 or 3).

**All keyword mappings:**

| Keywords | Inserted | Follow mode |
|---|---|---|
| `due` | `[due ` | date |
| `scheduled` | `[scheduled ` | date |
| `start`, `starts` | `[start ` | date |
| `repeat`, `recurring`, `recur`, `every` | `[every ` | recurrence |
| `priority`, `highest`, `urgent` | `[highest]` | (none) |
| `priority`, `high` | `[high]` | (none) |
| `priority`, `medium` | `[medium]` | (none) |
| `priority`, `low` | `[low]` | (none) |
| `priority`, `lowest` | `[lowest]` | (none) |
| `done`, `completed` | `[done ` | date |
| `created` | `[created ` | date |
| `cancelled`, `canceled` | `[cancelled ` | date |

`filter: false` is set so CodeMirror does not re-filter the labels by typed text.

**Example:** Typing `due` on a task line shows `due date`; picking it inserts `[due ` and re-opens completion. Typing `[due` by hand and picking the same completion replaces the whole `[due` with `[due `, rather than doubling the bracket into `[[due `.

### Mode 2: Date Value

**Trigger:** An open date-field bracket (`[due `, `[scheduled `, `[start `, `[done `, `[created `, or `[cancelled `) is immediately before the cursor, optionally followed by partial `[\w-]` text.

**Behavior:** Offers relative date labels that resolve to ISO dates using `relativeDateOptions(today)`, closing the bracket on selection.

**Options (relative to today, plus the seven upcoming weekdays):**

| Label | ISO result |
|---|---|
| `today` | today's date |
| `yesterday` | today − 1 day |
| `tomorrow` | today + 1 day |
| `in 2 days` | today + 2 days |
| `in 3 days` | today + 3 days |
| `in a week` | today + 7 days |
| `in two weeks` | today + 14 days |
| `monday` … `sunday` | the next occurrence of that weekday, 1–7 days out |

Each completion's `detail` shows the resolved ISO date (e.g. `2026-06-15`). Selecting replaces the partial word with the ISO date and closes the bracket (`2026-06-15]`). `validFor: /^[\w-]*$/`.

**Example:** After typing `[due ` and then `to`, the popup shows `today` (detail: `2026-06-08`) and `tomorrow` (detail: `2026-06-09`); picking `today` completes the field to `[due 2026-06-08]`.

### Mode 3: Recurrence Value

**Trigger:** An open `[every ` is immediately before the cursor, optionally followed by partial text.

**Behavior:** Offers six canned recurrence rules, closing the bracket on selection:

- `every day`
- `every week`
- `every weekday`
- `every month`
- `every year`
- `every 2 weeks`

`validFor: /^[\w ]*$/` — stays open while the user types spaces and words. Picking one completes the field to e.g. `[every week]`.

---

## Query Block Completion

**File:** `app/src/editor/queryComplete.ts` → `querySource`

Provides context-aware completion inside ` ```query ` fenced code blocks. Covers the flat query spec keys, view types, Bases filter snippets for `where:`, and group fields. Task filtering is not a separate DSL any more — `where:` offers the same Bases filter language `source: notes` uses (see [filters](../bases/filters.md)); see [the ```query block](../bases/query-block.md) for the full key reference and the legacy-DSL translation shim.

**Block detection:** `lineInQueryBlock(lines, index)` runs a fenced-code state machine over lines up to and including the cursor line. Each ` ``` ` toggles in/out; the language tag on the opening fence must be `query`. Works on an unclosed block (user still typing). A line that IS the `\`\`\`` fence itself is NOT considered a body line.

**Classification:** `classifyQueryLine(textBefore)` examines the text before the cursor on the current line and returns one of five kinds:

| Kind | Pattern | Example |
|---|---|---|
| `view` | `/^\s*(?:view\|as):\s*([\w-]*)$/` | `view: tab` |
| `group` | `/^\s*group:\s*([\w.-]*)$/` | `group: st` |
| `where` | `/^\s*where:\s*(.*)$/` | `where: !note.res` |
| `ref` | `/^\s*(of\|from):\s*$/` (empty value only) | `of: ` |
| `key` | `/^(\s*)([\w-]*)$/` (no colon) | `wh` |

A `tasks:` or `sort:` value has no dedicated kind — typing after either falls through with no completion offered.

### Key Completion (kind: `key`)

Triggered on a line with no `:` yet (a partial key name, optionally indented). Offers all eight spec keys:

| Key | Inserted skeleton | Cursor after | Re-triggers |
|---|---|---|---|
| `of` | `of: [[]]` | after `[[` | yes |
| `tasks` | `tasks: ` | after space | no |
| `from` | `from: [[]]` | after `[[` | yes |
| `where` | `where: ` | after space | yes |
| `sort` | `sort: ` | after space | no |
| `view` | `view: ` | after space | yes |
| `group` | `group: ` | after space | yes |
| `limit` | `limit: ` | after space | no |

`validFor: /^[\w-]*$/`. Each option shows a doc tooltip.

### View Type Completion (kind: `view`)

**Trigger:** After `view: ` or `as: `. All 12 view types from `VIEW_TYPES` are offered:

`table`, `cards`, `list`, `bullets`, `kanban`, `map`, `calendar`, `flashcards`, `bar`, `line`, `stat`, `heatmap`

Each has a brief doc tooltip (e.g. `table` → "Rows × columns grid.").

### Bases Filter Completion (kind: `where`)

**Trigger:** After `where: `. Offers starter Bases-filter snippet completions — the same filter language `source: notes` uses. No `validFor` (multiword snippets, re-queries every keystroke):

| Snippet | Description |
|---|---|
| `!note.resolved` | Open tasks only. |
| `note.resolved` | Completed or cancelled tasks. |
| `note.due == today()` | Due on today's date. |
| `note.placed < today()` | Overdue (scheduled or due before today). |
| `note.priority == "high"` | High-priority. |
| `note.recurring` | Recurring tasks. |
| `file.hasTag("book")` | Notes tagged #book. |

### Group Field Completion (kind: `group`)

**Trigger:** After `group: `. Offers common group fields with dot-notation:

| Field | Description |
|---|---|
| `status` | Task status. |
| `priority` | Task priority. |
| `due` | Due date. |
| `scheduled` | Scheduled date. |
| `file.folder` | Containing folder. |
| `file.name` | Note name. |

`validFor: /^[\w.-]*$/`.

### Ref Completion (kind: `ref`)

**Trigger:** After `of: ` or `from: ` with an empty value (no `[[` yet). Offers a single `[[ … ]]` skeleton option. Selecting it inserts `[[]]` with the cursor between the brackets and re-triggers completion — at that point the wikilink source takes over to offer note/base names.

---

## Settings YAML Completion

**File:** `app/src/editor/settingsComplete.ts`

A fully separate `autocompletion()` extension. `Editor.tsx` only wires it in (alongside `yamlSchema({ mode: "settings" })`) when `isSettingsBuffer(path)` is true — `isSettingsBuffer` (`app/src/editor/settingsBuffer.ts`) does an exact-path match against `SETTINGS_FILE` (`app/src/tabIds.ts`, `".settings"`), the vault's single hidden, extensionless settings file — not a filename pattern or extension check. Schema-aware, nested-structure-aware completion for every key and value in Bismuth's settings file.

### Nesting / Scope Resolution

`scopeAt(root, ctx, lineNumber, indent)` walks up from the cursor line to find the nearest enclosing section header (`key:` with no inline value, less-indented than the cursor). That header's nested `fields` become the active schema. At indent 0, the root schema (top-level sections like `appearance`, `graph`, `editor`, etc.) is in scope.

For `- key: value` list-item lines, `enclosingListItemType` resolves the enclosing list's item type so scalar enum lists (e.g. `toolbar.commands:`) can complete their members.

### Key Completion

**Trigger:** A `- ` or plain partial word at the start of a line with no `:` yet, and the cursor is at a position where a key name is expected.

**Behavior:**
- Finds the schema in scope at the current indent.
- Does NOT fire inside the `properties:` section (user-defined property names are free-form).
- Each option shows `type rangeLabel` as `detail` (e.g. `number 11–28`, `enum dark | light`) and the `doc` string as `info` tooltip.
- `validFor: /^[\w-]*$/`.

**Example:** In the `appearance:` block, typing `ui` suggests `uiFont` (detail: `enum Monaspace Xenon | Monaspace Neon | Monaspace Argon | Monaspace Krypton | Monaspace Radon`) and `uiFontSize` (detail: `number 11–16`).

### Enum / Boolean Value Completion

**Trigger:** Line matches `key: <partial>` or `- key: <partial>`.

**Behavior:**
- Calls `valueOptions(fieldType)` which returns the enum values or `["true", "false"]` for boolean.
- Case-insensitive prefix filter.
- `validFor: /^[\w:-]*$/` (widened to allow `:` in `daily-note:<id>` values).
- Returns `null` without at least 1 typed character unless `context.explicit`.

### Icon-Typed Field Completion

**Trigger:** The key resolves to a schema entry with `type === "icon"`.

**Behavior:**
- Always-first "Open icon gallery" option (type `"gallery"`, icon `Grip`) which dynamically imports the gallery and, on pick, replaces `[from, end-of-line)` with the chosen icon name.
- Then Lucide icon names filtered by case-insensitive prefix, each showing its own icon in the completion row (`lucideIcon: name`), capped at 50.
- `filter: false` — no CM re-filter (case-insensitive matching is owned here).

### Keybind-Typed Field Completion

**Trigger:** The key resolves to `type === "keybind"` (any key in `settings.keybindings.*`). The full value including spaces and commas is captured first (the `fullVal` branch) rather than the generic `\S*` match.

**Behavior:** `keybindCompletions(ctx, valueSoFar)` builds completions for the current token (text after the last `+` within the current `,`-separated combo alternative).

**Options provided:**

1. **"Record shortcut…"** (always at top if no query or query starts with `rec`): Attaches a 3-second keyboard listener (`recordShortcut(view, valueFrom)`), shows a toast "Recording shortcut… press keys", captures the first non-modifier `keydown` event, converts it via `eventToCombo(e)`, and replaces the whole value (from `valueFrom` to end of line). Bare modifier presses are ignored until a real key is struck. Physical key is preferred over produced key (so `Alt+S` records as `Alt+S`, not `Alt+ß`).

2. **Modifier completions** (type `"modifier"`, boost 10): Available modifiers from `KEYBIND_MODIFIERS`: `Mod`, `Alt`, `Shift`, `Cmd`, `Ctrl`, `Meta`. The modifier family of any already-typed modifier in the current combo is hidden (e.g. once `Mod` is typed, `Cmd`/`Ctrl`/`Meta` disappear). Each modifier appends `+` on apply so the user keeps building the combo.

3. **Key completions** (type `"key"`): All entries from `KEYBIND_KEYS`: A-Z, 0-9, named keys (`ArrowLeft`, `ArrowRight`, `ArrowUp`, `ArrowDown`, `Enter`, `Escape`, `Tab`, `Space`, `Backspace`, `Delete`, `Home`, `End`, `PageUp`, `PageDown`, `Insert`, F1-F12), and punctuation (`` ` ``, `-`, `=`, `[`, `]`, `\`, `;`, `'`, `,`, `.`, `/`).

Modifier families: `mod` covers `Mod`/`Cmd`/`Ctrl`/`Meta`; `alt` covers `Alt`/`Option`/`Opt`; `shift` covers `Shift`. Once a family is used in the combo, all its siblings are hidden.

`validFor: /^[^\s,+]*$/` — ends at space/comma/plus.

**Example:** In `keybindings:`, typing `Mod+Sh` suggests `Shift` (modifier). After picking, the value becomes `Mod+Shift+`; then typing `D` filters keys to `D`.

### Path-Typed Field Completion

**Trigger:** The key resolves to `{ kind: "path", only?: "dir" | "file", scope?: "templates" | "fs" }`. Handled in the `fullVal` branch (not `val`) so paths with spaces work correctly.

**Behavior:**
- `scope: "templates"` sources from `getTemplatePaths()` (template files only).
- `scope: "fs"` sources from the **real filesystem** (for paths OUTSIDE the vault). See "Filesystem-Path Completion" below. No setting in the current schema declares `scope: "fs"`, so this branch is presently dormant — the mechanism exists for any future setting that names an out-of-vault path.
- Otherwise sources from `getVaultPaths()` filtered by `only` (dirs, files, or both).
- `rankPaths(candidates, query)` does case-insensitive ranking: full-path prefix matches first, then basename-prefix matches, then substring. Owns filtering (`filter: false`) so `"templates/"` finds `"Templates/"` folder.
- Each option shows a `Folder` or `File` Lucide icon.
- Capped at 50 results. No `validFor` — re-queries every keystroke.
- Does not fire on an empty value unless `context.explicit`.

### Filesystem-Path Completion (`scope: "fs"`)

The filesystem-rooted counterpart of vault-path completion, for a setting naming a path outside the vault. No schema field currently uses `scope: "fs"` — the `daemon` object has only `enabled`; its machine-identity home is fixed at `~/.bismuth/daemon` (`daemonMachineDir()`), not a setting. The completion path remains wired for any future out-of-vault setting. Because the candidate set lives on disk, this is the one **async** settings completion: `fsPathCompletions` calls the injected `fsPaths(value, only)` (→ `api.listDir` → `POST /list-dir`) and returns a Promise the engine awaits.

- The backend helper `core/src/fsPaths.ts` `listFsPaths(value, only, home?)` splits the typed value into a `<dir>/` + basename, `readdir`s the parent, and returns matching children whose display path preserves the user's `~`/`/` form. No slash yet → interprets the text as a name under home and suggests absolute `~/<name>` rows. Tolerant: a missing/unreadable/non-dir parent or a dangling symlink yields `[]` (never throws). Dirs sort before files. Pure over an injectable `home` (tested with `mkdtemp`, never the real home).
- Relative paths (no leading `~` or `/` and a slash present) are unsupported — there's no working dir to resolve them against — so they return `[]`.
- `POST /list-dir` is a read route (no cache-invalidate/SSE despite POST), beside `/search`.

### Template Token Completion in `dailyNotes.fileName`

**Trigger:** Inside a `dailyNotes:` block on a `fileName:` line, when `matchTemplateTokenPrefix` detects an open `{{`. Handled separately from the body template token source because the YAML-quoted value would otherwise be mis-split by the generic value regex.

**Behavior:** Offers `TEMPLATE_TOKENS` filtered by case-insensitive substring match on the token name. `validFor: /^\{\{[\w+:-]*$/`.

### Toolbar `command:` Field Completion

**Trigger:** The field type is an enum with `allowPrefixes: ["daily-note:"]` (the toolbar `command` enum type).

**Behavior:**
- Offers all command IDs (from the schema's enum values) with their human-readable label as `detail` (via `commandLabel(id)`).
- Also scans the current document for `dailyNotes:` block entries (tolerant line-scan, not a full YAML parse) and adds `daily-note:<id>` entries with the daily note's `label` as detail.
- `validFor: /^[\w:-]*$/`.

### `properties:` Section

Inside the `properties:` section the key completion is suppressed (property names are user-defined and free-form). Value completions offer the property type names: `string`, `number`, `boolean`, `date`, `datetime`, `file`, `list`.

### Bare List Item Completion (`- value`)

**Trigger:** Line matches `/^(\s*)-\s+([\w-]*)$/` (a bare `- ` item with no `:` key).

**Behavior:** Resolves the enclosing `key:` list's item type. If it is an enum (e.g. `toolbar.commands:` which is a list of command ids), offers that enum's values filtered by prefix. Returns `null` otherwise (falls through to key completion for object-list items like `- command:`).

---

## Adding a New Completion Source

1. Write a pure `CompletionSource` function (no CodeMirror-version-dependent side effects).
2. Write a pure trigger-match helper (mirroring `matchWikilinkPrefix`, `matchTagPrefix`) for unit testing.
3. Add the source to the `override` array in `vaultCompletion` (in `autocomplete.ts`) at the appropriate priority position.
4. If the source should only fire on a specific file type (like settings), create a separate `autocompletion({override: [...]})` extension.

---

## Cross-References

- [Bases overview](../bases/overview.md) — the query block spec the `querySource` completes
- Bases filter reference: [filters](../bases/filters.md); legacy Tasks-DSL migration: [tasks](../tasks/query-dsl.md), `core/src/bases/taskDsl.ts`
- Settings schema: `core/src/schema/settingsSchema.ts` and `core/src/schema/types.ts`
- Keybinding catalog: `core/src/keybindings.ts`
- Template expansion: `core/src/templates.ts`

Source: `app/src/editor/autocomplete.ts`, `app/src/editor/applyCompletion.ts`, `app/src/editor/taskComplete.ts`, `app/src/editor/queryComplete.ts`, `app/src/editor/settingsComplete.ts`, `app/src/editor/settingsBuffer.ts`, `app/src/editor/slashComplete.ts`, `app/src/editor/slashMenu.ts`, `app/src/editor/queryBuilderInsert.ts`, `app/src/editor/atMention.ts`, `app/src/tabIds.ts`, `app/src/Editor.tsx`, `app/src/editor/wikilink.ts`, `app/src/editor/wikilinkOptions.ts`, `app/src/editor/tag.ts`, `app/src/editor/emoji.ts`, `app/src/editor/templateToken.ts`, `app/src/editor/completionDisplay.ts`, `app/src/keybindings.ts`, `app/src/propertyRegistry.ts`, `app/src/serverVersion.ts`, `core/src/templates.ts`, `core/src/schema/types.ts`, `core/src/schema/suggest.ts`, `core/src/schema/settingsSchema.ts`, `core/src/bases/types.ts`, `core/src/bases/taskDsl.ts`, `core/src/linkTarget.ts`
