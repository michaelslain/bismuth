# Base properties

The `properties:` key of a base has two forms. The map form attaches a label or a hide flag to properties that the base discovers in its rows. The list form declares the base's own fields, with types, options and defaults, so a board's fields belong to the board and not to whatever frontmatter its notes happen to carry.

Use the map form when a base reads existing notes and you only want nicer column labels. Use the list form when the base is the home of its cards, such as a kanban board.

```yaml
---
type: base
properties:
  - status
  - name: priority
    type: number
    default: 1
  - name: stage
    type: select
    options: [todo, doing, done]
view: kanban
groupBy: stage
---
```

## How do I label or hide a property?

In the map form, `properties` maps a property name to a definition. Without a `properties` list, a view without `order` shows the union of the rows' own frontmatter keys, which suits a base that reads existing notes.

```yaml
properties:
  status:
    displayName: Status
  order:
    hidden: true
```

| Field | Type | Effect |
|---|---|---|
| `displayName` | string | Header label for the column. |
| `hidden` | `true` | Leaves the property out of the automatically derived columns. A view `order:` that lists it still shows it. |
| `type` | a type string | The property's value type; see [property types](#what-property-types-are-there). |
| `default` | any non-null value | Seeded onto new cards in the list form; tolerated as metadata here. |

## How do I declare a base's own fields?

In the list form each entry is a bare name or a map. The list declares the base's property set, so a view without `order:` shows exactly these properties in this order.

```yaml
properties:
  - status
  - description
  - name: priority
    type: number
    default: 1
  - name: worktree
    displayName: Worktree
```

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | The frontmatter key. A `note.x` prefix is accepted and means `x`; `file.*` and `formula.*` ids are allowed as read-only columns. Entries without a usable name are skipped and duplicate names keep the first. |
| `type` | no | The value type. No `type` means untyped; an unrecognised one means `text`. |
| `options` | for `select`, `multiselect` | The allowed choices. |
| `number` | for `number` | Display format: `plain`, `unit`, `currency` or `percent`. |
| `unit` | for `number` | A unit label such as `kg`, or a currency code such as `USD`. |
| `expr` | for `formula` | The formula expression. |
| `default` | no | Value written onto new cards. `false`, `0` and `""` are real defaults; `null` or absent means none. |
| `displayName`, `hidden` | no | The same as in the map form. |

A declaration changes these things:

1. Columns and card fields come from the declaration, in order, instead of from the union of the rows' keys. A stray key on one note adds no column. `file.name` is still placed first when the rows are real notes; declare it yourself to move it. An explicit `order:` always wins.
2. A kanban without `order:` shows the declared properties as each card's editable chips, leaving out the title and the `groupBy` property.
3. A kanban's add-card action writes every declared writable property that has a `default`, then the values shared by all sibling cards (so the new card matches the base's filter), then the clicked column's group value.
4. The settings pickers offer declared fields, so a declared field with no data yet can be sorted, grouped or bound straight away.

A declaration shapes display and creation. It is not a validation schema: filters, sorts and groups can still use undeclared properties, and bases that read existing notes keep reflecting the notes' own frontmatter. Calendar and flashcards views use their own field bindings, not declared columns.

## What property types are there?

A property's `type` is functional: it selects the editor and the display.

| `type` | Meaning |
|---|---|
| `text` | Plain single-line text. |
| `markdown` | A multiline markdown body. |
| `number` | A number, formatted by `number` and `unit`. |
| `boolean` | A checkbox. |
| `select` | One choice from `options`. |
| `multiselect` | Any subset of `options`. |
| `date` | A calendar date, `YYYY-MM-DD`. |
| `datetime` | A date and time, ISO-8601. |
| `list` | A free list of values. |
| `link` | A wikilink to another note. |
| `formula` | A value computed from `expr`; read-only. |

Type strings are case-insensitive. Two aliases are accepted: `checkbox` means `boolean` and `time` means `datetime`. Unknown number formats are dropped, leaving a plain number, and empty `options` are dropped.

A property named `description` with no declared type and no vault-wide registry entry is edited as `markdown`. Declare an explicit `type` to change that.

### How are numbers formatted?

```yaml
properties:
  - name: price
    type: number
    number: currency
    unit: USD          # shows $19.99
  - name: weight
    type: number
    number: unit
    unit: kg           # shows 5 kg
  - name: progress
    type: number
    number: percent    # stored as 0.8, shows 80%
  - name: score
    type: number
    number: plain      # shows the bare number
```

