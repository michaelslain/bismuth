# Make your first base

A base is a note whose frontmatter describes a live view of other notes: a table, board, calendar or chart that updates as the notes change. This guide builds a reading list from book notes: you create the base, point it at the right notes, filter, sort and group the rows, check them, then switch the view to cards. It takes about ten minutes and needs a vault with a few notes that carry frontmatter properties.

## What the sample notes look like

The guide assumes five notes tagged `book` (and one tagged `play`), each with properties like this one:

```markdown
---
tags: [book]
author: Frank Herbert
status: finished
rating: 5
pages: 612
---
```

`status` is `finished`, `reading` or `to-read`. `Emma` has no `rating`. For the properties a note can carry, see [frontmatter](../vault/frontmatter.md).

## 1. Create the base

In the app, press the **Create new…** button in the sidebar toolbar, choose **New base**, then **Table**. Bismuth creates `Untitled Table.md` and lets you rename it; call it `Books`.

From a shell, the same file with its source already set:

```bash
bismuth base create Books --view table --source 'notes where file.hasTag("book")'
```

The file reads:

```markdown
---
type: base
view: table
source: notes where file.hasTag("book")
---
```

`type: base` makes the note open as a base instead of text. `view` picks the renderer. `source` says where the rows come from; a base made in the app starts with `source: notes`, which is every note in the vault.

## 2. Point it at the right notes

Click **Source** in the view bar to edit the file as text, set `source` to the books only, and press **save**:

```yaml
source: notes where file.hasTag("book")
```

`file.hasTag("book")` matches the exact tag `book` (not `book/fiction`), without a `#`. The play drops out of the table. Every later edit in this guide works the same way: **Source**, edit, **save**.

You can make the same edit in **Settings** in the view bar, under the **source** section. Both write the same frontmatter.

## 3. Add a filter

A filter keeps only the rows where an expression is true. Hide the books you have not started:

```yaml
filters: 'status != "to-read"'
```

Quote the whole expression: an unquoted `#` after a space would start a YAML comment and silently cut the filter short. Several conditions combine with `&&` and `||` inside one string, or with an `and:` / `or:` / `not:` tree; see [filters](./filters.md).

## 4. Choose columns, sort and group

Add these keys beside the others:

```yaml
order: [file.name, note.author, note.status, note.rating]
sort:
  - { property: note.rating, direction: DESC }
  - { property: file.name, direction: ASC }
groupBy: status
```

`order` lists the columns, `sort` applies its keys in order, and `groupBy` splits the rows into one group per `status` value. Property ids start with `file.` (name, path, tags), `note.` (frontmatter) or `formula.` (computed); a bare name such as `status` means `note.status`.

## 5. See the rows

The full file:

```markdown
---
type: base
source: notes where file.hasTag("book")
filters: 'status != "to-read"'
view: table
order: [file.name, note.author, note.status, note.rating]
sort:
  - { property: note.rating, direction: DESC }
  - { property: file.name, direction: ASC }
groupBy: status
---
```

Open `Books` in the app to see a table with a `finished` group and a `reading` group. To print the same rows from a shell:

```bash
bismuth base render Books.md | jq -r '.groups[] | .key, (.rows[] | "  " + .file.name + "  " + (.note.rating|tostring))'
```

```text
finished
  Beloved  5
  Dune  5
  Middlemarch  4
reading
  Piranesi  4
```

`Emma` is absent because of the filter. Rows are sorted by rating, highest first, then by name.

## 6. Change the view

Change `view` to another kind and the same rows render differently:

```yaml
view: cards
cardContent: properties
```

Each kind reads its own extra keys, so delete the keys the old kind owned (a table's `columnWidths`, for example) when you switch. The kinds and their pages are listed in [bases overview](./overview.md#what-view-kinds-are-there).

To keep the table and add a card view, make a second base that reads the first one's rows. Create `Book cards.md`:

```markdown
---
type: base
source: base
ref: "[[Books]]"
filters: 'status != "to-read"'
view: cards
cardContent: properties
---
```

A base that references another receives its rows only. Its `filters`, `sort` and `groupBy` do not carry over, so `Book cards` repeats the filter. A base holds exactly one view.

## 7. Verify the base

```bash
bismuth base validate Books.md
```

```json
{"ok":true,"errors":[]}
```

The command exits 0 when the base is sound and 1 otherwise. It catches an invalid `view` kind, a `source` that points at a missing base, and filters or formulas that fail to parse. A mistyped view key (`sorrt:`) or an invalid value such as `aggregate: median` is not an error: the key is ignored and the default applies. Run `bismuth base render` and check that the rows are the ones you meant.

## Failure modes

- If every note in the vault appears, then `source` is missing or misspelled. An unrecognised `source` falls back to all notes without an error.
- If no rows appear, then a filter failed to parse and counts as false for every row. Run `bismuth base validate`.
- If the base renders as a table when you asked for another kind, then `view` is misspelled; the app falls back to `table`. Validate names the bad value.
- If a base opens as plain text, then `type: base` is missing or not in the frontmatter block at the top of the file.

Next, read [sources](./sources.md) to compose bases and scope tasks, and [bases overview](./overview.md) for every top-level key.
