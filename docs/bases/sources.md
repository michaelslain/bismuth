# Base sources

A base's `source` says where its rows come from: the notes in the vault, the checkbox tasks in them, or the rows of another base. Every other part of a base, from filters to the view, works on the rows the source produces. This page is for anyone writing a `source:`, and for the person debugging a base that shows too many, too few or the wrong rows.

```yaml
---
type: base
source: notes where file.hasTag("book")
view: table
---
```

## What can a source be?

A source has one of these kinds. In frontmatter it is a string, or an object with the same fields.

| Kind | Rows | Fields |
|---|---|---|
| `notes` | Vault notes, one row each. | `where`, `from` |
| `tasks` | Checkbox tasks found in vault notes, one row each. | `where`, `from` |
| `base` | The rows of another base. | `ref` |

| Field | Kinds | Meaning |
|---|---|---|
| `where` | `notes`, `tasks` | A [Bases expression](./query-syntax.md) that keeps the rows where it is true. |
| `from` | `notes`, `tasks` | A wikilink to a base. Limits the source to the notes that base selects. |
| `ref` | `base` | A wikilink to the base whose rows to use. |

These spellings are equivalent where they overlap:

| Frontmatter | Means |
|---|---|
| `source: notes` | Every note. |
| `source: notes where folder == "Keep"` | Notes where the expression is true. |
| `source: tasks` with `from: "[[Keep]]"` and `where: not done` | Tasks in the notes `Keep` selects, filtered. |
| `source: base` with `ref: "[[X]]"` | The rows of base `X`. |
| `source: { kind: notes, where: 'file.hasTag("book")' }` | The object form of `notes where ...`. |
| `source: { kind: tasks, from: "[[Keep]]" }` | The object form with a scope. |

In the string form, `from`, `ref` and `where` can also sit as top-level keys beside `source`. An inline `where` in the string wins over a top-level `where`: `source: tasks where done` with `where: not done` filters by `done`. A source of another shape (`source: bogus`, `source: 42`, an object with an unknown `kind`) is ignored without an error.

## What happens when a base has no source?

A base with no recognised `source` uses its own rows when its body has any, and otherwise every note in the vault. So the empty base `type: base` shows the whole vault, and a base with rows in its body shows only those rows. Set `source:` explicitly when you want to narrow the vault.

## How do I list tasks from one set of notes?

`from` limits a `notes` or `tasks` source to the notes another base selects. A base that shows only the tasks inside the notes of a `Keep` base:

`Keep.md`:

```yaml
---
type: base
source: notes
where: file.hasTag("keep")
---
```

`Do Now.md`:

```yaml
---
type: base
source: tasks
from: "[[Keep]]"
view: table
---
```

If `keep/x.md` is tagged `keep` and holds `- [ ] scoped task`, and `other/y.md` is not tagged and holds `- [ ] unscoped task`, the base shows only `scoped task`. The referenced base is resolved first through its own source, so `from: [[Keep]]` selects exactly the notes `Keep` would show. Without `from`, a `tasks` source reads every task in the vault. Task line syntax is in [tasks](../tasks/syntax.md).

## How do I build on another base's rows?

`source: base` with a `ref` uses the rows of another base, which is how one set of rows gets a second view. The referenced base's own source is followed, so a `ref` to a base with `source: notes where file.hasTag("keep")` yields those notes, not the referenced file's body.

```yaml
---
type: base
source: base
ref: "[[Keep]]"
view: cards
---
```

Only rows carry over. The referenced base's `filters`, `formulas`, `properties`, `sort` and `groupBy` are not applied, so restate any filter you need. [Bases overview](./overview.md#how-do-i-show-the-same-rows-in-a-second-view) has a worked example. A cycle (A refs B refs A), a missing base and a `source: base` with no `ref` all resolve to zero rows without an error.

## How are wikilinks in `from` and `ref` found?

