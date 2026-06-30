# The ```query Embedded Block

The ` ```query ` fenced code block is the **one and only** embedded block in Bismuth's markdown. It renders a *view into* a base or the vault's tasks directly inside a note. There is no ` ```base `, ` ```view `, or ` ```tasks ` block — a base itself is a `type: base` markdown file (see [bases overview](./overview.md)), and tasks are queried with `tasks: <dsl>` *inside* a `query` block. This doc covers the two body forms a `query` block accepts (a **full inline base config** vs a **flat query spec**), exactly how each is parsed and rendered, the SOURCE-toggle behavior, autocomplete, and copy-pasteable examples drawn from the source and its tests.

## Where it lives in the code

- `app/src/editor/queryBlock.ts` — the CodeMirror extension that finds every ` ```query ` fence, replaces it with the rendered view (`QueryBlockWidget` → mounts `BaseView`), and implements the SOURCE reveal/collapse for inline editing.
- `core/src/bases/queryBlock.ts` — `parseQueryBlock(src)`, the pure parser for the **flat** spec form. Returns a `QueryBlock`.
- `core/src/bases/parse.ts` — `parseBase(text)`, the pure parser for the **full inline base config** form (the same parser that parses a `type: base` file's frontmatter).
- `app/src/editor/queryComplete.ts` — context-aware autocomplete inside a `query` block (keys, view modes, tasks-DSL starters, group fields).
- `app/src/bases/BaseView.tsx` — the unified host that both forms ultimately render through.

The extension is wired into the editor in `app/src/Editor.tsx` as `queryBlock(() => path)` and the completer in `app/src/editor/autocomplete.ts` as `querySource()`.

## The fence

`queryBlock.ts` matches fences with this regex:

```
/^```query[ \t]*\n([\s\S]*?)\n```/gm
```

Notes from the source:
- The opening line must be exactly ` ```query ` (optionally trailing spaces/tabs), at the start of a line.
- The body is everything between the opening line and the next ` ``` ` on its own line (capture group 1).
- `livePreview.ts` deliberately **skips** `query` fences (it checks `m[1].trim() === "query"`) so it does not also render them as a generic code block — `queryBlock.ts` owns the whole fence replacement.

## Two body forms

Which form a block uses is decided by `looksLikeBaseConfig(body)` in `queryBlock.ts`:

```js
function looksLikeBaseConfig(body) {
  return /^(views|filters|formulas|properties|schema|source)\s*:/m.test(body);
}
```

- If the body declares any top-level key from **`views:` / `filters:` / `formulas:` / `properties:` / `schema:` / `source:`**, it is a **full inline base config** → parsed with `parseBase()` and passed to `BaseView` as the `source` prop:
  ```js
  BaseView({ source: this.source, hostPath, embeddedSource })
  ```
- Otherwise it is a **flat query spec** → parsed with `parseQueryBlock()` and passed to `BaseView` as the `view` prop:
  ```js
  BaseView({ view: parseQueryBlock(this.source), hostPath, embeddedSource })
  ```

These two forms are mutually exclusive — the presence of any base-config key flips the whole block into config mode.

---

## Form 1 — Flat query spec

A flat block is a tiny `key: value` list (one per line). `parseQueryBlock(src)` (`core/src/bases/queryBlock.ts`) parses it:

- It splits on newlines, trims each line, skips blank lines, and for each line splits on the **first** `:` (index `> 0`) into `key` → `value` (both trimmed). Later duplicate keys overwrite earlier ones.
- **YAML block scalars** (`tasks: |-`, also `|`/`>`/`|+`/`>+`): when a value is exactly a block-scalar indicator, the parser gathers the following *more-indented* lines (relative to the key's indent) as a multi-line value, strips the common leading indent, and trims trailing newlines. This lets the Tasks DSL carry a `sort by …` clause on its own line (`runTaskQuery` only honors a whole-line sort, never one inside an ` AND `-joined single line). A dedent back to the key's indent ends the block.
- A query references a base (`of:`) or runs a task query (`tasks:`). **It does not iterate notes itself** — that is a base's job (`source: notes`). A flat block with neither `of:` nor `tasks:` resolves to **no source** and the host renders an empty state.

### Keys

| Key | Meaning |
|-----|---------|
| `of: [[Base]]` | Render that base — resolves to `{ kind: "base", ref: "[[Base]]" }`. **Composes**: it follows the referenced base's *own* source recursively (see [sources & composition](./sources.md)), not just its static rows. |
| `tasks: <dsl>` | Run a task query over the vault's checkbox tasks → `{ kind: "tasks" }`. The `<dsl>` (if present) becomes `source.where`; empty (`tasks:` with nothing after it) = all tasks. The DSL is the Obsidian-Tasks-compatible query language (see [tasks](../tasks/syntax.md)). |
| `from: [[Base]]` | Only meaningful **with** `tasks:`. Scopes task extraction to that base's notes → sets `source.from`. `from:` alone (no `tasks:`) produces **no source**. |
| `view: <type>` | Render mode. The current spelling; legacy alias is `as:`. See valid types below. |
| `as: <type>` | Legacy alias for `view:`. `view:` is preferred; if both are given, `view:` wins (`kv.view ?? kv.as`). |
| `where: <expr>` | A per-view filter — a Bases filter expression applied to the resolved rows. Maps to the view's `filters`. |
| `group: <field>` | Group rows by a property (sets the view's `groupBy.property`, direction `ASC`). |
| `limit: <n>` | Cap the number of rows. Parsed via `Number(...)`. |

### `of:` vs `tasks:` precedence

From `parseQueryBlock`:

```js
if (kv.of) {
  source = { kind: "base", ref: kv.of };
} else if ("tasks" in kv) {
  source = { kind: "tasks" };
  if (kv.tasks) source.where = kv.tasks;
  if (kv.from) source.from = kv.from;
}
```

- `of:` and `tasks:` are **mutually exclusive**; if both appear, **`of:` wins** and the `tasks:`/`from:` keys are ignored.
- `"tasks" in kv` is checked (not truthiness) so a **bare `tasks:`** with no value still creates a tasks source.
- `from:` is only read inside the `tasks:` branch.

### Render mode (`as`) resolution

```js
const mode = kv.view ?? kv.as;
const as = VIEW_TYPES.includes(mode)
  ? mode
  : source?.kind === "tasks" ? "list" : "table";
