# Bases: Overview

A **base** in Bismuth is an ordinary markdown note whose YAML frontmatter contains `type: base`. There is **no `.base` file extension** — a base is just a `.md` file. Its frontmatter declares a *source* (where rows come from), optional *filters*, *formulas*, per-property metadata, and exactly one *view* (table, cards, kanban, calendar, …). At render time, [`FileView`](../../app/src/FileView.tsx) detects `type: base` and routes the file to [`BaseView`](../../app/src/bases/BaseView.tsx) instead of the text editor; `BaseView` resolves the source to a uniform list of rows and renders the view.

This covers what a base *is*, how it is detected and routed, the complete frontmatter shape, the view's keys, how to get a second view of the same rows, and a tour of the 12 view types (each has its own doc under [`views/`](./views/)).

For the closely-related embedded ` ```query ` block (a *view into* a base inside a regular note), see the [query block doc](./query-block.md). For sources and composition, see the [sources doc](./sources.md).

**In order:**

- **What a base is**, and how `FileView`/`BaseView` route and resolve it — the routing/caching subsections are implementation detail; skip ahead if you just want to write one.
- **The frontmatter reference** — `filters`, `formulas`, `properties`, `source`, `schema`.
- **The view** — the one-view rule, the flat spelling, common fields, then per-type fields (table/cards/map/calendar/flashcards/charts).
- **One view per base: composing** — how to get a second view of the same rows.
- **Rows in the body** — how an own-rows base stores its data.
- **The 12 view types** — one row per type, linking out to its own doc.
- A **worked example**, then a **gotchas** cheat sheet.

---

## What a base IS

- A base is a markdown file (`.md`) with `type: base` in its YAML frontmatter. **There is no `.base` extension** — the comment `parsed .base YAML` at the top of `core/src/bases/types.ts` is legacy nomenclature; the runtime detection is purely on the `type: base` frontmatter key (`FileView.tsx`, `isBase()`).
- The frontmatter *is* the base config (`BaseConfig`). It declares the source, filters, formulas, property metadata, schema, and the one view (`view:` plus its keys).
- The markdown *body* (below the frontmatter `---`) is optional. When present it holds the base's **own rows** — either a canonical YAML list of row objects, or (back-compat) a GFM pipe table. See [Rows in the body](#rows-in-the-body).
- Each base resolves a `SourceSpec` to a uniform `Row[]`. A row is one note (or one task, or one inline-table row), shaped as `{ file, note, formula }` (`Row` in `types.ts`).

Minimal base (renders the whole vault as a table — the default view):

```markdown
---
type: base
---
```

That file alone parses to `{ view: { type: "table" } }` and, because it has no body rows and no explicit `source`, defaults its source to `{ kind: "notes" }` (every vault note). See [Default source resolution](#default-source-resolution).

---

## Three axes: kind, mode, and origin

A base's view is the product of three independent choices, and confusing any two of
them is the most common way to misread a base file:

| Axis | Answers | Values | Key |
| --- | --- | --- | --- |
| **Kind** | What does this LOOK like? | `table`, `cards`, `list`, `bullets`, `kanban`, `map`, `calendar`, `flashcards`, `bar`, `line`, `stat`, `heatmap` | `view:` |
| **Mode** | What ARE the rows? | `normal` (anything) or `tasks` (every row is a task) | `mode:` |
| **Origin** | Where do the rows COME FROM? | a query (`notes`/`tasks`/another base), or the base's own stored rows | `source:` (absent + body rows = stored) |

**Kind** is the renderer — `BaseView` picks `KanbanView`/`CalendarView`/etc.
purely off `view:`. **Mode** (`viewMode(view)`, `core/src/bases/types.ts`) says
whether every row IS a task and should render task affordances — a checkbox,
the status menu, field chips, overdue styling — regardless of which renderer
is drawing them. It supersedes the calendar-only `calendarContent: events |
tasks` (still parsed, for back-compat — `viewMode` is the one place both
spellings resolve, so every consumer calls it rather than reading
`view.mode` directly), and it does **not** touch `cardContent` — a cards-view
setting that answers a different question (what renders inside a card whose
row is a *note*), and stays independent of `mode` in either direction. See
[list & bullets](./views/list-bullets.md#tasks-mode-rendering-shared-by-both-views),
[cards](./views/cards.md), and [calendar](./views/calendar.md#tasks-register)
for the per-kind rendering `mode: tasks` adds. **Origin** is the existing
`source:` mechanism (see [sources & composition](./sources.md)); see
[row resolution & caching](#row-resolution--caching) below.

These three axes are independent: any kind can be in either mode, and any
mode can draw from either origin. Two worked examples, the same kind and
mode with different origins:

**A kanban board, in tasks mode, over a query** — one card per checkbox task
scanned out of the vault, grouped by status, with the checkbox/date/priority
chips [tasks mode](./views/list-bullets.md#tasks-mode-rendering-shared-by-both-views)
adds to a kanban card face:

```yaml
---
type: base
source: tasks where not resolved
view: kanban
mode: tasks
groupBy:
  property: note.status
---
```

**A kanban board, in tasks mode, storing its own rows** — the same board,
but the tasks are YAML rows the base file owns outright rather than lines
scanned from notes (see [Rows in the body](#rows-in-the-body) and
[the write seam](./views/list-bullets.md#task-origins-and-the-write-seam)):

```yaml
---
type: base
view: kanban
mode: tasks
groupBy: status
---

- description: ship the parser
  status: todo
  due: 2026-09-20
  priority: high
- description: fix the flake
  status: done
  done: 2026-09-09