A wikilink resolves the way a note link does. An exact vault path wins: `[[reading/List]]`, or a root-level `[[List]]` that exists. Otherwise the base name is searched across the vault and the match with the fewest path segments wins, then the smaller path, so `[[List]]` finds `reading/List.md`. If nothing matches, the source yields no rows, and `bismuth base validate` reports the path it looked for.

Quote wikilinks in YAML. An unquoted `from: [[Keep]]` parses as a nested list, not a string. Bismuth rebuilds the string, so an unquoted link works, but quoting avoids relying on it.

## What can go wrong with a tag filter?

A bare `#tag` is not a filter, and each place it appears fails differently:

- Unquoted, `source: notes where #book` is a YAML comment, so the source becomes `notes` and the base shows the whole vault.
- Inside the string form, `notes where "#book"` is a non-empty string, which is true for every note.
- As `where: "#book"` it is a parse error and the base shows zero rows.

Write `file.hasTag("book")`: no `#`, and it matches the exact tag only, not `book/x`. To match subtags, list them: `file.hasTag("book", "book/x")`.

## How does a tasks `where` differ from a notes `where`?

Both are Bases expressions evaluated per row, so `source: tasks where !note.resolved && note.priority == "high"` works like a notes filter. A `tasks` `where` that holds Tasks-style text (`not done`, `due before tomorrow`, a `sort by` line) is translated into an expression when the base is read. A migrated query uses a plain expression plus a separate `sort`; see [the tasks query language](../tasks/query-dsl.md). Sorting a task source is the view's `sort`, which ranks a property named `priority` by urgency (`highest`, `high`, `medium`, `none`, `low`, `lowest`) rather than alphabetically.

## Can I edit the source without writing YAML?

Open **Settings** in the view bar and use the **source** section. Its "rows from" choice writes:

| Choice | Writes |
|---|---|
| this base's own rows | removes `source:` |
| vault notes | `source: { kind: notes, where?, from? }` |
| vault tasks | `source: { kind: tasks, where?, from? }` |
| another base | `source: { kind: base, ref: "[[Other]]" }` |