```

- An explicit valid `view:`/`as:` value is used verbatim.
- An **unknown/missing** view falls back to: `list` for a tasks query, `table` for everything else.

### Valid view types

`VIEW_TYPES` (`core/src/bases/types.ts`) — exactly these 12 strings:

```
table  cards  list  bullets  kanban  map  calendar  flashcards  bar  line  stat  heatmap
```

(`bullets` = a plain markdown bullet list, grouped, no table chrome. `bar`/`line`/`stat`/`heatmap` are charts. See each renderer under `app/src/bases/`.)

### What `parseQueryBlock` returns

A `QueryBlock` (`core/src/bases/types.ts`):

```ts
interface QueryBlock {
  source?: SourceSpec;   // undefined ⇒ empty state
  as: ViewType;          // the render mode
  where?: string;        // kv.where || undefined
  group?: string;        // kv.group || undefined
  limit?: number;        // Number(kv.limit) or undefined
  sort?: SortSpec[];     // not set by the flat parser (left undefined)
}
```

> Gotcha: the flat parser never populates `sort` — there is no `sort:` key in the flat grammar. (Sorting is available in the full inline config form via `views: [{ sort: ... }]`, or by referencing a base with `of:` that defines its own sort.)

### How `BaseView` renders a flat `view`

In `BaseView.loadConfig()`, the `view` prop is turned into a one-view `BaseConfig`:

```js
const config = {
  views: [{
    type: v.as,
    name: capitalize(v.as),
    filters: v.where,
    sort: v.sort,
    groupBy: v.group ? { property: v.group } : undefined,
    limit: v.limit,
  }],
};
return { config, spec: v.source, inlineRows: null,
         basePath: v.source?.kind === "base" ? refToPath(v.source.ref) : undefined };
