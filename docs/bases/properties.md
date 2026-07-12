# Per-base properties (`properties:`)

The `properties:` frontmatter key of a `type: base` note comes in **two forms**. The classic **map form** attaches metadata (a display name, a hide flag) to properties that are otherwise discovered from the rows. The **list form** goes further: it **declares the base's own property set** — the fields its cards/rows carry — so a board's fields belong to the board itself instead of to whatever frontmatter its notes happen to accumulate.

Parsing lives in `normalizeProperties` (`core/src/bases/parse.ts`); the declared-set consumers are `runView`'s column resolution (`core/src/bases/query.ts`) and the pure helpers in `core/src/bases/properties.ts` (`declaredDefaults`, `declaredPropertyKeys`).

---

## Map form — metadata over auto-derived properties (classic)

```yaml
---
type: base
properties:
  status:
    displayName: Status
  order:
    hidden: true
---
```

`Record<name, def>` where each def is:

| Field | Type | Effect |
| --- | --- | --- |
| `displayName` | string | Custom header label for the column (`columnLabel`). |
| `hidden` | `true` | Omits the property from **auto-derived** columns. An explicit view `order:` listing it still wins. |
| `type` | `"text" \| "number" \| "checkbox" \| "date" \| "time" \| "list" \| "link"` | Informational value type (unknown values drop to `undefined`). |
| `default` | any non-null value | Seeded onto new cards **only in the list form** (see below); tolerated as metadata here. |

With the map form (or no `properties:` at all) a view without an explicit `order:` derives its columns by **unioning the rows' own frontmatter keys** (`deriveColumns`). That is exactly right for a base that *reads existing pages* — e.g. a table over your `#book` notes should keep reflecting whatever frontmatter those notes carry. Nothing about this behavior changed.

## List form — the base declares its own property set

```yaml
---
type: base
filters:
  and:
    - file.inFolder("thoughts/My Board")
properties:
  - status
  - description
  - name: priority
    type: number
    default: 1
  - name: worktree
    displayName: Worktree
views:
  - type: kanban
    name: Board
    groupBy: status
---
```

Each list entry is either a **bare property name** or a map with:

| Field | Required | Meaning |
| --- | --- | --- |
| `name` | yes | The frontmatter key (bare names recommended; `note.x` is accepted and treated as `x`; `file.*`/`formula.*` ids are allowed as read-only columns). Entries without a usable name are skipped; duplicate names keep the first. |
| `type` | no | Value type, same vocabulary as `schema` (unknowns → `undefined`). |
| `default` | no | Value seeded onto **new cards** (kanban add-card). `false`/`0`/`""` are real defaults; `null`/missing means "no default". |
| `displayName` / `hidden` | no | Same metadata as the map form. |

The parsed config carries the names in declaration order as `BaseConfig.declaredProperties`; its presence is the flag that the base declares its own set (the map form never sets it, so existing bases are untouched).

### What a declaration changes

1. **Columns / card fields.** A view without an explicit `order:` shows **exactly the declared properties, in declaration order** (canonicalized: `status` → `note.status`), instead of the row-frontmatter union — a stray extra key on one note no longer leaks a column/field onto every card. `file.name` is still seeded first when the rows are real notes (declare it yourself to reposition it; `hidden: true` drops any declared entry). An explicit view `order:` **always wins**, exactly as before.
2. **Kanban card meta.** A kanban without an `order:` shows the declared properties (minus the title and description slots, and minus the `groupBy` property — the column a card sits in already conveys it) as each card's read-only meta rows — previously only an explicit `order:` produced meta. Empty values are still dropped per `hasValue`.
3. **New cards seed the declared defaults.** Kanban's add-card writes every declared writable property that has a `default` (via `declaredDefaults`), then the values shared by all existing sibling cards (`constProps` — so the new card keeps matching the base's filter), then the clicked column's status value. The status/description/`order` keys are never seeded from defaults.
4. **Pickers offer declared fields.** The view-settings dropdowns (`BaseSettings`) union the declared names with the row-derived columns, so a declared-but-not-yet-populated field can be bound/sorted/grouped immediately.

### What it does NOT change

- **Bases that read existing pages keep reflecting the notes' own frontmatter** — no declaration, no change: columns still derive from the rows.
- The `properties:` **map form keeps its exact metadata-only semantics**; it never restricts columns.
- Full-pane views (calendar / flashcards) use their own field bindings, not `runView` columns.
- Filtering/sorting/grouping can still reference undeclared properties — the declaration shapes *display and creation*, it is not a validation schema.
- `schema:` (column → type, used by the calendar serializer) is unrelated and unchanged; a declared `type` is per-property metadata for editors/tooling.

### Example: fields scoped to the board

```yaml
---
type: base
filters:
  and:
    - file.inFolder("projects/Tracker")
properties:
  - status
  - name: effort
    type: number
    default: 1
  - name: due
    type: date
views:
  - type: kanban
    name: Tracker
    groupBy: status
---
```

Cards on this board show `effort` and `due` (and nothing else, however messy the notes' frontmatter gets); a card added to the "Todo" column is created with `status: Todo`, `effort: 1`.
