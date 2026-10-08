# Cards view

The cards view shows each row of a base as a card. It has three faces for a note: a book-cover grid (the default), a Keep-style masonry of live-editable note bodies, and a masonry of live-editable checklists. It suits collections you browse by look, such as books, projects, or notes you edit without opening them. The other [view kinds](../overview.md) show the same rows differently.

## Minimal working base

```yaml
---
type: base
source:
  kind: notes
  where: 'file.hasTag("book")'
view: cards
image: cover
order: [file.name, note.author, note.status, note.rating, note.pages]
groupBy:
  property: note.status
sort:
  - property: note.rating
    direction: DESC
---
```

Each card gets a cover from the `cover` property (a URL or a vault image path), the title and author from the first two columns, and a status word with gold stars beneath. Cards are grouped by status and sorted by rating within each group.

## Config keys

All keys sit at the top level of the base's frontmatter. The shared keys `filters`, `source`, `order`, `sort`, `groupBy`, `limit` and `columns` work as in the [table view](table.md#config-keys).

| Key | Type | Allowed values | Default | Effect |
|---|---|---|---|---|
| `view` | string | `cards` | none | Selects the cards renderer. |
| `cardContent` | string | `properties`, `body`, `tasks` | `properties` | What a note's card shows: its properties, its whole body, or its checklist. |
| `image` | property id | any property | none | Property holding the cover image, in properties mode. |
| `imageFit` | string | `cover`, `contain` | `cover` | CSS `object-fit` of the cover image. |
| `imageAspectRatio` | number | positive width ÷ height | `0.667` | Aspect ratio of the cover (2:3 portrait). `1` is square, `1.778` is 16:9. |
| `mode` | string | `normal`, `tasks` | `normal` | `tasks` makes every row a task and shows one task card per row. |

`cardContent` and `mode` answer different questions. `cardContent` says what appears inside a card whose row is a note. `mode: tasks` says each row is a task, so the card shows a checkbox, description and field chips. `cardContent` is ignored while `mode: tasks` is active.

## Properties mode

With `cardContent: properties`, the cards form a responsive grid in sorted and grouped order. The grid fits as many equal columns as it can at or above the minimum width, set vault-wide by the `ui.cardGridMinWidth` setting (default 220 px, range 150 to 360). A base cannot override it.

Each card has a cover and a body:

- **Cover.** The generated text cover, or the image named by `image`.
- **Body.** A status word on the left, and a star rating or page count on the right. With an image cover the title and author appear here, because the cover does not carry them.

Further columns in `order` appear as `label value` lines, skipping empty values.

### Which column plays which role

Cards detects roles by column name. The bare name is the id without its prefix, lowercased, so `note.Rating` and `formula.score` both count.

| Role | Detected as | Shown as |
|---|---|---|
| Title | The first column | Serif title |
| Author | The first column that is not the title, a status, a rating or a pages column | Muted line under the title |
| Status | Bare name `status` | Coloured dot and word, left of the meta row |
| Rating | Bare name `rating`, `stars` or `score` | Five gold stars, right of the meta row |
| Pages | Bare name `pages`, `pagecount` or `page_count` | `N pages`, right of the meta row, only when there is no rating |

The generated text cover is simpler: it takes its author from the second column, whatever that column is. If you reorder columns, the cover and the body can therefore name different authors.

### Cover images

`image` names a property, not a URL. Its value can be a full `http`, `data` or `blob` URL, or a vault path such as `covers/gatsby.jpg`. A row whose cover property is empty, or holds a list or link, falls back to the text cover. An image that fails to load is hidden.

```yaml
image: cover        # a frontmatter property named cover
imageFit: contain   # letterbox instead of cropping
imageAspectRatio: 1 # square covers
```

Writing a URL directly as `image: "https://..."` looks up a property with that name, finds nothing and shows the text cover.

### The generated cover

A card with no image gets a neutral ground typed over with a sparse field of the app's own glyphs, with the title and author on a cleared band at the foot. The pattern comes from the note's path, so each note keeps its own cover however you sort or filter.

Colour appears only when the view is grouped. Each card's glyphs take its group's hue, by the same rule a kanban column uses, and a `groupColors` entry overrides it. An ungrouped view stays neutral.

## Open, add, edit and delete cards

- **Click a card.** In a saved base, a click or Enter on an editable card opens the property editor, for a note card and a stored row alike. Right-click does the same. The editor of a note card has an **open note** button.
- **Read-only blocks.** Where a base cannot be edited, such as an embedded `query` block, a click opens the note in its own tab. A stored row with no note is inert there.
- **Add a card.** Click **New row** in the view bar (normal mode). A base that owns its rows appends a row to its body; a notes-sourced base creates an `Untitled` note in the base's folder and opens its editor. A toast warns when the base's filters would hide the new card.
- **Delete a card.** Use delete in the property editor's footer. A stored row is removed and a note goes to the trash, each with an Undo toast.

