# Bases: Sources & Row Resolution

Every Bismuth base and every view ultimately resolves a **`SourceSpec`** into a
uniform `Row[]`. A `SourceSpec` is one of three kinds — `base`, `notes`, or
`tasks` — and the resolver in `core/src/bases/source.ts` turns it into rows by
reading vault notes, extracting checkbox tasks, or recursively rendering another
base (composition). This document covers the `SourceSpec` shape, how a
frontmatter `source:` string/object is normalized into one (`normalizeSource`),
the `from: [[Base]]` scoping mechanism, recursive base composition with
cycle-guarding (including symlink cycles), the canonical row body parser
(`rows.ts`), and the server-side `POST /rows` endpoint with its caching and
in-flight dedup. Worked examples (incl. scoped tasks) are drawn from the actual
unit tests.

See also: [bases overview](./overview.md), [the `query` block & flat view specs](./query-block.md), [tasks](../tasks/syntax.md).

## The `SourceSpec` type

Defined in `core/src/bases/types.ts`:

```ts
export type SourceSpec =
  | { kind: "base";  ref?: string }                   // ref = "[[Other Base]]"
  | { kind: "notes"; where?: string; from?: string }  // vault notes filtered by a Bases expr
  | { kind: "tasks"; where?: string; from?: string }; // vault checkbox tasks
```

Field meanings:

