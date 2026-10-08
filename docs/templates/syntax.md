# Template tokens and daily notes

A template is a markdown file whose `{{...}}` tokens expand to the date, the time, the note's title and a caret position when you insert it or create a note from it. Daily notes use the same tokens for both their file name and their starting content.

```markdown
# {{title}}
Created {{date:dddd, MMMM D}} at {{time:h:mm A}}
Review on {{date+1w}}

{{cursor}}
```

Inserted into a note titled `Weekly plan` on Sunday 31 May 2026 at 14:09, this becomes:

```markdown
# Weekly plan
Created Sunday, May 31 at 2:09 PM
Review on 2026-06-07

```

The caret lands where `{{cursor}}` was.

## Which tokens exist?

Four tokens expand. Anything else between `{{` and `}}` stays as typed.

| Token | Expands to | Default format | Offset | Format |
|---|---|---|---|---|
| `{{date}}` | the current date | `YYYY-MM-DD` | `d` `w` `m` `y` | yes |
| `{{time}}` | the current time | `HH:mm` | `h` `m` | yes |
| `{{title}}` | the note's title (its file name without `.md`) | none | no | no |
| `{{cursor}}` | nothing; marks where the caret lands | none | no | no |

The editor offers these four as you type `{{`; see [Autocomplete](../editor/autocomplete.md#complete-template-tokens).

## How do I shift a date or time?

Put a sign, a whole number and a one-letter unit right after the name: `{{date+7d}}`, `{{time-30m}}`. Only `date` and `time` accept an offset.

| Name | Unit | Meaning |
|---|---|---|
| `date` | `d` | days |
| `date` | `w` | weeks |
| `date` | `m` | months |
| `date` | `y` | years |
| `time` | `h` | hours |
| `time` | `m` | minutes |

`m` means months in `{{date}}` and minutes in `{{time}}`. A unit that does not belong to the name (`{{date+1h}}`, `{{time+1d}}`) leaves the whole token unexpanded.

With the clock at Sunday 2026-05-31 14:09:05:

```text
{{date+7d}}   -> 2026-06-07
{{date-1w}}   -> 2026-05-24
{{date+1y}}   -> 2027-05-31
{{time+2h}}   -> 16:09
{{time-30m}}  -> 13:39
```

Adding months moves by calendar month and rolls over when the target day does not exist: `{{date+1m}}` on May 31 gives `2026-07-01`, because June has no 31st. The same applies to any `+Nm` or `+Ny` from a day missing in the target month.

## How do I change the format?

Add `:` and a format string after the name and any offset: `{{date+1w:YYYY-MM-DD}}`. The format must not be empty, so `{{date:}}` stays unexpanded.

Letters in the format are replaced when they match a token below; every other character (separators, spaces, commas) is copied as typed. At each position the longest matching token wins.

| Token | Meaning | Example |
|---|---|---|
| `YYYY` | four-digit year | `2026` |
| `YY` | last two digits of the year | `26` |
| `MMMM` | full month name | `May` |
| `MMM` | short month name | `May` |
| `MM` | month, two digits | `05` |
| `M` | month, no padding | `5` |
| `DD` | day of month, two digits | `31` |
| `D` | day of month, no padding | `31` |
| `dddd` | full weekday name | `Sunday` |
| `ddd` | short weekday name | `Sun` |
| `HH` | 24-hour, two digits | `14` |
| `H` | 24-hour, no padding | `14` |
| `hh` | 12-hour, two digits | `02` |
| `h` | 12-hour, no padding | `2` |
| `mm` | minutes, two digits | `09` |
| `m` | minutes, no padding | `9` |
| `ss` | seconds, two digits | `05` |
| `s` | seconds, no padding | `5` |
| `A` | `AM` or `PM` | `PM` |
| `a` | `am` or `pm` | `pm` |

```text
{{date:YYYY/MM/DD}}    -> 2026/05/31
{{date:dddd, MMMM D}}  -> Sunday, May 31
{{date:MMMM}}          -> May
{{time:h:mm A}}        -> 2:09 PM
{{time:HH:mm:ss}}      -> 14:09:05
```

Month and weekday names are always English. There is no escape syntax: every letter that is a format token is interpreted, so you cannot print a literal `M`, `D`, `H`, `h`, `m`, `s`, `A` or `a` inside a format. A lone `Y`, `d`, `T` or `Z` passes through unchanged, but `YY`, `ddd` and longer runs are tokens. Put other characters around the date parts instead.

## What happens to a token that does not parse?

A token that is not recognised is kept exactly as typed, so a mistake is visible in the result rather than silently dropped.

```text
{{foo}}               -> {{foo}}              unknown name
{{date:}}             -> {{date:}}            empty format
{{date foo}}          -> {{date foo}}         text the grammar does not allow
{{DATE}}              -> {{DATE}}             names are lowercase
{{ date }}            -> {{ date }}           no spaces inside the braces
{{date+1d+1d}}        -> {{date+1d+1d}}       one offset only
{{foo}} and {{date}}  -> {{foo}} and 2026-05-31
```

The name must be the first thing inside the braces, and the whole inside must fit the grammar `name`, optional `+N<unit>` or `-N<unit>`, optional `:format`. Offset comes before format.

`{{title}}` and `{{cursor}}` ignore an offset or format instead of rejecting it: `{{title+1d}}` and `{{title:YYYY}}` both expand to the plain title, and `{{cursor:YYYY}}` still marks the caret. Leave modifiers off these two tokens.

## Where does the caret land?

`{{cursor}}` expands to nothing and sets the caret position. The first `{{cursor}}` wins and later ones are removed. A template with no `{{cursor}}` puts the caret at the end.

```text
a{{cursor}}b             -> ab, caret after "a"
{{cursor}}x{{cursor}}y   -> xy, caret at the start
hello                    -> hello, caret at the end
```

## How do I insert a template?

Press `Alt+T` (Option+T on macOS), pick a template from the list, and Bismuth inserts it at the caret of the editor you last focused. Rebind it with the `insert-template` keybinding in `.settings`; see [Keybindings](../settings/keybindings.md).

The list holds every `.md` file under the vault folder named by `templates.folder` (default `Templates`), searched recursively and sorted by path. Dotfiles are skipped, and a missing folder gives an empty list. Inside the template, `{{title}}` is the focused note's title. With no note open, the picker shows "Open a note to insert a template" and inserts nothing.

## How do I start new notes from a template?

Set `templates.newNote` to the vault path of a template file. A new note created with the New Note command or the file tree's New File action is filled from it. The note is created as `Untitled`, and the template is expanded after you finish naming it, so `{{title}}` is the name you typed and the caret goes to `{{cursor}}`.

```yaml
templates:
  folder: Templates
  newNote: Templates/Note.md
```

An empty value (the default), a path that does not exist, or an empty template leaves the new note empty with no error.

## How do daily notes work?

Each entry in the `dailyNotes` list in `.settings` registers a `daily-note:<id>` command for the toolbar and palette. Running it opens today's note for that entry and creates the note from its template the first time. See [Toolbar commands](../settings/toolbar-commands.md) for placing the command on the toolbar.

A fresh vault has this entry:

```yaml
dailyNotes:
  - id: journal
    label: Journal
    icon: BookOpen
    folder: Journal
    fileName: "{{date}} journal"
    template: Templates/Journal.md
```

| Field | Type | Required | Default | Effect |
|---|---|---|---|---|
| `id` | string | yes | none | Stable id; forms the command id `daily-note:<id>` |
| `fileName` | string | yes | none | File name without `.md`, written with `{{...}}` tokens |
| `label` | string | no | the `id` | Palette label and button tooltip |
| `icon` | Lucide icon name or emoji | no | `CalendarDays` | Toolbar icon |
| `folder` | vault folder | no | `""` (vault root) | Where the notes go; a trailing slash is ignored |
| `template` | vault path | no | `""` | Template file used to fill a new note |

An entry missing `id` or `fileName` is dropped. If `dailyNotes` is absent or not a list, the seeded `journal` entry applies; an explicit empty list means no daily notes.

### How is the file name built?

Bismuth expands `fileName` with the current time, trims the result, appends `.md` and joins it to `folder`.

```text
folder: Journal     fileName: "{{date}} journal"  -> Journal/2026-05-31 journal.md
folder: ""          fileName: "{{date}} journal"  -> 2026-05-31 journal.md
folder: Journal/    fileName: "{{date}} journal"  -> Journal/2026-05-31 journal.md
```

`{{title}}` is empty inside `fileName`, so use only date and time tokens there. The date comes from the local clock of the machine running the core server.

### What goes into the note body?

If `template` names an existing file, its content is expanded with `{{title}}` set to the generated file name (without `.md`). In a template used by the entry above, `# {{title}}` becomes `# 2026-05-31 journal`. If `template` is empty or the file does not exist, the new note is empty. If today's note already exists, it is opened as is and never overwritten.

## What goes wrong silently?

| Situation | Result |
|---|---|
| Token name misspelled or wrong case | The token stays in the note as typed |
| Offset unit from the wrong family (`{{date+1h}}`) | Token stays as typed |
| Offset or format on `{{title}}` or `{{cursor}}` | Ignored; the token still expands |
| `{{date+1m}}` on the 29th to 31st | Rolls into the following month |
| `{{title}}` in a daily note's `fileName` | Expands to nothing |
| Daily-note `template` path does not exist | New note is empty; no error |
| `id` passed to the daily-note route is unknown | The request fails with HTTP 400 |

## How it works

`expandTemplate(raw, { now, title })` in `core/src/templates.ts` scans the text with one regular expression for `{{...}}` and parses each match with `parseToken`, which accepts `^(date|time|title|cursor)`, an optional `^([+-])(\d+)([a-z])` offset and an optional `:format`. An unparsed match is appended unchanged. `date` and `time` clone `now`, apply the offset through `applyOffset` (which returns null for an invalid unit), then format with `formatDate`, a left-to-right scan that takes the longest matching token. The function returns the text and `cursorOffset`, which is the position of the first `{{cursor}}` or the text length.

`TEMPLATE_TOKENS` in the same file is the catalog the editor and the settings editor autocomplete from; a test asserts every catalog token parses.

`dailyNotePath` and `dailyNoteContent` in `core/src/dailyNote.ts` are pure. `POST /daily-note` in `core/src/routes/vault.ts` reads the entry by `id` (HTTP 400 if unknown), returns `{ path, created: false }` when the file exists, and otherwise reads the template when it exists, writes the expanded body and returns `{ path, created: true }`. `readDailyNotesFrom` in `core/src/settingsSerialize.ts` normalises the list. `GET /templates` lists template files through `listTemplates` in `core/src/files.ts`, and `app/src/palette/TemplatePalette.tsx` does the insertion. `applyNewNoteTemplate` in `core/src/newNoteTemplate.ts` waits for the new note's rename to settle, then expands and writes the template on the final path.

Source: `core/src/templates.ts`, `core/src/dailyNote.ts`, `core/src/newNoteTemplate.ts`, `core/src/files.ts`, `core/src/routes/vault.ts`, `core/src/settingsSerialize.ts`, `core/src/schema/settingsSchema.ts`, `app/src/palette/TemplatePalette.tsx`