```

Both boards look and behave identically — same checkbox, same chips, same
status menu — because both origins project to the same `Row` shape
(`taskToRow` for a scanned line, `normalizeStoredTaskRow` for a stored one;
see [the Row model](#the-row-model) below) before any view ever sees them.
Only the write-back differs: ticking a card in the first board rewrites the
source checkbox line; ticking one in the second rewrites the stored row.

---

## How `FileView` routes `type: base` → `BaseView`

[`FileView`](../../app/src/FileView.tsx) is the per-`.md` router. The flow:

1. `FileView` fetches the file body **once**, but through the note-body cache — `readNoteCached(path)` (`app/src/noteCache.ts`), not a direct `api.read` — so a reopen of an unchanged note resolves synchronously (no spinner); a missing/unreadable file is treated as `""`, so a brand-new file routes to the Editor, not BaseView.
2. It parses the frontmatter client-side with the same `parseFrontmatter` the backend's `/meta` uses, and checks `parseFrontmatter(text).data.type === "base"`.
3. If true → render `<BaseView path={path} body={…} onOpen={…} />`, but the already-read body is **not** handed over unconditionally: `bodyForPath(path, peekNoteCache(path), prefetched)` (`app/src/bases/prefetchedBody.ts`) only hands over a body that is PROVABLY that path's text — preferring `peekNoteCache(path)` (always keyed correctly), and falling back to the fetched resource's value only when it is tagged with this same path. A foreign/lagging body (`isForeignBody`) is refused (logged via `console.warn`) and `BaseView` reads `/file` itself instead: one extra round-trip, never wrong. This machinery exists because a real bug shipped a wrong base's body into a just-opened tab (a calendar tab showing the previously opened base).
4. If false → render the text `<Editor>`.
5. While the body is still loading, `FileView` shows a neutral `<Loading />` spinner (so a base never flashes the raw editor first).

`BaseView` then consumes the prefetched `body` exactly once (`pendingBody`); any later refetch (e.g. after a source-edit save) re-reads fresh from disk via `api.read`.

### BaseView's three entry modes

`BaseView` is a unified host that can render from three different inputs, checked in this priority order (`loadDocument()` in `BaseView.tsx`):

1. **`props.view`** — a parsed flat ` ```query ` block (`QueryBlock`). A synthetic config is built from `view.as` / `view.where` / `view.sort` / `view.group` / `view.limit` / `view.source`. See [query block doc](./query-block.md).
2. **`props.path`** — a `type: base` md file (this is the FileView path). The body is parsed with `parseBaseFile(text, {name, path})` into `{ config, rows }`.
3. **`props.source`** — inline ` ```query ` YAML parsed via `parseBase(source)`.

This step resolves the **document** only — the file read plus its parsed config and own rows. Which source actually FEEDS the view is a separate step:

```ts
// activeSpec() in BaseView.tsx
if (d.config.source) return d.config.source;
if (props.view) return undefined;       // a query block with neither of:/tasks: → empty state
return d.rows.length ? { kind: "base" } : { kind: "notes" };
```

- The base's `source:` wins over the default.
- With no declared source anywhere: a `type: base` file with body rows defaults to `{ kind: "base" }` (its own rows); one with none defaults to `{ kind: "notes" }` (a "query base" over the whole vault — so it "just works" instead of rendering empty). A flat ` ```query ` block with neither `of:` nor `tasks:` gets no rows at all (a deliberate empty state, not a vault-wide fallback).