`where` is built with the condition editor described in [filters](./filters.md#can-i-edit-filters-without-writing-yaml), and "limit to base" is `from`. The panel always writes the object form, which needs no sibling keys and which YAML quotes, so a `#` in an expression cannot become a comment. It also removes the top-level `where`, `from` and `ref` that a string-form source read. An untouched section writes nothing.

## What can go wrong?

| Symptom | Cause |
|---|---|
| A scoped tasks base shows nothing. | `from` names a base that does not exist, or one that selects no notes with tasks in them. |
| The whole vault shows. | The `source` is unrecognised, or a `#tag` was read as a comment. |
| A composed base ignores the other base's filters. | Composition carries rows only; restate the filters. |
| Zero rows from a `ref`. | A cycle, a missing base or no `ref`. |
| Row `file.name` is empty. | The rows are stored in a base body; they are not separate notes. |
| Changing an upstream base's `source` changes a downstream base. | `from` and `ref` re-run the upstream base's own source. |

## How it works

A `source` is parsed into a `SourceSpec` (`core/src/bases/types.ts`) by `normalizeSource(raw, fm)` in `core/src/bases/sourceSpec.ts`:

```ts
type SourceSpec =
  | { kind: 'base'; ref?: string }
  | { kind: 'notes'; where?: string; from?: string }
  | { kind: 'tasks'; where?: string; from?: string }
```

A string is matched against `/^(base|notes|tasks)(?:\s+where\s+(.+))?$/i`, and the sibling keys `from`, `ref` and `where` come from the surrounding frontmatter. `wikiStr` rebuilds `"[[X]]"` from the nested array YAML produces for an unquoted link. `refToPath` turns a wikilink into a vault path by appending `.md`; `resolveRefPath` in `core/src/bases/source.ts` then applies the exact-path-then-basename rule above.

A `SourceSpec` also comes from a flat ` ```query ` block (`of:` becomes `base`, `tasks:` becomes `tasks`; see [the query block](./query-block.md)). `resolveSource(spec, ctx)` returns `Row[]`:

- `base`: no `ref` gives `[]`; otherwise `resolveBaseRows` on the referenced file.
- `notes`: the vault notes feed, intersected with `from`'s paths when set, then filtered by `where` through `passesFilter`.
- `tasks`: with `from`, `buildTaskRows(root, paths)` extracts tasks from only those files, always fresh; without it, the global task feed, which a caller may cache. `where` then filters through the same `passesFilter`.

`resolveBaseRows(path, ctx)` reads the base file, parses it (cached by file content, not mtime), and resolves its `source` recursively. With no `source`, it returns its own body rows, or every note when it has none. `ctx.seen` holds the real, symlink-resolved path of every base entered, so a config cycle or a symlink loop returns `[]` instead of throwing. A missing or unreadable base also returns `[]`. `SourceCtx` carries the vault `root`, an ISO `today` for relative dates, `seen`, and optional `vaultRows` and `vaultTasks` providers that let a server serve the unscoped feeds from a cache.

### How `POST /rows` resolves and caches

`POST /rows` takes `{ "spec": <SourceSpec> }` and returns the resolved `Row[]`, filtered by the caller's visibility. It sits in the read route table (`core/src/routes/bases.ts`) despite being a POST, so it neither invalidates caches nor broadcasts an SSE event. Rows are cached at these layers:

1. A per-request memo builds the unscoped notes and task feeds at most once per call, however many `from` and `ref` hops there are. Scoped task extraction bypasses it.
2. The server keeps `rowsCache` and `tasksCache` (`createAsyncCache` in `core/src/asyncCache.ts`): concurrent callers share one build, and an invalidation that lands mid-build drops that build's result. After the file-watch debounce, `patchVaultRows` and `patchTaskRows` re-parse only the changed notes and splice them in; they fall back to a full invalidate when nothing safe can be patched, and a change with no specific paths invalidates outright. The patch is awaited before the SSE event is published, so a client that refetches sees the patched feed.
3. The client's stale-while-revalidate `RowCache` (`app/src/bases/rowCache.ts`) serves a reopened base instantly and revalidates against the SSE version.

`api.resolveRows` (`app/src/api.ts`) merges identical concurrent specs into one request, keyed by the serialized spec and the server version, so a write is never answered by an older in-flight request. `BaseView` resolves a base's own rows client-side from the already-parsed file and sends every other spec to `/rows`.

### How are body rows parsed?

`parseRows(body, meta)` in `core/src/bases/rows.ts` turns a base body into rows. The canonical body is a YAML list of objects; a GFM pipe table is read as well. An empty or prose-only body yields `[]`. Each row gets a synthetic `file` with an empty `name` and the base's `path` (kept for write-back), the object as `note`, and a zero-based `index` for write-back. `serializeRows(rows, columnOrder?)` writes the YAML list, drops undefined values so empty cells do not become `key: null`, and emits keys in `columnOrder` first, then alphabetically.

```ts
parseRows('- title: Capital\n  author: Marx\n  rating: 4', { name: 'Library', path: 'Library.md' })
// rows[0].note.rating === 4 (a number), rows[0].file.name === '', rows[0].file.path === 'Library.md'
parseRows('- front: q\n  back: |-\n    line 1\n    line 2', meta)   // back === 'line 1\nline 2'
parseRows('| title | rating |\n| --- | --- |\n| Capital | 4 |', meta) // rating === 4
```

Source: `core/src/bases/sourceSpec.ts`, `core/src/bases/source.ts`, `core/src/bases/rows.ts`, `core/src/bases/types.ts`, `core/src/bases/taskDsl.ts`, `core/src/bases/tasksData.ts`, `core/src/basesData.ts`, `core/src/asyncCache.ts`, `core/src/routes/bases.ts`, `app/src/api.ts`, `app/src/bases/BaseView.tsx`, `app/src/bases/rowCache.ts`, `app/src/bases/SourceFields.tsx`, `core/test/bases/source.test.ts`, `core/test/bases/sourceSpec.test.ts`, `core/test/bases/rows.test.ts`
