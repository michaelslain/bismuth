# The query block

A fenced block with the language `query` renders a live view of a base or of the vault's tasks inside a note. It is the only embedded block: there is no `base`, `view` or `tasks` fence. Use it to show a table of open tasks in a project note, or a card view of a base, without opening the base itself.

````markdown
```query
tasks:
where: !note.resolved && note.priority == "high"
sort: note.due
```
````

A block has one of two forms, and the form is picked by the keys it contains:

- A flat spec points at a base (`of:`) or at tasks (`tasks:`) and adds a filter, sort, group and limit.
- A full inline base config is a base written inside the block, with its own `source`, `filters`, `formulas` and view.

## Which form does my block use?

The block is a full inline base config when any line starts with `filters:`, `formulas:`, `properties:`, `schema:`, `source:` or `views:`. Otherwise it is a flat spec. The forms are exclusive: a block with `source:` and `of:` is read as a config and the flat keys (`of`, `tasks`, `from`, `where`, `group`) are ignored. A block with only `view:` and view keys is a flat spec, so add `source:` when you want the config form.

## How do I write a flat spec?

A flat spec is one `key: value` per line. A line splits at its first colon, so `where: a:b` keeps `a:b` as the value; blank lines are skipped and a repeated key keeps its last value.

| Key | Meaning |
|---|---|
| `of: [[Base]]` | Render that base. It follows the base's own source, so a base over notes shows those notes. |
| `tasks:` | Query checkbox tasks. Bare `tasks:` means all tasks; narrow with `where:`. |
| `from: [[Base]]` | With `tasks:`, scope tasks to the notes that base selects. Alone it does nothing. |
| `view: <kind>` | The render kind; see [bases overview](./overview.md#what-view-kinds-are-there). `as:` is an alias; `view:` wins when both appear. |
| `where: <expr>` | A [Bases expression](./query-syntax.md) filtering the rows. |
| `sort: <property>[ desc][, ...]` | Sort keys applied in order. `desc` or `reverse` after a key reverses that key: `sort: note.due desc, note.name`. |
| `group: <property>` | Group rows by a property, ascending. |
| `limit: <n>` | Maximum rows. |

Examples:

````markdown
```query
of: [[Books]]
view: cards
limit: 20
```
````

````markdown
```query
tasks:
from: [[Keep]]
where: !note.resolved
view: kanban
group: status
```
````

`of:` and `tasks:` are exclusive: with both, `of:` wins and `tasks:` and `from:` are ignored.

A flat block never iterates the vault. A block with neither `of:` nor `tasks:`, or with `from:` alone, has no source and shows an empty state. To list notes, use the inline config form below, or point `of:` at a base whose `source` is `notes`.

If `view:` is missing or not a valid kind, the block renders as a `list` for a tasks query and a `table` for everything else, without an error.

Write conditions with `&&` and `||`. The expression language has no `and` keyword, so `!note.resolved and note.priority == "high"` parses as `!note.resolved`, drops the rest silently, and matches every unresolved task.

`sort: note.priority` ranks by urgency (`highest`, `high`, `medium`, `none`, `low`, `lowest`) when both values are those words; every other property sorts by the plain value order. A row missing the sort property sorts last.

A `tasks:` value can hold Tasks-style filter text such as `tasks: not done`, which is translated into an expression when the block is read. `bismuth base migrate-queries [--dry-run]` rewrites such blocks into the plain `tasks:` + `where:` + `sort:` form; see [the tasks query language](../tasks/query-dsl.md).

## How do I write a full inline base config?

The block body is the same YAML as a base file's frontmatter, without the `type` line:

````markdown
```query
source: notes where file.hasTag("book")
view: cards
sort:
  - property: rating
    direction: DESC
cardContent: properties
```
````

All the base keys work: `source`, `filters`, `formulas`, `properties`, `schema`, `view` and the view's own keys; see [bases overview](./overview.md#what-keys-does-a-base-file-have). The block has one view, written flat. In a block, `view` and `limit` mean what they mean in a base; `of`, `tasks`, `as` and `group` do not exist in this form. Use `groupBy` and a `source` of `base` with a `ref` instead.

A config block with no `source:` reads every note in the vault, which is the one way an inline block can iterate notes:

````markdown
```query
filters: file.folder == "reading"
view: list
```
````

A config that composes another base:

````markdown
```query
source:
  kind: base
  ref: "[[Master Library]]"
view: table
```
````

Malformed YAML in a config block gives an empty table. A `views:` list is read through its first entry only. A query block has no write-back that rewrites the block, so write it flat by hand.

## Can I build a query without writing it?

Yes. The visual query builder is a form with a live preview that generates the block body. Open it two ways:

- Type `/` in a note and choose **Query builder**. The block is inserted only when you confirm; cancelling leaves nothing behind.
- Click the pencil (**Edit query**) in a rendered block's view bar. The builder opens with that block's settings, and confirming rewrites just that block in one undoable edit.

The builder's source choice decides the form it writes:

| Source | Form written |
|---|---|
| Notes | A full inline config: `source: notes where <expression>` plus `view`, `sort`, `groupBy` and `limit`. |
| Tasks | A flat spec with `tasks:` text, and optional `from`, `view`, `group` and `limit`. |
| Base | A flat spec with `of:`, and optional `where`, `view`, `group` and `limit`. |

Note filters offer operators that follow the property's type (text, number, date, checkbox, tag, list, link) and compile to ordinary expressions such as `file.hasTag("book")` and `date(due) < today()`. The "match all / any" switch joins conditions with `&&` or `||`. An expression the builder cannot model is kept as written in an advanced field, so reopening a hand-edited query never drops it.

The pencil appears only when the builder can reproduce the block exactly. A flat spec always qualifies. A config block qualifies only if its keys are limited to `source`, `view`, `sort`, `groupBy` and `limit`, its source is `notes` or `notes where <expression>`, and the whole expression maps back to condition rows. A block with `filters:`, `formulas:`, `properties:` or `schema:` has no pencil and is edited as source.

## How do I edit a block's source?

The rendered block hides its fence. Click **Source** in its view bar to reveal the raw fence inline, with the caret in the body, and edit it like any markdown. It saves with the note, with no separate dialog. The block collapses back to the rendered view when the caret leaves it or when you click outside it. A base opened as a file uses a text panel with **save** and **cancel** buttons instead.

## What does autocomplete offer inside a block?

Completion works inside a `query` fence, for the flat spec only. The config form has no dedicated completer.

| Position | Offered |
|---|---|
| A fresh or partial key | `of`, `tasks`, `from`, `where`, `sort`, `view`, `group`, `limit`. |
| After `view:` or `as:` | Every view kind, each with a one-line description. |
| After `group:` | `status`, `priority`, `due`, `scheduled`, `file.folder`, `file.name`. |
| After `where:` | Starter expressions such as `!note.resolved`, `note.due == today()`, `note.priority == "high"` and `file.hasTag("book")`. |
| An empty `of:` or `from:` | A `[[ ]]` skeleton; typing `[[` hands over to wikilink completion. |
| After `tasks:` or `sort:` | Nothing. |

## What can go wrong?

- A flat block with no `of:` and no `tasks:` is an empty state, not the whole vault.
- One config key anywhere flips the whole block to config mode and ignores the flat keys.
- An unknown `view:` falls back silently to `list` (tasks) or `table`.
- A bare `#tag` is not a filter: in a config block, `source: notes where #book` is a YAML comment and shows the whole vault. Write `file.hasTag("book")`; see [sources](./sources.md#what-can-go-wrong-with-a-tag-filter).
- An unquoted `from: [[Base]]` in a config block is read as a nested list and rebuilt as a string; the flat parser keeps the literal text. Quote it in config blocks.
- A `query` fence that shows as a plain code block means the editor extension is not mounted in that surface.

## How it works

`app/src/editor/queryBlock.ts` finds each fence with `/^```query[ \t]*\n([\s\S]*?)\n```/gm` (`queryRanges()` in `app/src/editor/queryRanges.ts`, split out so it can be tested headlessly) and replaces it with a `QueryBlockWidget`. The live-preview extension skips `query` fences so they are not also drawn as code. The extension is wired into the note editor as `queryBlock(() => path)`, and the completer as `querySource()` in `app/src/editor/autocomplete.ts`.

The widget decides the form with `looksLikeBaseConfig(body)`, the regex `^(views|filters|formulas|properties|schema|source)\s*:` over the lines. A config body is parsed by `parseBase` (`core/src/bases/parse.ts`, the parser a base file's frontmatter uses) and passed to `BaseView` as `source`. A flat body is parsed by `parseQueryBlock` (`core/src/bases/queryBlock.ts`) into a `QueryBlock` and passed as `view`; `hostPath` is also passed so the block can read the host note as `this`.

```ts
interface QueryBlock {
  source?: SourceSpec   // undefined: empty state
  as: ViewType
  where?: string
  sort?: SortSpec[]
  group?: string
  limit?: number
}
```

`parseQueryBlock` also gathers a YAML block scalar (`tasks: |-`) into a multi-line value. A sort key is a single word with an optional trailing `desc` or `reverse`; a malformed key is dropped rather than kept as a sort on a field that cannot exist. For a flat block `BaseView` builds a `BaseConfig` with the block's `where` as `filters`, and `sort`, `group` and `limit` on the view. A config block with no `source` defaults to `{ kind: 'notes' }`. Rows come from `POST /rows`, with the stale-while-revalidate cache described in [bases overview](./overview.md#how-it-works). `flashcards`, and `calendar` outside tasks mode, render full-pane directly from the rows.

Source revealing uses a CodeMirror `StateField` of revealed block indices (`revealedField`), flipped by `toggleQuerySource`; `collapseOnClickOutside` closes a revealed block on an outside click, and the block is found by DOM position (`posAtDOM`) so edits above it do not break the index. Completion is two pure helpers in `app/src/editor/queryComplete.ts`: `lineInQueryBlock` (a fence state machine that works on an unclosed block) and `classifyQueryLine`.

The builder is `app/src/bases/QueryBuilder.tsx` over the pure `app/src/bases/queryGen.ts`: `buildQueryBlockBody` and `parseQueryBlockBody` convert between a `BuilderState` and the block text (equivalent, not byte-identical), `compileNotesRow` compiles a condition to an expression leaf, and `isBuilderRepresentable` is the round-trip check that gates the pencil. The Tasks source writes Tasks-style filter text with the sort on its own `sort by` line inside a `tasks: |-` block scalar, which `translateTaskDsl` reads back. `app/src/editor/openQueryBuilder.tsx` mounts the modal outside any component tree, `replaceQueryBody` in `queryBuilderEdit.ts` rewrites one block's body as a single transaction, and the slash item lives in `app/src/editor/slashMenu.ts` (id `query-builder`).

Source: `app/src/editor/queryBlock.ts`, `app/src/editor/queryRanges.ts`, `app/src/editor/queryBuilderEdit.ts`, `app/src/editor/openQueryBuilder.tsx`, `app/src/editor/slashMenu.ts`, `app/src/editor/queryComplete.ts`, `core/src/bases/queryBlock.ts`, `core/src/bases/parse.ts`, `core/src/bases/taskDsl.ts`, `app/src/bases/BaseView.tsx`, `app/src/bases/QueryBuilder.tsx`, `app/src/bases/queryGen.ts`, `cli/src/commands/base.ts`, `core/test/bases/queryBlock.test.ts`