A source edit re-fetches rows only when the resolved spec actually differs (see [sources & composition](./sources.md#frontend-resolution-baseview--row-cache) for the resolve step itself).

### Row resolution & caching

Two `createResource`s, kept deliberately separate so a source change never re-reads the file:

- **The document** (`fetchedDoc`) — keyed on `sig()` = `JSON.stringify({ p: path, s: source, v: view })`, cached in a module-level `docCache`. Reading + parsing the file is the one HTTP round-trip a base needs; this is it.
- **The rows** (`fetchedRows`) — keyed on `sig()` **plus** the JSON-serialized `SourceSpec`, so an equal-but-distinct spec object still re-keys correctly:

  ```ts
  const rows = spec?.kind === "base" && !spec.ref
    ? d.rows                        // this base's OWN inline rows, parsed client-side
    : spec ? await api.resolveRows(spec) : [];  // everything else, server-side
  ```

  Own rows (`{ kind: "base" }` with no `ref`) are read straight off the already-parsed document. Everything else — notes / tasks / a real base-ref composition — is resolved **server-side** via `POST /rows {spec}` (`api.resolveRows`), which follows base composition and scoped tasks. No per-kind logic is duplicated on the client.

- Both caches are module-level `RowCache` instances (`bases/rowCache.ts`), invalidated by the SSE server version. This gives stale-while-revalidate: reopening a base, paints instantly from the last resolution while it revalidates. A `BaseSkeleton` shows only on a cold load. `invalidate(version)` marks every entry resolved *before* the new version stale (a spec resolves server-side, so the client can't tell which entries are affected — over-revalidating is safe, under-revalidating is not), but keeps the cached value so reopens never blank.
- Both also carry **token-based race protection**: before an async fetch starts, `BaseView` claims a token via `docCache.begin(key)` / `rowCache.begin(key)` (an incrementing per-key counter), then passes it to the matching `set(key, value, version, token)`. A `set()` whose token is no longer the latest one `begin()` issued for that key is dropped — and returns `false` — rather than overwriting fresher data; this is what stops a slow fetch that started before a newer one already settled from clobbering it. A caller that omits the token keeps the old unconditional-write behavior.
- An SSE version bump (a note feeding this base changed, even in another pane) re-resolves both the document and the rows, filtered through `changeAffectsView` below.

#### Skipping irrelevant re-resolves (`changeRelevance.ts`)

Not every SSE change should re-resolve a view — a busy vault (e.g. the `@bismuth/daemon` rewriting a vault file) would otherwise re-resolve *every* open base continuously and peg CPU. `changeAffectsView(c, deps)` (pure, unit-tested) decides whether a change can affect *this* view's membership, given the current resolution's `deps` (the base's filters, `spec`, and the `relevantPaths` set — its resolved row notes + base file + host note). The branch order is conservative-but-cheap:

- No `dirty` (poll catch-up, unknown extent) → **affects** (be safe).
- `dirty.tree` (a new/renamed/removed/icon note may newly match) → **affects**.
- Empty `paths` and not tree-dirty → memory-only (3rd-brain) change, never feeds vault rows → **does not affect**.
- `dirty.graph` (a vault tag/link edit may flip filter membership) → **affects**.
- Otherwise a content-only vault edit → affects **only if** the view is content-dependent — a scoped/composed source (`from:` / non-structural `where:` / `ref:`), or a property-value filter — **or** a changed path is already one this view depends on (`relevantPaths`).

"Content-dependent" hinges on `leafIsFileStructuralOnly(leaf)`: a filter leaf is file-structural-only when every identifier it references is `file.*` (tag/folder/name/path/link) or a literal (`true`/`false`/`null`), so its membership can change only via a graph- or tree-dirty event, never a content edit; anything else (`note.`/`formula.`/bare frontmatter props, comparisons, date fns) is content-dependent. String literals are stripped first so a quoted tag/folder name isn't mistaken for a property identifier. `hasPropertyFilters(node)` walks the `and`/`or`/`not` tree and is true if any leaf is content-dependent. Unrecognized → content-dependent (conservative).

#### Stable row identity across re-resolves (`reconcileRows.ts`)

Every revalidation re-runs `/rows` + `runView`, producing brand-new group and row *objects* even when the data is unchanged. Solid's `<For>` keys by object **identity**, so those fresh objects would unmount→remount every card/row — the whole grid repaints and masonry reflows (the "flickery/reloady" feel on a task-status toggle). `reconcileViewResult(prev, next)` (pure, unit-tested) diffs the fresh result against the previous one and reuses the prior object reference for any group/row that is value-identical, so `<For>` preserves their DOM; only genuinely changed/added/removed rows touch the DOM. `BaseView` feeds it the memo's previous value via `createMemo((prev) => …)`.

- `rowKey(row)` keys a row across resolves. For a task row (note carries a numeric `line`) the key is `path` + its **description text**, NOT `path:line` — `${row.file.path} ${description}`, falling back to `String(line)` only when the description is missing/empty. Non-task rows are still keyed by `path`. This is backwards from the obvious guess on purpose: completing a task rewrites its source note and **sinks the done item to the bottom** (`taskReorder`), which renumbers every task below it — a `path:line` key would then change for all those siblings, so reconcileRows couldn't match them and `<For>` would unmount+remount every task under the one you checked, exactly the flicker `rowKey` exists to prevent. The description is stable across that renumbering. Identical descriptions in one note collide harmlessly: `reconcileRows` matches duplicate keys positionally (a list per key, consumed one at a time) and `rowsEqual` still gates reuse, so an ambiguous key can never reuse the wrong row.
- `rowsEqual(a, b)` compares only what a view renders — a `fileIdentity` of `name`/`path`/`folder`/`ext`/`tags`/`links` plus the full `note` and `formula` objects. The volatile stat fields (`mtime`/`ctime`/`size`) are **deliberately excluded**: a body-only edit (ticking a task inside a card) bumps `mtime` but changes nothing the view shows except the body, which `BodyCard` re-reads in place — including `mtime` would remount the card on every keystroke-driven save. (Trade-off: a view surfacing `file.mtime` as a column shows a slightly stale timestamp until the row changes structurally.) `note.line` is likewise excluded from the comparison (it's positional, not rendered content, and just as volatile as the key above) — a task that only moved lines still compares equal and keeps its DOM; on reuse, `reconcileRows` patches the volatile `note.line` and `Row.index` handles onto the kept object in place, since callers still address a row by one of those (task toggles write `note.line`; `rowUpdate`/`rowDelete` write `Row.index`) and a stale handle would target the wrong row/line once a sibling sinks or shifts.
- `reconcileRows(prev, next)` returns the previous array reference verbatim when nothing changed (same length, order, every row reused), so the enclosing group object is reused too.

`runView(config, rows, hostMeta)` (from `core/src/bases/query.ts`) computes the `ViewResult` for a table/cards/kanban/etc. view. **Full-pane views** bypass `runView` and render directly from `data().rows`: `fullPane()` (`BaseView.tsx`) is `true` for `flashcards`, and for `calendar` **except** when its mode is `tasks` (`activeType() === 'flashcards' || (activeType() === 'calendar' && activeMode() !== 'tasks')`) — a calendar view in `mode: tasks` (or the legacy `calendarContent: tasks`) is not full-pane and goes through `runView` like table/cards/list.

---

## The base frontmatter shape (`BaseConfig`)

The frontmatter parses to `BaseConfig` (`core/src/bases/types.ts`) via `parseBaseObject` (`core/src/bases/parse.ts`). Every field is optional except that `view` is always present after parse (defaulting to a table view).

```ts
interface BaseConfig {
  filters?: FilterNode;                    // the base's filters (the view has none of its own)
  formulas?: Record<string, string>;       // name -> expression string
  properties?: Record<string, BasePropertyDef>;  // { displayName?, hidden?, type?, default? }
  declaredProperties?: string[];           // set ONLY by the list-form `properties:` (see properties doc)
  view: ViewConfig;                        // the base's one view; always present after parse
  source?: SourceSpec;                     // where the rows come from
  schema?: Record<string, string>;         // column -> type
}
```

### `filters` — the base's filter (`FilterNode`)

A boolean expression tree; the base's only filter. The type:

```ts
type FilterNode = string | { and: FilterNode[] } | { or: FilterNode[] } | { not: FilterNode[] };
```

A leaf is a Bases-expression string (e.g. `'file.hasTag("book")'`); branches are `and` / `or` / `not` objects whose values are arrays of nested nodes. Real example (the canonical Obsidian-parity test):

```yaml
filters:
  or:
    - file.hasTag("tag")
    - and:
        - file.hasTag("book")
        - file.hasLink("Textbook")
```

The leaf-expression grammar (functions like `file.hasTag`, `file.hasLink`, comparisons, etc.) is documented in the [filters & expressions doc](./query-syntax.md). The frontmatter parser stores `filters` verbatim (`o.filters as BaseConfig["filters"]`) — it does not validate the expression at parse time.

### `formulas` — computed columns

`Record<string, string>` mapping a formula name → an expression string. Values are coerced to strings (`String(v)`). The formula result is exposed as `formula.<name>` and can be referenced in `order`, `sort`, `groupBy`, `summaries`, etc.

```yaml
formulas:
  ppu: "(price / age).toFixed(2)"
```

This defines a `formula.ppu` property. See [expressions doc](./query-syntax.md) for the formula language.

### `properties` — per-property metadata / per-base declaration

Two forms — full detail in the [per-base properties doc](./properties.md):

**Map form** (metadata over auto-derived properties): `Record<string, BasePropertyDef>` keyed by property id.

- `displayName` — a custom header label for the column (a string; otherwise undefined).
- `hidden: true` — omits the property from **auto-derived** columns (the default columns of table/cards/list/kanban). The view's explicit `order: [...]` still wins.
- `type` / `default` — tolerated as metadata (`type` limited to the legacy `PropertyType` vocabulary).

Normalization (`normalizePropertyDef`): only `hidden === true` is kept as `true`; anything else (missing / `false` / non-bool) is normalized to `undefined`. `displayName` is kept only if it's a string.

```yaml
properties:
  status:
    displayName: Status
  order:
    hidden: true
```

**List form** (the base declares its OWN property set): each entry a bare name or `{name, type?, default?, displayName?, hidden?}`. Sets `BaseConfig.declaredProperties` (names in order); the view without an explicit `order:` then shows exactly the declared properties instead of unioning row frontmatter, and kanban's add-card seeds each declared `default`. Bases that read existing pages simply don't declare — they keep reflecting the notes' own frontmatter.

```yaml
properties:
  - status
  - name: priority
    type: number
    default: 1
```

### `view` and the view keys

`view: <kind>` names the base's one view (one of the 12 `ViewType`s); every view option is a plain top-level key beside it. Full shape under [the view](#the-view) below.

### `source` (`SourceSpec`)

Coerced by `normalizeSource(raw, fm)` (`core/src/bases/sourceSpec.ts`), which accepts both a string and an object form. Resolution order: `BaseConfig.source` → own body rows (`{ kind: "base" }`) → `{ kind: "notes" }`. A bare `#tag` is not a filter: unquoted it is a YAML comment (`source: notes where #book` silently becomes the whole vault); inside the string form (`notes where "#book"`) it is a non-empty string, true for every note; as `where: "#book"` it is a parse error (zero rows). Write `file.hasTag("book")` — no `#`, exact tag only (not `book/x`).

`SourceSpec` is one of:

```ts
| { kind: "base"; ref?: string }                   // render another base (composition); ref = "[[Other Base]]"
| { kind: "notes"; where?: string; from?: string } // vault notes filtered by a Bases expr
| { kind: "tasks"; where?: string; from?: string } // vault checkbox tasks
```

Accepted frontmatter forms (`normalizeSource` + its tests):

| Frontmatter | Parsed `SourceSpec` |
| --- | --- |
| `source: notes` | `{ kind: "notes" }` |
| `source: notes where folder == "Keep"` | `{ kind: "notes", where: 'folder == "Keep"' }` |
| `source: tasks` (+ `from: [[Keep]]`, `where: not done`) | `{ kind: "tasks", from: "[[Keep]]", where: "not done" }` |
| `source: base` (+ `ref: [[X]]`) | `{ kind: "base", ref: "[[X]]" }` |
| `source: { kind: notes, where: 'file.hasTag("book")' }` | `{ kind: "notes", where: 'file.hasTag("book")' }` |
| `source: { kind: tasks, from: "[[Keep]]" }` | `{ kind: "tasks", from: "[[Keep]]" }` |

Notes:
- An inline `where` on the string form beats a top-level `where` (`source: tasks where done` + `where: not done` → `where: "done"`).
- For the string form, top-level `from`/`ref` are pulled from surrounding frontmatter (`fm.from`, `fm.ref`).
- Unquoted `[[X]]` in YAML parses as a nested flow array (`[["X"]]`), not a string. `wikiStr()` reconstructs it back to `"[[X]]"` for both `from` and `ref` — so `from: [[Keep]]` (unquoted) still scopes correctly. Quote it (`from: "[[Keep]]"`) to be safe.
- An unrecognized source (`source: bogus`, `source: 42`, `source: { kind: bogus }`) → `undefined`, and the caller applies its default (see below).

See the [sources & composition doc](./sources.md) for full semantics (composition recursion, scoped tasks, `from: [[Base]]`).

### Default source resolution

For a `type: base` file this is the same rule covered above under BaseView's three entry modes: body has rows → `{ kind: "base" }` (own inline rows), no rows → `{ kind: "notes" }` (whole-vault query base) — both apply when `config.source` is absent (`normalizeSource` returned undefined). The other two entry modes default differently: a flat ` ```query ` block (`props.source` path) defaults to `{ kind: "notes" }`; a `QueryBlock` (`props.view` path) carries its own `source`, which is `undefined` when neither `of:` nor `tasks:` is present (→ empty state).

### `schema` — column types for the row editor

`Record<string, string>` mapping a column name → a type string. Recognized types (per the `types.ts` comment): `"text" | "date" | "time" | "number" | "checkbox" | "list" | "link"`. Used by row editors (sheets/calendar/flashcards) to know how to render & write each field.

```yaml
schema: { title: text, date: date }
```

The schema is read both from `parseBaseObject` (`o.schema`) and re-applied at the top level in `parseBaseFile` (`raw.schema`).

---

## The view

A base has **exactly one view**. It is spelled flat: `view: <kind>` names the kind, and every view option sits at the top level of the frontmatter beside the base keys (`filters`, `source`, `formulas`, `properties`). The full `ViewConfig` shape is in `core/src/bases/types.ts`; the tables below group it by concern. There is no view name, and no per-view `filters` or `source` — those belong to the base.

```yaml
---
type: base
view: kanban
source: tasks where not resolved
mode: tasks
groupBy: status
columns: [todo, doing, done]
---
```

`type` is always `base` at the top level; the kind key is `view`, never `type`.

Top-level keys that are **never** view keys: `type`, `view`, `views`, `name`, `filters`, `source`, `from`, `where`, `ref`, `formulas`, `properties`, `schema`, `categories`. Every other top-level key is read as a view key.

### Legacy `views:` lists

Files written before the one-view rule carry `views: [ { type, name, ... } ]`. They still read, through the **first entry only**: its `type` is the kind (beating a top-level `view:`), its `filters` AND onto the base's, its `source` overrides the base's, and flat top-level keys beat the entry's keys. Further entries are ignored on read.

The first write from the app (`POST /set-property` and friends) flattens the file: `type` becomes `view`, `name` is dropped, the entry's keys move to the top level, and `views:` is removed. A list with more than one entry cannot be flattened, so writes fail with `BASE_VIEWS_FORMAT_ERROR` and `bismuth base validate` reports it. Fix it by giving each extra view its own base (see [One view per base: composing](#one-view-per-base-composing)).

### Common fields (all view kinds)

| Field | Type | Meaning |
| --- | --- | --- |
| `view` | `ViewType` | One of the 12 kinds; defaults to `"table"` if missing/invalid (`isValidType`). |
| `limit` | `number` | Max rows to show. |
| `order` | `string[]` | Property ids to display, in order — e.g. `["file.name", "note.age", "formula.ppu"]`. An explicit `order` opts a `hidden` property back in. |
| `sort` | `SortSpec[]` | Sort keys applied in order. Each `{ property, direction?: "ASC" \| "DESC" }`. A bare string or `{column}` is normalized to `{property, direction: "ASC"}`. |
| `groupBy` | `{ property; direction?: "ASC" \| "DESC" }` | Group rows by a property. A bare string is normalized to `{property, direction: "ASC"}`. |
| `summaries` | `Record<string,string>` | propertyId → summary name (e.g. `"Average"`). Footer aggregates. |
| `columns` | `string[]` | Explicit group order for a grouped view. Listed groups appear first in this order; data-only keys append after. **Kanban** additionally shows every listed key as a column even when empty (so a column doesn't vanish when its last card is dragged out); other kinds only show declared groups that have rows. |
| `mode` | `"normal" \| "tasks"` | The **mode** axis: whether every row IS a task, independent of the kind. Read through `viewMode(view)` (`core/src/bases/types.ts`), never `view.mode` directly — it also folds in the legacy `calendarContent: tasks` spelling. Any other value → undefined (falls back to `"normal"`). See [three axes](#three-axes-kind-mode-and-origin). |

The **origin** axis is the base's own `source:` — see [sources & composition](./sources.md).

### Table-specific

| Field | Type | Meaning |
| --- | --- | --- |
| `columnWidths` | `Record<string, number>` | Per-column pixel widths keyed by property id, set by drag-resizing headers. Non-finite / non-positive values are dropped; string values ("240") are coerced to numbers. |

### Cards-specific

| Field | Type | Meaning |
| --- | --- | --- |
| `cardContent` | `"properties" \| "body" \| "tasks"` | What to render inside each card. `body` renders the note's markdown body; `tasks` filters it to just its checklist lines; both use `BodyCard` (task markers: left-click toggles, right-click sets status). `properties` shows fields. Any other value → undefined. |
| `image` | `string` | Property id holding a cover URL/path (e.g. `"cover"`). A full URL (http/https/data/blob) or a vault image path/filename (served via the asset endpoint). Unset → generated text cover. |
| `imageFit` | `"cover" \| "contain"` | `object-fit` for the cover image. Default `"cover"`. |
| `imageAspectRatio` | `number` | Cover width÷height (CSS aspect-ratio). Default `0.667` (2:3 portrait). Tolerates a YAML-stringified number. |

### Map-specific

| Field | Type | Meaning |
| --- | --- | --- |
| `lat` | `string` | Property id carrying latitude. Defaults to bare `"lat"` (matched to frontmatter). Use `"note.x"` / `"formula.y"` for custom namespaces. |
| `lng` | `string` | Property id carrying longitude. Defaults to bare `"lng"`. |
| `zoom` | `number` | Initial map zoom. |
| `center` | `{ lat: number; lng: number }` | Initial center. Only kept if both `lat` and `lng` are numbers. |

### Calendar-specific (field bindings)

Which columns carry the calendar's date/time/recurrence/category fields. Each is a string property id; all have defaults:

| Field | Default | Meaning |
| --- | --- | --- |
| `calendarContent` | `"events"` | **Superseded by the `mode` axis** (`mode: tasks` — see [three axes](#three-axes-kind-mode-and-origin)); still parsed for base files already on disk. Which register the grid draws: `"events"` (the field-bound event table below) or `"tasks"` (resolved task rows — see [calendar view → tasks register](./views/calendar.md#tasks-register)). An explicit `mode:` wins over this if both are present. Any other value → undefined (falls back to `"events"`). |
| `dateField` | `"date"` | Event date. **Tasks register**: normally left unset — placement falls back to `scheduled` then `due`; setting it pins the view to one field and disables the fallback. |
| `startTimeField` | `"startTime"` | Event start time. Events register only — tasks are always all-day. |
| `endTimeField` | `"endTime"` | Event end time. Events register only. |
| `recurrenceField` | `"recurrence"` | Recurrence rule. Events register only — a task's own recurrence is `[every ...]` in the line, not a column. |
| `categoryField` | `"category"` | Category/status. Events register only. |
| `googleCalendarSync` | `false` | Enable per-calendar Google Calendar two-way sync for this base ([gcal](../gcal/overview.md)). Events register only. |
| `googleCalendarId` | `"primary"` | Which Google calendar this base syncs with. Events register only. |
| `taskFile` | *(unset)* | **Tasks register + `source: tasks` only**: the note `[ + task ]` appends a new checkbox line to (`[[Wikilink]]` or a plain vault-relative path). Absent → the `[ + task ]` action is not rendered at all — a grid cell says which DAY, not which FILE, and nothing here guesses a destination. Not used when the base owns its rows (no `source:`); there, `[ + task ]` writes a new ROW instead. |

### Flashcards-specific (field bindings + SM-2 state)

| Field | Default | Meaning |
| --- | --- | --- |
| `frontField` | `"front"` | Card front. |
| `backField` | `"back"` | Card back. |
| `dueField` | `"due"` | Next-due date. |
| `easeField` | `"ease"` | SM-2 ease factor. |
| `intervalField` | `"interval"` | SM-2 interval. |
| `bidirectional` | `false` | When `true`, every card is reviewed in BOTH directions, each carrying its own independent SM-2 schedule. The reverse schedule lives in companion columns `<dueField>Back` / `<easeField>Back` / `<intervalField>Back` (defaults `dueBack` / `easeBack` / `intervalBack`). Replaces the old `:::` reversed card. |

### Chart-specific (bar / line / stat / heatmap)

| Field | Type | Meaning |
| --- | --- | --- |
| `x` | `string` | Property id for the x-axis / category. |
| `y` | `string` | Property id for the y-axis value. |
| `aggregate` | `"sum" \| "avg" \| "count" \| "min" \| "max"` | Aggregation. Invalid values (e.g. `median`) → undefined. |
| `bin` | `"day" \| "week" \| "month"` | Time bucket. Invalid values (e.g. `quarter`) → undefined. |

### Defaulting & normalization rules

From `normalizeView` / `parseBaseObject` / `parseBaseFile`:

- An unknown `view:` kind falls back to `"table"`.
- An empty or malformed base parses to `{ view: { type: "table" } }`.
- Enum fields reject unknown values (cardContent, calendarContent, mode, imageFit, aggregate, bin) → undefined rather than the raw value.

### The flat spelling

Because every view key is a plain top-level key, the settings panel persists a view field with a single `setProperty(path, key, value)`; there is no nested block to edit. The keys, by group:

- Field bindings: `frontField`, `backField`, `dueField`, `dateField`, `startTimeField`, `endTimeField`, `recurrenceField`, `categoryField`, `googleCalendarId`, `x`, `y`, `image`, `taskFile` (any string).
- Per-calendar Google sync: `googleCalendarSync` (boolean).
- View shaping: `order` (array), `columns` (array), `sort`, `groupBy`, `columnWidths`, `limit`, `summaries`.
- Mode: `mode` (`normal`/`tasks`).
- Cards: `cardContent` (`body`/`properties`/`tasks`), `imageFit` (`cover`/`contain`), `imageAspectRatio`.
- Calendar: `calendarContent` (`events`/`tasks`) — superseded by `mode`, still parsed.
- Charts: `aggregate`, `bin`.
- Flashcards: `bidirectional` (boolean).

Example (a chart base):

```markdown
---
type: base
view: bar
x: day
y: count
aggregate: sum
bin: month
---
```
parses to `view = { type: "bar", x: "day", y: "count", aggregate: "sum", bin: "month" }`.

Another (list grouped by a formula with explicit group order):

```markdown
---
type: base
view: list
groupBy: { property: formula.urgency }
columns: [Overdue, This week, Later]
---
```

In the app, the kind and mode are changed in the base's settings panel, which writes `view:` and `mode:`.

---

## One view per base: composing

A base cannot hold a second view. If you want another view of the same rows, make a new base file that queries the first: `source: base` with `ref: "[[That Base]]"`, plus its own `view:` and view keys.

Worked example: a kanban board of tasks, and a table of the same tasks.

`Board.md`:

```markdown
---
type: base
source: notes where file.hasTag("task")
filters: 'note.status != "archived"'
view: kanban
groupBy: status
columns: [todo, doing, done]
---
```

`Task table.md`:

```markdown
---
type: base
source: base
ref: "[[Board]]"
filters: 'note.status != "archived"'
view: table
order: [file.name, note.status, note.due]
sort:
  - { property: note.due, direction: ASC }
---
```

### Exactly what carries over

The referencing base receives the referenced base's **rows only**:

- If the referenced base declares no `source`, its rows are its own inline body rows, or every vault note when it has none.
- Otherwise its rows are the rows of its own `source`, resolved recursively.
- Its `filters`, `formulas`, `properties`, `sort`, `groupBy`, `limit`, `columns` and every other view key are **not** applied. Those are applied by the referenced base's own view only, when you open it.
- The referencing base must therefore restate any filter it wants (`Task table` repeats the `archived` filter above), declare its own `formulas` and `properties`, and choose its own sort and grouping.
- A cycle (A refs B refs A) resolves to zero rows.

`Task table` above reads the rows of `notes where file.hasTag("task")`, exactly what `Board` reads, and then applies its own filter and view. See [sources & composition](./sources.md) for the resolver, scoped tasks and `from: [[Base]]`.

---

## Rows in the body

When a base file's body is non-empty, it holds the base's own rows (used when the resolved source is `{ kind: "base" }`). `parseRows(body, meta)` (`core/src/bases/rows.ts`) supports two forms:

1. **Canonical: a YAML list of row objects.** Each object becomes one `Row` whose `note` is the object. The row's `file` is a *synthetic* `FileMeta` (`syntheticBaseFile(path)`) — `name`/`basename` are empty (so the base file's name isn't shown as a meaningless repeated column), but `path` is kept for write-back.
2. **Back-compat: a GFM pipe table.** Detected by a header line with a pipe followed by a `|---|---|` separator (`looksLikeTable`), parsed by `parseMarkdownTable`. Values are type-coerced (e.g. a numeric cell becomes a number — `rows[0].note.a === 1`).

Example file with an inline table body:

```markdown
---
type: base
view: calendar
schema: { title: text, date: date }
---

| title   | date       |
| ---     | ---        |
| Dentist | 2026-06-03 |
```

`parseBaseFile` returns `{ config, rows }` with `rows.length === 1` and `rows[0].note.title === "Dentist"`.

`serializeRows(rows, columnOrder?)` writes rows back as the canonical YAML list. Undefined values are dropped (so empty cells don't serialize as `key: null`); a `columnOrder` preserves user-configured column order, appending any extra keys alphabetically.

### The `Row` model

```ts
interface Row {
  file: FileMeta;                    // file identity (name, path, folder, ext, tags, links, ctime/mtime, size)
  note: Record<string, unknown>;     // frontmatter (or the inline-table/YAML row object)
  formula: Record<string, unknown>;  // filled in by the query engine (formula.<name>)
  index?: number;                    // write-back handle: this row's position in its base file
  derived?: readonly string[];       // write-back handle: which note.* keys normalization filled in
}
```

`FileMeta` carries `name` (basename without extension), `basename` (alias), `path` (vault-relative), `folder` (`""` for root), `ext`, `size`, `ctime`/`mtime` (epoch ms), `tags` (no leading `#`), and `links` (wikilink targets — no `.md`, no `#heading`, no `|alias`).

`index` and `derived` are **write-back handles, not user data** — that's why both live beside `note` rather than inside it, where they'd show up as spurious columns:

- **`index`** is this row's 0-based position in its OWN base file's row table. Present only for a row parsed out of an inline base body (a canonical YAML-list row or a back-compat GFM-table row — both stamp it); a note row or a task-line row has no position in a base file and leaves it `undefined`. `POST /row/update` and `POST /row/delete` address a row by exactly this number, so a row with no usable `index` gets no write affordance at all rather than risking a write to the wrong row (see [row body parsing](./sources.md#row-body-parsing-coresrcbasesrowsts)).
- **`derived`** records which `note.*` keys a normalizer FILLED IN, rather than read off the row as stored — `normalizeStoredTaskRow` (`core/src/bases/taskRow.ts`) is the producer today, for a task kept as a stored row (see [tasks mode](./views/list-bullets.md#task-origins-and-the-write-seam)). A write strips exactly the keys `derived` names, which is what lets two things be true at once: a computed value (`resolved`, `placed`, `recurring`, `statusChar`, …) never gets baked into the user's file as a stale column, and **a user column that happens to share one of those names always wins** — normalization only fills a key that's genuinely absent, so a base with its own `placed` column (holding, say, a shelf location) keeps its value untouched and simply has no computed value for that row. A row with no `derived` record (never normalized) strips nothing on write, which is the safe direction: worst case a computed value gets persisted, never a stored column deleted.

---

## The 12 view types

`ViewType` (single source of truth: `VIEW_TYPES` in `types.ts`) spans 12 string kinds. `BaseView` picks the renderer per the `view:` kind. Each has its own detailed doc:

| `type` | Renderer | What it shows | Doc |
| --- | --- | --- | --- |
| `table` | `TableView` | Spreadsheet-style grid; resizable columns, reorder, footer summaries. The default/fallback. | [table](./views/table.md) |
| `cards` | `CardsView` | Card grid; `cardContent: properties`/`body`, optional image cover. | [cards](./views/cards.md) |
| `list` | `ListView` | Compact list of rows (checkbox list for tasks). | [list](./views/list-bullets.md) |
| `bullets` | `BulletsView` | Plain markdown bullet list. | [bullets](./views/list-bullets.md) |
| `kanban` | `KanbanView` | Drag-drop board grouped by a property; declared `columns` stay even when empty. | [kanban](./views/kanban.md) |
| `map` | `MapView` | Geographic map plotting rows by `lat`/`lng`. | [map](./views/map.md) |
| `calendar` | `CalendarView` | Full-pane calendar (Bases view kind, not a standalone page). Two registers via `calendarContent`: `events` (default, field bindings `dateField`/`startTimeField`/etc.) or `tasks` (resolved task rows, placed by `scheduled`/`due`). | [calendar](./views/calendar.md) |
| `flashcards` | `FlashcardsView` | Full-pane SM-2 review over row cards; `bidirectional` for two-way. | [flashcards](./views/flashcards.md) |
| `bar` | `BarView` | Bar chart over `x`/`y`/`aggregate`/`bin`. | [bar](./views/charts.md) |
| `line` | `LineView` | Line chart. | [line](./views/charts.md) |
| `stat` | `StatView` | Single big-number stat tile. | [stat](./views/charts.md) |
| `heatmap` | `HeatmapView` | Calendar-style heatmap (e.g. `x: date, y: glasses, aggregate: avg, bin: week`). | [heatmap](./views/charts.md) |

`flashcards`, and `calendar` unless its mode is `tasks`, are **full-pane** views: `BaseView.fullPane()` returns true for them, they skip `runView`, and they render directly from `data().rows` (Calendar reads/writes its own data; Flashcards drives the SM-2 queue). A `calendar` view in `mode: tasks` (or legacy `calendarContent: tasks`) is NOT full-pane — it goes through `runView` like table/cards/list. All other types go through `runView` → a `ViewResult` (`{ view, columns, groups, summaries }`).

---

## End-to-end example

A "Books" base that queries vault notes tagged `#book`, shows a filtered/sorted table:

```markdown
---
type: base
source: notes where file.hasTag("book")
filters:
  not:
    - file.hasTag("archived")
formulas:
  ppu: "(price / age).toFixed(2)"
properties:
  ppu:
    displayName: $/yr
view: table
order: [file.name, note.author, formula.ppu]
sort:
  - { property: file.name, direction: ASC }
summaries:
  formula.ppu: Average
---
```

This base has one Table view, a notes source scoped to `#book`, a `not archived` filter, a `ppu` formula displayed as `$/yr`, and a footer average. When opened it routes through `FileView` → `BaseView`, resolves rows via `POST /rows {kind:"notes", where:'file.hasTag("book")'}`, and renders the table.

A cover-grid view of the same books is a second base file: `source: base`, `ref: "[[Books]]"`, `view: cards`, `cardContent: properties`, `image: cover`, plus the `not archived` filter restated. See [One view per base: composing](#one-view-per-base-composing).

---

## Gotchas

- **No `.base` extension.** A base is a `.md` file; detection is `type: base` frontmatter only. Don't look for `.base` files.
- **A base with no source and no body rows defaults to `{ kind: "notes" }`** (the whole vault) — not empty. If you don't want the whole vault, set an explicit `source:`.
- **A base with body rows but no explicit source renders its OWN rows** (`{ kind: "base" }`), not vault notes.
- **Unquoted `[[X]]` in `from`/`ref`** parses as a YAML nested array; it's reconstructed back to a string, but quoting (`from: "[[X]]"`) is safer.
- **`properties.<x>.hidden` only hides from auto-derived columns** — an explicit `order` listing that property still shows it.
- **`properties:` written as a LIST declares the base's own property set** (columns come from the declaration, not the rows — see [properties doc](./properties.md)); the MAP form stays metadata-only.
- **Malformed YAML is tolerant**: `parseBase` returns a safe empty base (`{ view: { type: "table" } }`) rather than throwing.
- **Enum fields reject unknowns** (cardContent, calendarContent, mode, imageFit, aggregate, bin, view kind) — they fall back to undefined / `"table"`, never the raw bad value.
- **Full-pane views (calendar/flashcards) ignore `runView`** — column/sort/summary config from the table pipeline doesn't apply to them; they use their own field bindings.
- **`mode: tasks` and `cardContent: tasks` are different axes, not two spellings of one thing** — `mode: tasks` means every row IS a task (any view kind); `cardContent: tasks` means a cards-view card shows a note's body filtered to its checklist. A cards view can combine both, independently, or neither. See [three axes](#three-axes-kind-mode-and-origin).
- **A base has one view.** A second view of the same rows is a second base with `source: base` + `ref:`; the referenced base contributes rows only, so restate its filters. See [composing](#one-view-per-base-composing).
- **A legacy `views:` list reads first-entry-only**, is flattened on the first write, and blocks writes (`BASE_VIEWS_FORMAT_ERROR`) when it has more than one entry.

---

## See also

- [Sources & composition](./sources.md) — `SourceSpec` resolution, base composition, scoped tasks, `from: [[Base]]`.
- [Filters & expressions](./query-syntax.md) — the leaf-expression grammar (`file.hasTag`, comparisons, formulas).
- [Embedded query block](./query-block.md) — the ` ```query ` block (a view into a base inside a note).
- [View docs](./views/) — one doc per `ViewType`.

Source: `core/src/bases/types.ts`, `core/src/bases/parse.ts`, `core/src/bases/flattenViews.ts`, `core/src/bases/source.ts`, `core/src/bases/sourceSpec.ts`, `core/src/bases/rows.ts`, `core/src/bases/taskRow.ts`, `app/src/bases/BaseView.tsx`, `app/src/bases/rowCache.ts`, `app/src/bases/changeRelevance.ts`, `app/src/bases/reconcileRows.ts`, `app/src/bases/prefetchedBody.ts`, `app/src/FileView.tsx`, `app/src/noteCache.ts`, `core/test/bases/parse.test.ts`, `core/test/bases/parseBaseFile.test.ts`, `core/test/bases/sourceSpec.test.ts`, `core/test/bases/queryBlock.test.ts`, `core/test/bases/rows.test.ts`