```

- The rows are resolved **server-side** via `POST /rows {spec}` (`api.resolveRows(loaded.spec)`) when `spec` is set; if `spec` is `undefined` (no `of:`/`tasks:`), rows resolve to `[]` → empty state.
- For `of: [[Base]]`, `basePath` is set to the referenced base's path (`refToPath` turns `[[Base]]` → `Base.md`), which surfaces a base crumb + the Settings/Source chrome.

### Flat-spec examples (copy-paste)

Render the `Calendar` base as a filtered list (from the parser test):

````markdown
```query
of: [[Calendar]]
as: list
where: date == today
```
````

→ `{ source: { kind: "base", ref: "[[Calendar]]" }, as: "list", where: "date == today" }`

All open tasks, default checkbox list:

````markdown
```query
tasks: not done
as: list
```
````

→ `{ source: { kind: "tasks", where: "not done" }, as: "list" }`

Open tasks scoped to one base's notes, shown as a kanban grouped by status:

````markdown
```query
tasks: not done
from: [[Keep]]
as: kanban
group: status
```
````

→ `{ source: { kind: "tasks", where: "not done", from: "[[Keep]]" }, as: "kanban", group: "status" }`

Every task, default list (bare `tasks:`):

````markdown
```query
tasks:
```
````

→ `{ source: { kind: "tasks" }, as: "list" }`

Render the `Books` base as cards, capped at 20 rows:

````markdown
```query
of: [[Books]]
view: cards
limit: 20
```
````

Edge cases that produce **no source** (empty state):

````markdown
```query
as: cards
```
````
→ `source` undefined (no `of:`/`tasks:`).

````markdown
```query
from: [[Keep]]
as: table
```
````
→ `source` undefined (`from:` alone is not a source).

````markdown
```query
from: notes where status == "done"
as: table
```
````
→ `source` undefined. **`from: notes` was removed** — iterating the vault is a base's job, not a query's. Use a `type: base` file with `source: notes where …` instead.

Unknown view fallbacks (from the tests):

- `of: [[X]]` + `view: bogus` → `as` becomes `"table"`.
- `tasks:` + `view: bogus` → `as` becomes `"list"`.

---

## Form 2 — Full inline base config

When the body declares a top-level base key, the whole block body is parsed as a base's YAML config with `parseBase(text)` (`core/src/bases/parse.ts`) — **the exact same parser** used for a `type: base` file's frontmatter (via `parseBaseObject`). This lets you embed a complete multi-view base inline, without a separate base file.

### Recognized top-level keys (any one triggers this form)

`views:`, `filters:`, `formulas:`, `properties:`, `schema:`, `source:`.

### Parsed shape (`BaseConfig`)

`parseBase` returns a `BaseConfig` (`core/src/bases/types.ts`):

```ts
interface BaseConfig {
  filters?: FilterNode;                 // global filter, ANDed with each view's filters
  formulas?: Record<string, string>;    // name -> expression string
  properties?: Record<string, { displayName?: string; hidden?: boolean }>;
  views: ViewConfig[];                  // at least one; defaults to a table if none
  source?: SourceSpec;                  // base-level default source for all views
  schema?: Record<string, string>;      // column -> "text"|"date"|"time"|"number"|"checkbox"|"list"|"link"
}
```

Parser behavior worth knowing (from `parse.ts`):

- **Malformed/non-object YAML** → returns `EMPTY_BASE` = `{ views: [{ type: "table", name: "Table" }] }`. (`safeYaml` swallows YAML errors.)
- **`views:`** is an array of view configs. Each is normalized by `normalizeView`. If `views` is empty/missing, a default `{ type: "table", name: "Table" }` is pushed.
- An **invalid `view.type`** falls back to `"table"`; a missing/empty `name` becomes `"Untitled view"`.
- **`source:`** accepts a string (`source: notes where #book`) OR an object (`source: { kind: tasks, from: "[[X]]" }`) — both coerced by `normalizeSource` (see [sources & composition](./sources.md)). An unrecognized value yields `undefined`.
- **`formulas:`** — each value is stringified.
- **`properties:`** — per-property `{ displayName?, hidden? }`; `hidden: true` drops the property from auto-derived columns.
- A top-level **`columnWidths:`** map configures the first view's table widths (unless that view already declared its own).