## Body and tasks modes

With `cardContent: body` or `tasks`, cards form a masonry about 240 px wide per column. Each card has the first column as a title chip above a live editor of the note. The editor is the note editor's live preview, so a click places the cursor, typing edits the note, and task boxes toggle on click.

```yaml
---
type: base
source:
  kind: notes
  where: 'file.hasTag("todo")'
view: cards
cardContent: tasks
order: [file.name]
---
```

- **`body`** edits the whole note body. The frontmatter and a leading `# Title` heading that repeats the card title stay out of the editor.
- **`tasks`** edits only the checklist, from the first task line to the last. Prose before and after it is kept verbatim. A note with no task lines edits its whole body, so the first task can be typed.
- **Resolved tasks sink.** In `tasks` mode, done and cancelled tasks move to the bottom of each block, and the note on disk is rewritten to match.
- **Links.** A click on a `[[wikilink]]` opens that note (the alias and `#heading` are dropped), and a click on a Markdown link or bare URL opens it externally. Any other click edits.

Edits autosave after the `editor.autoSaveDelay` setting. If the note changes on disk while a card is open, the card reloads the new text and keeps the caret, unless you have unsaved edits, in which case your edit wins. A card that cannot read its note shows **couldn't load this note** with a retry, and one that cannot save shows **couldn't save your last edit** with a retry.

## Tasks mode

With `mode: tasks`, each row is a task rendered by the same task row the [list and bullets views](list-bullets.md#tasks-mode-rendering-shared-by-both-views) use. A task card has a checkbox, a description and field chips, with no cover and no open-on-click. Task cards use a narrower grid (minimum 180 px) that `ui.cardGridMinWidth` does not affect.

## Group headers

With `groupBy`, each group gets a header with its label and row count above its grid. Rows with an empty group value have no header.

## Settings panel

The gear icon opens the cards settings panel. Beyond the shared sections it offers an **image** column picker (`text cover` clears it) and a **cards** section with the `cardContent` choice, plus, once an image column is set, the image fit and a cover-shape picker with presets from 2:3 to 16:9. A hand-written ratio is kept as its own option.

## Gotchas

- `image` takes a property id. A literal URL silently falls back to the text cover.
- Mixing up `mode: tasks` (one card per task) and `cardContent: tasks` (one card per note, showing its checklist) is the usual mistake.
- A body or tasks card reads its note when it mounts. If the note is deleted or unreadable, the card shows the retry message instead of an editor.
- Resolved tasks reorder themselves on disk the first time a `tasks` card opens a note whose checklist is not already in that order.

## How it works

`CardsView.tsx` branches per card: a `TaskRow` in `mode: tasks`, a `BodyCard` for `body` and `tasks` content, or a cover plus `CardBody` for properties. It branches on the declared `mode`, never on a row's shape, so a task-shaped row in an ordinary cards base keeps its cover.

`BodyCard.tsx` mounts `CardEditor.tsx`, a CodeMirror editor reusing the note editor's live preview. `cardBodySplit.ts` slices a note into `prefix`, `body` and `suffix` so that `prefix + body + suffix` is the original text. Frontmatter and the stripped surroundings are held aside and re-attached on every save, so a card edit cannot reorder or drop YAML keys. A save records the full text it wrote before the write resolves, so the file watcher's echo of that write is recognised and skipped. On a server change the card re-derives `prefix` and `suffix` from disk, then replaces the body only when there are no pending edits, tagging the transaction so autosave does not write the reload back.

`CardCover.tsx` seeds its glyph field from the note path (`coverFingerprint.ts`) and takes its colour from `groupHue.ts`, the same rule as kanban. The grid CSS lives in `CardsView.module.css`, and the `ui.cardGridMinWidth` setting reaches it as the `--card-grid-min` variable from `settingsCssVars.ts`.

Source: `app/src/bases/CardsView.tsx`, `app/src/bases/CardBody.tsx`, `app/src/bases/CardMeta.tsx`, `app/src/bases/CardCover.tsx`, `app/src/bases/BodyCard.tsx`, `app/src/bases/CardEditor.tsx`, `app/src/bases/cardBodySplit.ts`, `app/src/bases/columnKinds.ts`, `app/src/bases/groupHue.ts`, `app/src/bases/TaskRow.tsx`, `core/src/bases/types.ts`, `core/src/bases/parse.ts`