`plain` shows the stored value. `unit` shows `<value> <unit>`, or the bare value when no unit is set. `currency` uses the `unit` as an ISO-4217 code and defaults to `USD`. `percent` stores a fraction between 0 and 1, so `0.25` displays as 25%; the edit box shows and accepts the percentage number (`25`) and converts at the boundary.

### How do select and multiselect work?

Both declare their choices with `options`:

```yaml
properties:
  - name: stage
    type: select
    options: [todo, doing, done]
  - name: labels
    type: multiselect
    options: [urgent, blocked, needs-review]
```

A `select` opens a dropdown of the options. A `multiselect`, and an undeclared list of strings such as `tags`, is edited as one line of comma-separated text (`planning, docs`) with the note editor's completion popup offering values that start with what you typed. For a tag column the popup offers the column's values first, then every tag in the vault.

Enter or leaving the field commits the list; Escape cancels. Opening the field and leaving it without typing never writes. A list holding numbers, links or a value that contains a comma is shown read-only. A stored value outside the declared `options` is kept, not dropped.

### How do formula properties work?

A property with `type: formula` computes its value from `expr`, using the same expression language as the base's `formulas:` map (see [expression syntax](./query-syntax.md)).

```yaml
properties:
  - name: price
    type: number
  - name: qty
    type: number
  - name: total
    type: formula
    expr: price * qty
```

The value appears as the column `formula.total`. It is read-only, and a stray `default` on it is never written. An explicit `formulas:` entry of the same name wins. An expression that reads a missing field follows normal arithmetic coercion (`price * qty` with no `qty` is `NaN`); an expression that fails to parse computes nothing and does not throw.

## Can I edit properties without writing YAML?

Open the base's **Settings** in the view bar. The properties section writes the list form for you, for every view kind. Each declared property is one line with its name, type and visibility; click one to expand its editor (name, type, type-specific extras, default, up and down arrows, delete). **add property** appends an entry, and the eye icon toggles `hidden`. The same panel edits `formulas:` and the rest of the base; see [filters](./filters.md#can-i-edit-filters-without-writing-yaml) and [sources](./sources.md#can-i-edit-the-source-without-writing-yaml). Saving writes only the keys that changed.

Map-form entries are not shown in the list; adding a row converts the key to list form and replaces the map. For a kanban, this section is also where the board's fields live.

## How it works

`normalizeProperties` in `core/src/bases/parse.ts` reads both forms. A list sets `BaseConfig.declaredProperties` (names in declaration order); its presence is the flag that the base declares its own set, and the map form never sets it. `parseBasePropertyType` in `core/src/bases/properties.ts` turns `type` and its carriers into a `BasePropertyType`, and `propertyType`, `validatePropertyValue`, `coercePropertyValue`, `declaredDefaults`, `declaredFormulas` and `declaredPropertyKeys` are the helpers views call.

`runView` in `core/src/bases/query.ts` resolves columns from the declaration and merges `declaredFormulas(base)` into `base.formulas` before computing formulas, so a declared formula runs through the same per-row pass as a top-level one. A formula property canonicalizes to a `formula.<name>` id, and every write path treats a `formula.` id as non-writable, which is what makes it read-only.

The kanban card's inline editor (`app/src/bases/KanbanCard.tsx`, `PropertyValueEditor.tsx`, `propertyEdit.ts`) picks its editor from the declared kind:

| Declared kind | Editor |
|---|---|
| `text` | single-line input |
| `markdown` | multiline textarea, rendered as block markdown |
| `number` | numeric input, displayed through `numberFormat.ts` |
| `boolean` | chip toggle |
| `date`, `datetime` | date or datetime-local input |
| `select` | dropdown |
| `multiselect` | the comma-separated field in `app/src/ui/TagsField.tsx` |
| `list`, `link` | no dedicated editor: falls back to the vault-wide `.settings` registry, then the value's runtime type, then a picker of known sibling values |

An untyped property takes that same fallback path. `base validate` checks each declared `default` against its type with `validatePropertyValue`.

Source: `core/src/bases/parse.ts`, `core/src/bases/properties.ts`, `core/src/bases/query.ts`, `core/src/bases/types.ts`, `app/src/bases/propertyEdit.ts`, `app/src/bases/PropertyValueEditor.tsx`, `app/src/bases/numberFormat.ts`, `app/src/bases/BaseSettings.tsx`, `app/src/ui/TagsField.tsx`