> Note: the flat-spec keys (`of:`, `tasks:`, `view:`, `as:`, `group:`, `limit:`) are **not** part of this form. The config form uses the base grammar — `source:`, `views: [{ type, filters, sort, groupBy, limit, … }]`, etc. `looksLikeBaseConfig` only checks for the six config keys above, so a block mixing the two (e.g. `views:` + `of:`) is parsed as a config and the flat keys are ignored.

### `ViewConfig` fields you can set per view

Each entry in `views:` is a `ViewConfig` (`core/src/bases/types.ts`). The full set normalized by `normalizeView`:

- `type` — one of the 12 `VIEW_TYPES` (invalid → `table`).
- `name` — view label (empty → `"Untitled view"`).
- `limit` — number; row cap.
- `filters` — a `FilterNode` (string expr, or `{and|or|not: [...]}`), ANDed with the base-level `filters`.
- `order` — array of property ids to display (e.g. `["file.name", "formula.ppu"]`).
- `sort` — array of `{ property, direction: "ASC"|"DESC" }` (a bare string → `ASC`; `column` accepted as an alias for `property`).
- `groupBy` — `{ property, direction }` (a bare string → `ASC`).
- `summaries` — `{ propertyId: summaryName }`.
- `cardContent` — `"properties"`, `"body"`, or `"tasks"` (cards view; `"tasks"` = body filtered to checklist lines).
- `image`, `imageFit` (`cover`/`contain`), `imageAspectRatio` — cards cover image.
- `columns` — explicit group order / kanban columns.
- `columnWidths` — `{ propertyId: px }` (table).
- `lat`, `lng`, `zoom`, `center` — map view.
- `source` — per-view source override (falls back to `BaseConfig.source`, then `{ kind: "base" }`).
- Calendar bindings: `dateField`, `startTimeField`, `endTimeField`, `recurrenceField`, `categoryField`.
- Flashcards bindings: `frontField`, `backField`, `dueField`, `easeField`, `intervalField`, `bidirectional`.
- Chart bindings: `x`, `y`, `aggregate` (`sum`/`avg`/`count`/`min`/`max`), `bin` (`day`/`week`/`month`).

(For the deep dive on each, see [views](./overview.md).)

### How `BaseView` renders an inline config

In `BaseView.loadConfig()`, the `source` prop (inline YAML) is parsed and its effective source defaults to notes:

```js
const config = parseBase(props.source ?? "");
return { config, spec: config.source ?? { kind: "notes" }, inlineRows: null };
```

- So an inline config **with no `source:`** defaults to `{ kind: "notes" }` — i.e. it iterates the vault's notes. This is the one place an inline `query` block *can* iterate notes (because it is, in effect, a full base). The flat form cannot.
- Rows are resolved server-side via `api.resolveRows(spec)`.

### Inline-config examples (copy-paste)

A single-view base over `#book` notes, sorted by rating, shown as cards:

````markdown
```query
source: notes where tags.contains("book")
views:
  - type: cards
    name: Library
    sort:
      - property: rating
        direction: DESC
    cardContent: properties
```
````

A multi-view inline base (table + kanban) with a global filter and a formula:

````markdown
```query
filters: status != "archived"
formulas:
  ppu: price / pages
views:
  - type: table
    name: All
    order: [file.name, status, formula.ppu]
  - type: kanban
    name: Board
    groupBy: status
```
````