| Field   | Kinds         | Meaning |
| ------- | ------------- | ------- |
| `kind`  | all           | Which source: `"base"`, `"notes"`, or `"tasks"`. |
| `ref`   | `base`        | A wikilink `"[[Other Base]]"` pointing at the base to render. Resolves that base's **own** declared source (recursive composition), not just its static rows. |
| `where` | `notes`,`tasks` | A filter. For `notes` it is a **Bases filter expression** (e.g. `file.hasTag("book")`). For `tasks` it is a **Tasks query DSL** string (e.g. `not done`). |
| `from`  | `notes`,`tasks` | A wikilink `"[[Base]]"` that **scopes** the source to only the notes that the referenced base selects (see [`from:` scoping](#the-from-base-scoping-mechanism)). |

There is no `notes`/`tasks` `ref`, and no `base` `where`/`from` — those fields
are pruned away by `normalizeSource` if present (see below).

### Where a `SourceSpec` comes from

A `SourceSpec` is produced in three places, all converging on the same resolver:

1. **A `type: base` md file's frontmatter `source:`** — parsed by
   `normalizeSource` into `BaseConfig.source` (the base-level default for all its
   views). A per-view `source:` (`ViewConfig.source`) overrides it.
2. **A flat ` ```query ` block** — `of: [[Base]]` → `{kind:"base"}`,
   `tasks: <dsl>` → `{kind:"tasks"}`, with optional `from:` (see
   [query blocks](./query-block.md)). A block with neither `of:` nor `tasks:`
   has **no** source and renders an empty state.
3. **Direct construction** in tests / the frontend's `BaseView` fallback logic.

## `normalizeSource(raw, fm)` — string ⟷ object coercion

`core/src/bases/sourceSpec.ts` exports `normalizeSource(raw, fm)`, which coerces
a frontmatter `source` value (a **string** or an **object**) plus the
surrounding frontmatter object `fm` (for top-level `from`/`where`/`ref`) into a
`SourceSpec`. It returns `undefined` for anything unrecognized — **callers then
apply their own default** (the frontend defaults to `{kind:"notes"}` for a
sourceless query base, or `{kind:"base"}` when the base has inline rows).

The valid kinds are `["base", "notes", "tasks"]`.

### Object form

```yaml
source:
  kind: tasks
  from: "[[Keep]]"
```

→ `{ kind: "tasks", from: "[[Keep]]" }` (passthrough; `undefined` fields pruned).

- If `kind` is not one of `base`/`notes`/`tasks`, returns `undefined`
  (`normalizeSource({ kind: "bogus" }, {})` → `undefined`).
- `ref`/`from` are read through `wikiStr` (handles the nested-array YAML quirk,
  below); `where` is read as a plain non-empty string.

### String form

The string is trimmed and matched against
`/^(base|notes|tasks)(?:\s+where\s+(.+))?$/i` (case-insensitive on the kind):

```yaml
source: notes                          # { kind: "notes" }
source: notes where folder == "Keep"   # { kind: "notes", where: 'folder == "Keep"' }
source: tasks                          # { kind: "tasks" }  (+ picks up top-level from/where)
source: base                          # { kind: "base" }   (+ picks up top-level ref)
```

When the string form is used, the top-level frontmatter supplies the other
fields:

- `from:` comes from `fm.from` (wikilink).
- `ref:` comes from `fm.ref` (wikilink).
- `where:` comes from the **inline** `where` clause on the string **if present**,
  otherwise from `fm.where`. The inline clause **wins**.

Real examples from `sourceSpec.test.ts`:

```ts
normalizeSource("notes", {})
// → { kind: "notes" }

normalizeSource('notes where folder == "Keep"', {})
// → { kind: "notes", where: 'folder == "Keep"' }

normalizeSource("tasks", { from: "[[Keep]]", where: "not done" })
// → { kind: "tasks", from: "[[Keep]]", where: "not done" }

normalizeSource("tasks where done", { where: "not done" })
// → { kind: "tasks", where: "done" }   // inline `where done` beats fm.where

normalizeSource("base", { ref: "[[X]]" })
// → { kind: "base", ref: "[[X]]" }

normalizeSource("bogus", {})            // → undefined (unknown kind)
normalizeSource(undefined, {})          // → undefined
normalizeSource(42, {})                 // → undefined
```

So a frontmatter base that filters vault notes can be written either way:

```yaml
---
type: base
source: notes
where: file.hasTag("keep")
---
```

or, equivalently:

```yaml
---
type: base
source: notes where file.hasTag("keep")
---
```

### The unquoted-`[[Base]]` YAML quirk (`wikiStr`)

This is a frequent gotcha. In YAML frontmatter an **unquoted** wikilink like

```yaml
from: [[Keep]]
```

does **not** parse as the string `"[[Keep]]"`. YAML reads `[[Keep]]` as a nested
flow sequence — `[["Keep"]]` (an array containing an array containing the string
`"Keep"`). Without handling this, the `from` scope is silently dropped and tasks
fall back to the **whole vault**.

`wikiStr` therefore accepts both forms for `from`/`ref`:

- a non-empty **string** → used as-is;
- an **array** → flattened (`flat(Infinity)`), string leaves joined with `, ` and
  wrapped back into `"[[...]]"`.

From `sourceSpec.test.ts`:

```ts
normalizeSource("tasks", { from: [["Keep"]] })
// → { kind: "tasks", from: "[[Keep]]" }

normalizeSource("base", { ref: [["My Base"]] })
// → { kind: "base", ref: "[[My Base]]" }

normalizeSource({ kind: "tasks", from: [["Keep"]] }, {})
// → { kind: "tasks", from: "[[Keep]]" }   // object form also coerced
```

**Recommendation:** quote wikilink-valued fields (`from: "[[Keep]]"`,
`ref: "[[X]]"`) to avoid relying on the coercion, but unquoted forms are
tolerated. The end-to-end regression test
("UNQUOTED from: [[Base]] in a base file still scopes tasks") confirms an
unquoted `from: [[Keep]]` in a `source: tasks` base still scopes correctly.

### `refToPath(ref)` — wikilink → file path

`sourceSpec.ts` also exports `refToPath`, which converts a `ref`/`from` wikilink
into a vault-relative file path:

- strips the leading `[[` and trailing `]]`;
- if the result already ends in `.md` or `.base`, returns it unchanged;
- otherwise appends `.md`.

```ts
refToPath("[[C]]")            // "C.md"
refToPath("[[My Base]]")      // "My Base.md"
refToPath("[[Legacy.base]]")  // "Legacy.base"  (already has an extension)
refToPath(undefined)          // ""
refToPath("Nope")             // "Nope.md"  (bare names without [[ ]] also work)
```

Bases live as `type: base` markdown files — there is **no `.base` extension** in
the canonical model — but a legacy `.base` ref is resolved to that file, **not**
a `.md` sibling (verified in `source.test.ts`: a `[[Legacy.base]]` ref resolves
the `.base` file, not `Legacy.base.md`).

## Resolving a `SourceSpec` to `Row[]`

`core/src/bases/source.ts` exports the two resolver functions.

### `SourceCtx`

`resolveSource`/`resolveBaseRows` take a `SourceCtx`:

```ts
export interface SourceCtx {
  root: string;                          // vault root
  today?: string;                        // ISO date for task DSL relative dates; defaults to new Date()…slice(0,10)
  seen?: Set<string>;                    // base paths already entered (cycle guard); real-path-resolved
  vaultRows?: () => Promise<Row[]>;      // optional cache provider for the unscoped vault notes feed
  vaultTasks?: (paths?: string[]) => Promise<Row[]>; // optional provider for vault task rows
}
```

- `root` is the only required field.
- `today` defaults to `new Date().toISOString().slice(0, 10)` when omitted.
- `seen` defaults to a fresh `Set`; it accumulates **real** (symlink-resolved)
  base paths across the composition chain for cycle protection.
- `vaultRows` / `vaultTasks` let a caller serve the heavy vault feeds from a
  cache instead of re-scanning the disk. When absent they fall back to
  `buildVaultRows(root)` / `buildTaskRows(root)` respectively. The
  `vaultTasks` provider is called **with no args** for the unscoped/global case
  (which the caller may cache) and **with `paths`** for scoped extraction (which
  must always run fresh — see the tasks resolution below).

### `resolveSource(spec, ctx)`

The central dispatcher. Returns `Row[]`.

#### `kind: "base"`

```ts
if (spec.kind === "base") {
  if (!spec.ref) return [];
  return resolveBaseRows(refToPath(spec.ref), ctx);
}
```

- An empty/missing `ref` → `[]`.
- Otherwise resolves the referenced base file via `resolveBaseRows` (composition).

A `{kind:"base"}` **with no ref** is also how the frontend renders a base's own
inline rows: in `BaseView` the inline rows are parsed client-side and passed in
directly, so a sourceless self-render never hits `/rows`. (See
[Frontend resolution](#frontend-resolution-baseview--row-cache).)

#### `kind: "notes"`

```ts
if (spec.kind === "notes") {
  let rows = await (ctx.vaultRows?.() ?? buildVaultRows(ctx.root));
  if (spec.from) {
    const scoped = await resolveBaseRows(refToPath(spec.from), ctx);
    const paths = new Set(scoped.map((r) => r.file.path));
    rows = rows.filter((r) => paths.has(r.file.path));
  }
  if (!spec.where) return rows;
  return rows.filter((r) => passesFilter(spec.where!, toContext(r)));
}
```

1. Start from the full vault notes feed (`vaultRows` provider or `buildVaultRows`).
2. If `from` is set, resolve that base to a set of note paths and **intersect**
   (keep only notes whose `file.path` the base selects).
3. If `where` is set, filter each remaining row through `passesFilter` against
   the row's evaluation context (`toContext(r)`). `where` is a **Bases filter
   expression** here.

From `source.test.ts`:

```ts
// notes filtered by a Bases where-expr
resolveSource({ kind: "notes", where: 'file.hasTag("book")' }, { root: dir })
// vault: a.md (tags:[book]), b.md (tags:[film])  →  [a]

// notes with no where → all notes
resolveSource({ kind: "notes" }, { root: dir })  // → both notes
```

#### `kind: "tasks"`

```ts
let paths: string[] | undefined;
if (spec.from) {
  const scoped = await resolveBaseRows(refToPath(spec.from), ctx);
  paths = [...new Set(scoped.map((r) => r.file.path))].filter(Boolean);
}
const rows = paths
  ? await buildTaskRows(ctx.root, paths)               // scoped: always fresh
  : await (ctx.vaultTasks?.() ?? buildTaskRows(ctx.root)); // global: cacheable
return spec.where ? filterTaskRows(rows, spec.where, today) : rows;
```

1. If `from` is set, resolve that base to its note paths and extract tasks
   **only from those files** (`buildTaskRows(root, paths)`). This scoped
   extraction **always runs fresh** — it bypasses the `vaultTasks` provider,
   because that provider's cache is keyed to the global (no-paths) feed only.
2. If `from` is absent, use the global task feed (`vaultTasks` provider or
   `buildTaskRows(root)`).
3. If `where` is set, apply the **Tasks query DSL** via
   `filterTaskRows(rows, spec.where, today)` (relative dates resolve against
   `today`).

From `source.test.ts`:

```ts
// tasks filtered by the Tasks DSL
// t.md = "- [ ] one\n- [x] two"
resolveSource({ kind: "tasks", where: "not done" }, { root: dir })
// → rows with note.description === ["one"]
```

### `resolveBaseRows(path, ctx)` — base composition

```ts
export async function resolveBaseRows(path: string, ctx: SourceCtx): Promise<Row[]> {
  const seen = ctx.seen ?? new Set<string>();
  const fa = await getFileAccess();
  const realPath = await fa.realPath(path);     // dereference symlinks for cycle detection
  if (seen.has(realPath)) return [];            // cycle → []
  seen.add(realPath);

  let text: string;
  try { text = await fa.readNote(ctx.root, path); }
  catch { return []; }                          // missing/unreadable → []

  const name = fileBasename(path);
  const { config, rows } = parseBaseFile(text, { name, path });
  if (!config.source) return rows;              // own-rows (inline-table) base
  return resolveSource(config.source, { ...ctx, seen });  // re-run its OWN source
}
```

The composition rule, stated plainly:

- A base with **no `source:`** declared is an **own-rows base** — it returns its
  inline table/YAML rows (parsed by `parseBaseFile` → `parseRows`).
- A base **with a `source:`** (notes / tasks / another base) **re-runs that
  source** recursively, threading the shared `seen` set so the chain can't loop.

So `{kind:"base", ref:"[[Keep]]"}` does **not** dump Keep's static rows when Keep
is itself a `source: notes` base — it runs Keep's notes query. This is the
"composition" behavior:

```ts
// Keep.md:    source: notes where file.hasTag("keep")
// keep/x.md:  tags: [keep]
// other/z.md: tags: [other]
resolveSource({ kind: "base", ref: "[[Keep]]" }, { root: dir })
// → only [keep/x.md]   (Keep's OWN notes source is followed, not its empty table)
```

An own-rows base returns its parsed rows directly:

```ts
// C.md:  ---\ntype: base\nview: table\n---  +  a GFM table with | title | / | Hi |
resolveSource({ kind: "base", ref: "[[C]]" }, { root: dir })
// → rows[0].note.title === "Hi"
```

### Cycle guarding (incl. symlink cycles)

`seen` holds **real** paths (`fileAccess.realPath` dereferences symlinks, falling
back to the input path when it can't resolve — e.g. on iOS). This catches both:

- direct config cycles: `A → ref:[[B]] → ref:[[A]]`, and
- symlink loops: `A → link-to-A → A`, or `A → B → link-to-A`.

When a cycle is detected the offending resolution returns `[]` (it does not
throw). From `source.test.ts`:

```ts
// A.md: source: base, ref: "[[B]]"
// B.md: source: base, ref: "[[A]]"
resolveSource({ kind: "base", ref: "[[A]]" }, { root: dir })  // → []
```

A **missing** ref likewise yields `[]` (no throw):

```ts
resolveSource({ kind: "base", ref: "Nope" }, { root: dir })  // → []
```

## The `from: [[Base]]` scoping mechanism

`from` answers "which notes does this source apply to?" by resolving the named
base to a **set of note paths** and restricting the source to those files:

- **`notes` + `from`**: keep only vault notes whose path the base selects
  (set intersection on `file.path`).
- **`tasks` + `from`**: extract checkbox tasks **only from** the base's selected
  files (`buildTaskRows(root, paths)`), instead of the whole vault.

Because `from` itself goes through `resolveBaseRows`, the referenced base's own
source is fully resolved first — so `from: [[Keep]]` where Keep is a
`source: notes where …` base scopes to exactly the notes Keep would show.

### Worked example — scoped tasks (the "Do Now" pattern)

A common pattern: a base that surfaces only the tasks inside another base's
notes. From `source.test.ts` ("scopes tasks to the referenced base's notes
only"):

```yaml
# Keep.md — selects notes tagged #keep
---
type: base
source: notes
where: file.hasTag("keep")
---
```

```markdown
<!-- keep/x.md — tagged keep, has a task -->
---
tags: [keep]
---
- [ ] scoped task
```

```markdown
<!-- other/y.md — NOT tagged keep, has a task -->
- [ ] unscoped task
```

Resolving a tasks source scoped to Keep:

```ts
resolveSource({ kind: "tasks", from: "[[Keep]]" }, { root: dir })
// → [{ note.description: "scoped task" }]   // "unscoped task" is excluded
```

As a real "Do Now" base file:

```yaml
---
type: base
source: tasks
from: "[[Keep]]"
view: table
---
```

This shows only the tasks in the notes the `Keep` base selects — not the whole
vault. (The CLAUDE.md "scoped-tasks example" describes exactly this: a `Do Now`
base with `source: tasks` + `from: "[[Google Keep]]"`.)

## Row body parsing (`core/src/bases/rows.ts`)

An own-rows base's body is parsed into `Row[]` by `parseRows(body, meta)` where
`meta = { name, path }`. Two body formats are accepted:

1. **Canonical: a YAML list of objects.** Each list item becomes one `Row` whose
   `note` is that object. Numbers stay numbers; YAML block scalars (`|-`)
   preserve multi-line cell content.
2. **Back-compat: a GFM markdown table.** Detected by a header line with a pipe
   followed by a `|---|---|` separator (`looksLikeTable`), parsed via
   `parseMarkdownTable`. Older table-based bases still load.

An **empty** or **prose-only** body returns `[]`.

Each produced `Row` has:

- `file`: a **synthetic** `FileMeta` (`syntheticBaseFile(meta.path)`) — `name`
  and `basename` are **empty strings** (base rows are not distinct notes, so the
  filename isn't auto-shown as a meaningless repeated column), but `path` keeps
  the base file for write-back.
- `note`: the row object (the frontmatter-equivalent record).
- `formula`: `{}` (filled in later by the query engine).

From `rows.test.ts`:

```ts
const META = { name: "Library", path: "Library.md" };

// YAML list body
parseRows(
  "- title: Capital\n  author: Marx\n  rating: 4\n- title: Normal People\n  author: Rooney\n  rating: 5",
  META,
)
// → rows[0].note.title === "Capital", rows[0].note.rating === 4 (number),
//    rows[0].file.name === "" , rows[0].file.path === "Library.md"

// multi-line cell via YAML block scalar
parseRows("- front: q\n  back: |-\n    line 1\n    line 2", META)
// → rows[0].note.back === "line 1\nline 2"

// GFM table fallback
parseRows("| title | rating |\n| --- | --- |\n| Capital | 4 |", META)
// → rows[0].note.title === "Capital", rows[0].note.rating === 4

parseRows("", META)              // → []
parseRows("just some prose", META) // → []
```

`serializeRows(rows, columnOrder?)` writes rows back to the **canonical
YAML-list** body (never a markdown table). `undefined` cell values are dropped
(so empty cells don't serialize as `key: null`). With a `columnOrder` array,
keys are emitted in that order, then any remaining keys appended alphabetically;
without it, insertion order is preserved. An empty `rows` array serializes to
`""`. Round-trip is stable:

```ts
const rows = parseRows("- a: 1\n  b: x", META);
parseRows(serializeRows(rows), META)
// → back[0].note.a === 1, back[0].note.b === "x"
```

## Server-side `POST /rows`

The single source-resolution endpoint. It is registered in the **read** route
table (NOT `mutatingRoutes`) — despite being a `POST`, it is read-only (the body
carries the spec, which is too large/structured for a query string), so it does
**not** invalidate caches or broadcast SSE.

### Request / response

```http
POST /rows
Content-Type: application/json

{ "spec": <SourceSpec> }
```

Response: `200` with the resolved `Row[]` JSON.

The handler (`core/src/server.ts`):

```ts
"POST /rows": async (req, __) => {
  const { spec } = (await req.json()) as { spec: SourceSpec };
  let rowsMemo: Promise<Row[]> | null = null;
  let tasksMemo: Promise<Row[]> | null = null;
  const rows = await resolveSource(spec, {
    root: cfg.vault,
    today: todayISO(),
    vaultRows: () => (rowsMemo ??= getCachedRows()),
    vaultTasks: () => (tasksMemo ??= getCachedTasks()),
  });
  return ok(rows);
},
```

### Caching at three layers

1. **Per-resolution memo (`rowsMemo` / `tasksMemo`).** One `/rows` call can hit
   the unscoped vault feeds many times (base composition + `from:` chains).
   These memos ensure the vault rows / global task feeds build (or fetch from the
   server cache) **at most once per request**. They cover the unscoped case
   only — scoped task extraction (`from:` → `buildTaskRows(root, paths)`)
   bypasses the provider and always runs fresh.

2. **Server vault-feed cache (`getCachedRows` / `getCachedTasks`).** The server
   keeps lazy caches for the **unscoped** feeds, shared by `/vault-data`,
   `/rows`, and the source resolver:

   ```ts
   let cachedRows: Row[] | null = null;
   let cachedTasks: Row[] | null = null;
   async function getCachedRows()  { if (cachedRows === null)  cachedRows  = await buildVaultRows(cfg.vault); return cachedRows; }
   async function getCachedTasks() { if (cachedTasks === null) cachedTasks = await buildTaskRows(cfg.vault, undefined); return cachedTasks; }
   ```

   Both are **nulled on any vault change** (in `applyDirty`, after the 250ms
   file-watch debounce) and rebuilt lazily on the next read. Because the resolver
   reads the live frontmatter/body, content-only edits still re-resolve correctly
   on the next `/rows`.

3. **Client SWR row cache (`bases/rowCache.ts`).** See below.

### `today`

`POST /rows` passes `today: todayISO()` so the Tasks DSL relative-date
predicates in a `tasks` `where` resolve against the server's current date.

## Frontend resolution (`BaseView` + row cache)

The frontend never re-implements per-kind resolution — it sends the spec to
`/rows`. `app/src/api.ts`:

```ts
resolveRows: (spec: SourceSpec) => {
  const key = JSON.stringify(spec);
  const inflight = rowsInflight.get(key);
  if (inflight) return inflight;                 // dedup identical concurrent specs
  const p = postJson<Row[]>("/rows", { spec }).finally(() => rowsInflight.delete(key));
  rowsInflight.set(key, p);
  return p;
},
```

`api.resolveRows` **dedups** identical concurrent specs (the same base reopened
in a split, or many ` ```query ` blocks pointing at one base) onto a single
in-flight POST, keyed by the serialized spec and cleared once it settles.

`BaseView.loadConfig` decides the spec and whether to resolve client-side or
via `/rows`:

- **`props.view`** (a flat ` ```query ` block): `spec = v.source` (the block's
  `of:`/`tasks:` source); `inlineRows = null`.
- **`props.path`** (a `type: base` md file): parse the file; then
  `spec = config.source ?? (rows.length ? { kind: "base" } : { kind: "notes" })`.
  An own-rows base (`{kind:"base"}` with the parsed inline rows) sets
  `inlineRows = rows` so it is **not** sent to `/rows`; a sourceless query base
  defaults to `{kind:"notes"}`.
- **`props.source`** (raw inline config string): parse it; `spec = config.source
  ?? { kind: "notes" }`.

Then:

```ts
const rows = loaded.inlineRows ?? (loaded.spec ? await api.resolveRows(loaded.spec) : []);
```

i.e. `BaseView.resolveRows = inlineRows ?? api.resolveRows(spec)` — an own-rows
base paints from its locally-parsed rows; everything else (notes / tasks /
base-ref) goes server-side via `/rows`, which follows composition + scoped tasks.
A view with no spec at all → `[]` (empty state).

### Client SWR cache (`RowCache`)

`bases/rowCache.ts` is a small string-keyed stale-while-revalidate cache,
freshness-tracked against the SSE server version (`serverVersion.ts`):

- `peek(key)` → cached value (even if stale) or `undefined`.
- `isFresh(key, version)` → true only when a non-stale entry exists at exactly
  `version`. On a fresh hit, `BaseView` **skips the `/rows` round-trip** entirely.
- `set(key, value, version)` records a fresh entry.
- `invalidate(version)` marks every entry resolved **before** `version` stale
  (a vault change can alter any base's rows, and the spec is resolved
  server-side so the client can't tell which — over-revalidating is safe). Cached
  values are kept so reopens still paint instantly.

In `BaseView`: an effect calls `rowCache.invalidate(serverVersion())` on every
version bump; the resource re-runs on view-change **or** version bump; on a fresh
cache hit it returns the cached rows without calling `/rows`; otherwise it
resolves, then `rowCache.set(key, result, version)`. Solid keeps the previous
value painted while revalidating, so reopening a base or opening it in a split
paints instantly from the last resolution (a `BaseSkeleton` shows only on cold
load).

## Edge cases & gotchas (summary)

- **Unquoted `from: [[X]]` / `ref: [[X]]`** parse as nested YAML arrays, not
  strings — `wikiStr` coerces them back, but prefer quoting. An uncoerced drop
  silently widens a scoped tasks base to the whole vault.
- **`normalizeSource` returns `undefined` for unknown input** — callers must
  supply their own default; an unknown `kind` (object or string) is not a hard
  error.
- **Composition follows the referenced base's OWN source**, not its static rows.
  `{kind:"base", ref:"[[Keep]]"}` runs Keep's `source: notes/tasks/base` query.
- **Cycles return `[]`, not an error** — and symlink cycles are caught via
  real-path resolution in `seen`.
- **Missing / unreadable base files return `[]`** (no throw).
- **Scoped task extraction always runs fresh** — only the unscoped global feeds
  are cached (server `cachedTasks` / per-request `tasksMemo`).
- **Base-row `file.name`/`file.basename` are empty** — base rows are synthetic,
  not distinct notes; only `file.path` (the base file) is meaningful for
  write-back.
- **A `.base`-extension ref resolves the `.base` file**, not a `.md` sibling
  (`refToPath` leaves an existing `.md`/`.base` extension intact).
- **`POST /rows` is read-only despite being POST** — no cache invalidation, no
  SSE broadcast; it lives in the read route table.

Source: core/src/bases/sourceSpec.ts, core/src/bases/source.ts, core/src/bases/rows.ts, core/src/bases/types.ts, core/src/bases/parse.ts, core/src/server.ts, core/src/api.ts (app/src/api.ts), app/src/bases/BaseView.tsx, app/src/bases/rowCache.ts, core/test/bases/source.test.ts, core/test/bases/sourceSpec.test.ts, core/test/bases/rows.test.ts, core/test/bases/queryBlock.test.ts
