# Per-base properties (`properties:`)

The `properties:` frontmatter key of a `type: base` note comes in **two forms**. The classic **map form** attaches metadata (a display name, a hide flag) to properties that are otherwise discovered from the rows. The **list form** goes further: it **declares the base's own property set** — the fields its cards/rows carry — so a board's fields belong to the board itself instead of to whatever frontmatter its notes happen to accumulate.

Parsing lives in `normalizeProperties` (`core/src/bases/parse.ts`); the declared-set consumers are `runView`'s column resolution (`core/src/bases/query.ts`) and the pure helpers in `core/src/bases/properties.ts` (`declaredDefaults`, `declaredPropertyKeys`, and — for a property's functional type — `propertyType` / `parseBasePropertyType` / `validatePropertyValue` / `coercePropertyValue`).

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
| `type` | a type string (see [Property types](#property-types)) | The property's functional value type. Parsed into a canonical `BasePropertyType`. |
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
| `type` | no | The property's functional value type (see [Property types](#property-types)). Absent → untyped; unrecognized → `text` (tolerant). |
| `options` | for `select`/`multiselect` | The allowed choices. |
| `number` | for `number` | Number format: `plain` \| `unit` \| `currency` \| `percent`. |
| `unit` | for `number` | Unit label (e.g. `kg`) or currency code (e.g. `USD`). |
| `expr` | for `formula` | The formula expression. |
| `default` | no | Value seeded onto **new cards** (kanban add-card). `false`/`0`/`""` are real defaults; `null`/missing means "no default". |
| `displayName` / `hidden` | no | Same metadata as the map form. |

## Property types

A property's `type` is **functional**, not just informational (#99): it is parsed into a canonical `BasePropertyType` — a discriminated `kind` plus optional carriers — that is the single source of truth for the property's type. The value entry points (`propertyType`, `validatePropertyValue`, `coercePropertyValue`) live in `core/src/bases/properties.ts`; a settings panel is built on top of it by later work.

### The kanban inline editor is type-driven (#100)

The kanban card's inline meta-chip editor (`app/src/bases/{KanbanCard.tsx,PropertyValueEditor.tsx,propertyEdit.ts}`) reads a property's DECLARED type (`propertyType(config, id)`) and, when present, picks the editor/display straight from it — no more heuristic-guessing for a typed property:

| Declared `kind` | Editor | Display |
| --- | --- | --- |
| `text` | single-line input | plain text (unchanged) |
| `markdown` | multiline textarea | block markdown (`bases/markdown.ts` `renderMarkdown`) |
| `number` | numeric input | formatted per `number`/`unit` — see below |
| `boolean` | the existing `Chip` toggle | unchanged |
| `date` | `<input type=date>` | unchanged |
| `datetime` | `<input type=datetime-local>` | unchanged |

`select`/`multiselect`/`list`/`link`/`formula` have **no dedicated editor yet** (#101/#102) — a declared property of one of those kinds falls through to the pre-#100 heuristic (vault-wide `.settings` registry, then the value's runtime type, then a "known sibling values" picker), so nothing regresses. A property with **no declared type at all** (`propertyType` returns `undefined`) takes the exact same fallback path — untyped bases are byte-for-byte unaffected.

**Number format display** (`app/src/bases/numberFormat.ts`, pure + unit-tested):
- `plain` — the raw value, as-is.
- `unit` — `"<value> <unit>"` (e.g. `unit: kg` → `"5 kg"`); bare value when no unit is set.
- `currency` — `Intl.NumberFormat({style:"currency"})` keyed by `unit` as an ISO-4217 code (defaults `USD` when unset), e.g. `unit: USD` → `"$5.00"`.
- `percent` — **the stored/frontmatter value is a plain fraction 0–1** (`0.25` means 25%), matching what `Intl.NumberFormat({style:"percent"})` expects natively — so display needs no manual ×100. The EDIT BOX, though, shows/accepts the human percentage number (`25`, not `0.25`) since typing a fraction is far more surprising than typing a percentage; the ×100/÷100 conversion happens only at that edit boundary (`numberEditValue`/`parseNumberEdit`), so the canonical stored value always stays the 0–1 fraction.

### Type kinds

| `type:` | Canonical `kind` | Carriers | Meaning |
| --- | --- | --- | --- |
| `text` | `text` | — | Plain single-line text. |
| `markdown` | `markdown` | — | Rich text / markdown body. |
| `number` | `number` | `number` (format), `unit` | Numeric value; `number: plain\|unit\|currency\|percent`, `unit:` the label/currency code. |
| `boolean` | `boolean` | — | Checkbox. |
| `select` | `select` | `options` | Single choice from `options`. |
| `multiselect` | `multiselect` | `options` | Any subset of `options`. |
| `date` | `date` | — | Calendar date (`YYYY-MM-DD`). |
| `datetime` | `datetime` | — | Date + time (ISO-8601). |
| `list` | `list` | — | Free list of values. |
| `link` | `link` | — | Wikilink to another note. |
| `formula` | `formula` | `expr` | Value computed from `expr`. |

### Legacy vocabulary (still accepted)

The pre-#99 informational strings map onto canonical kinds so existing bases keep working unchanged:

| Legacy `type:` | Maps to `kind` |
| --- | --- |
| `text` | `text` |
| `number` | `number` |
| `checkbox` | `boolean` |
| `date` | `date` |
| `time` | `datetime` |
| `list` | `list` |
| `link` | `link` |

Parsing is tolerant: a property with no `type:` is **untyped** (`type` is `undefined`); a `type:` present but unrecognized falls back to `text`; unknown number formats are dropped (keeping a plain `number`), and empty `options` are dropped. Type strings are matched case-insensitively.

### Richer object form (examples)

```yaml
properties:
  - name: priority
    type: number
    number: currency
    unit: USD
  - name: stage
    type: select
    options: [todo, doing, done]
  - name: labels
    type: multiselect
    options: [urgent, blocked]
  - name: pricePerUnit
    type: formula
    expr: price / qty
```

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
- `schema:` (column → type, used by the calendar serializer) is unrelated and unchanged; a declared property `type` is the canonical `BasePropertyType` consumed by editors/validation (see [Property types](#property-types)).

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