An inline base with **no `source:`** (defaults to `{ kind: "notes" }`, iterating the vault):

````markdown
```query
filters: file.folder == "reading"
views:
  - type: list
    name: Reading
```
````

A config that composes another base via a `source:` object:

````markdown
```query
source:
  kind: base
  ref: "[[Master Library]]"
views:
  - type: table
    name: Mirror
```
````

---

## SOURCE toggle and inline editing

Because the fence is **replaced** by the rendered view, the raw query is normally hidden. The rendered view exposes a **SOURCE** icon (the `Code`/`X` button in `BaseView`'s `ViewBar`). The behavior differs for embedded blocks vs base files:

- For an **embedded ` ```query ` block**, `BaseView` is mounted with an `embeddedSource = { onReveal }` callback. Clicking SOURCE calls `onReveal`, which (in `queryBlock.ts`) locates this block's current document index (by DOM position via `posAtDOM`, robust to edits above) and **reveals the raw fence inline** in the editor, dropping the caret into the body (`selection.anchor = bodyFrom`). You then edit the fence like any other markdown — it auto-saves with the note; there is **no separate save dialog**.
- The revealed source is shown in the editor's monospace code font (`.cm-query-body`, `'Monaspace Xenon', ui-monospace, monospace`), and the body lines carry 1-based in-block line numbers (matching fenced code); the ` ```query ` and closing ` ``` ` fence lines do not get numbers.
- The block **collapses back** to the rendered view automatically as soon as the caret leaves it. Two mechanisms drive this:
  - `revealedField.update` removes a revealed index when a selection move or doc change puts the caret outside the block's `[from, to]` range.
  - `collapseOnClickOutside` (a `mousedown` handler) closes any revealed block when you click outside it — needed because clicking the rendered task widgets below doesn't move the caret (they swallow the event). It never prevents the click itself.
- The `embeddedSource` callback differs from a real **base file**'s SOURCE toggle: a `type: base` file (opened via `path`) toggles an in-pane textarea `SourceEditor` (with Save/Cancel) instead of revealing fence text in an editor.

> Implementation detail: `revealedField` is a `StateField<Set<number>>` keyed by the document-order index of each fence; `toggleQuerySource` is the effect that flips a block in/out of the revealed set. `buildDecorations` either replaces a block with a `QueryBlockWidget` (rendered) or, when revealed, leaves it as raw numbered lines.

## Autocomplete inside a ```query block

`querySource()` (`app/src/editor/queryComplete.ts`, wired in `autocomplete.ts`) provides context-aware completion **only inside** a `query` fence body. It is split into two pure, tested helpers:

- `lineInQueryBlock(lines, index)` — a fenced-code state machine. Each ` ``` ` toggles in/out of a block; the **opening** fence's language tag decides whether the block is a `query`. Works on an **unclosed** block (the common case while typing), since it only inspects lines above the cursor. The opening and closing fence lines themselves are **not** body lines.
- `classifyQueryLine(textBefore)` — classifies the text before the caret into what to complete. Value handlers are checked before the generic key handler (the key form requires no colon yet).

### Completion contexts

| Position | Completion offered |
|----------|-------------------|
| Fresh/partial key (indent + word, no colon) | The 7 flat keys, **in this order**: `of`, `tasks`, `from`, `where`, `view`, `group`, `limit`. Each inserts its skeleton and (where useful) re-opens the popup. |
| After `view: ` or legacy `as: ` | All 11 view types shown (the `VIEW_DOCS` list — note: this map omits `calendar` but includes `kanban`, `bullets`, etc.; the popup shows `VIEW_TYPES` labels). |
| After `group: ` | Common group fields: `status`, `priority`, `due`, `scheduled`, `file.folder`, `file.name`. |
| After `tasks: ` | Starter Tasks-DSL snippets: `not done`, `done`, `due today`, `due before tomorrow`, `due after today`, `scheduled today`, `priority is high`, `priority is highest`, `is recurring`, `sort by due`, `sort by priority`. |
| Empty `of: ` or `from: ` | A `[[ … ]]` skeleton; once you type `[[`, the existing wikilink source owns the popup (so the dedicated handler only matches the empty case). |
| `where: …` | No dedicated completion (returns null). |

Key-skeleton inserts (from `KEY_SPECS`):

- `of` → `of: [[]]`, caret inside `[[`, re-triggers (hands off to wikilink/base completion).
- `tasks` → `tasks: `, re-triggers (tasks-DSL list).
- `from` → `from: [[]]`, caret inside `[[`, re-triggers.
- `where` → `where: `, no re-trigger.
- `view` → `view: `, re-triggers (view-type list).
- `group` → `group: `, re-triggers (group fields).
- `limit` → `limit: `, no re-trigger.

> Note: the autocomplete only assists the **flat** spec. The full inline base config form has no dedicated query-block completer (it shares the base/YAML editing experience).

## Rendering pipeline summary

1. `queryBlock.ts` finds each ` ```query ` fence and, unless revealed, replaces it with a `QueryBlockWidget`.
2. The widget mounts `BaseView` with either `source` (inline config) or `view` (flat spec), plus `hostPath` (the current note's path — used so an embedded base can reference the host note as `this.file`) and `embeddedSource`.
3. `BaseView.loadConfig()` produces a `BaseConfig` + a `SourceSpec`. Rows come from `api.resolveRows(spec)` (server-side `/rows`, which follows base composition + scoped tasks), with a stale-while-revalidate client row cache keyed on the SSE server version.
4. `runView(config, rows, idx, hostMeta)` computes the `ViewResult`; the matching renderer (`TableView`/`CardsView`/`ListView`/`BulletsView`/`KanbanView`/`MapView`/`HeatmapView`/`BarView`/`LineView`/`StatView`/`CalendarView`/`FlashcardsView`) draws it.
5. Calendar and flashcards are **full-pane** views (`fullPane()`), rendered directly from `data().rows` rather than through `runView`.

## Gotchas

- **A flat block never iterates the vault.** Only `of:` (a base) or `tasks:` produce a source. `from: notes …` is gone; `from:` alone is inert. If you want to iterate notes inline, use the **full inline config** form (which defaults to `{ kind: "notes" }`) or reference a `type: base` file with `of:`.
- **`of:` beats `tasks:`** if both are present; `from:` is read only with `tasks:`.
- **Unknown `view:` doesn't error** — it silently falls back (`list` for tasks, `table` otherwise).
- **No `sort:` in the flat grammar** — `parseQueryBlock` never sets `sort`. Sort inside a full inline config, or via the referenced base.
- **One config key flips the whole block to config mode** — adding any of `views:/filters:/formulas:/properties:/schema:/source:` makes the flat keys (`of:`, `tasks:`, etc.) ignored.
- **First `:` splits a flat line** — values may contain colons (e.g. `where: date == today` is fine; `where: a:b` keeps `a:b` as the value). Duplicate keys: last one wins.
- **`livePreview` skips `query` fences** — if you ever see a raw `query` code block rendered as plain code, the `queryBlock` extension isn't mounted.
- **`from: [[Base]]` in YAML** parses as a nested flow sequence, not a string — `normalizeSource`'s `wikiStr` reconstructs `"[[Base]]"` from the array form so unquoted refs don't silently drop the scope (relevant to the full-config form; the flat parser keeps the literal string).

See also: [bases overview](./overview.md), [sources & composition](./sources.md), [views](./overview.md), [tasks](../tasks/syntax.md).

Source: app/src/editor/queryBlock.ts, app/src/editor/queryComplete.ts, app/src/editor/queryComplete.test.ts, core/src/bases/queryBlock.ts, core/test/bases/queryBlock.test.ts, core/src/bases/parse.ts, core/src/bases/sourceSpec.ts, core/src/bases/types.ts, app/src/bases/BaseView.tsx
