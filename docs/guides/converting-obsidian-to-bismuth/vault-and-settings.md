# Converting Obsidian vault settings

Obsidian keeps settings in `.obsidian/*.json`; Bismuth keeps a sparse YAML file named `.settings` at the vault root. `bismuth import obsidian` reads the source's `.obsidian/` folder, writes the settings that have a Bismuth key into the new vault's `.settings`, and lists the ones that carry over to nothing. It never copies `.obsidian/` itself. The vault-wide procedure is in [the conversion guide](../converting-obsidian-to-bismuth.md).

## Sources

- Bismuth: `docs/vault/structure.md` (what the tree shows, hidden files), `docs/settings/reference.md` (every `.settings` key), `docs/overview/storage.md` (git snapshots, `.settings`), `docs/templates/syntax.md` (`dailyNotes`, template tokens), `docs/cli/reference.md` (the `settings` and `folder-icon` commands).
- Obsidian: https://obsidian.md/help/data-storage, https://obsidian.md/help/plugins/daily-notes, https://obsidian.md/help/plugins/templates, https://obsidian.md/help/attachments
- The Obsidian docs describe the `.obsidian/` folder but not each JSON key. The real files in the source's `.obsidian/` are the truth for key names and values.

## Format differences

A Bismuth vault is any existing folder. `.settings` (hidden YAML at the vault root) holds only the keys the user, or `bismuth settings set`, writes; absent keys read as schema defaults. The table orients you; where a linked live page disagrees, follow the live page and tell the user about the difference.

| Obsidian file and key (as read from `.obsidian/`) | Bismuth `.settings` key |
|---|---|
| `app.json` `attachmentFolderPath` `"folder"` | `attachments.folder: folder` (default `attachments`) |
| `attachmentFolderPath` `"/"` (vault root) | `attachments.folder: ""` |
| `attachmentFolderPath` `"./"` (next to the note) | `attachments.folder: "."` |
| `attachmentFolderPath` `"./sub"` | no equivalent (lossy) |
| `app.json` live preview, line numbers, spellcheck | `editor.livePreview`, `editor.lineNumbers`, `editor.spellcheck` |
| math macros file (a LaTeX preamble) | `editor.mathMacros`, one string of `\newcommand`/`\def`; not mapped by the command |
| `templates.json` `folder` | `templates.folder` (default `Templates`) |
| `daily-notes.json` `folder`, `format`, `template` | `dailyNotes:` list item `{id, label, icon, folder, fileName, template}` |
| `appearance.json` theme, fonts, accent colour | not mapped; Bismuth keeps its own theme (`docs/settings/themes.md`) |
| `hotkeys.json` | not mapped; `keybindings:` is a different schema (`docs/settings/keybindings.md`) |
| plugin config, CSS snippets, community themes | nothing carries over |

Embeds resolve by file name anywhere in the vault, so `attachments.folder` decides only where new files land. Existing `![[x.png]]` embeds keep working.

## What the command converts

- Attachments, the editor flags (live preview, line numbers, spellcheck) and the templates folder, from the table above.
- Daily notes: one `dailyNotes` item with id `daily`. A Moment `format` becomes `fileName: "{{date:FORMAT}}"` and a `template` becomes a vault path ending in `.md`. A format with a token Bismuth lacks falls back to `{{date}}`; a format with slashes is flattened with `-`.
- Folder icons, when `obsidian-icon-folder` is in the source's `community-plugins.json`: a Lucide icon written with the `Lu` prefix becomes its Lucide name, and an emoji passes through.
- A source with no `.obsidian/` folder gets no settings; the report says so under Defaults taken.

Each setting the command writes is one line under Converted, in the form `<key> = <value> (from .obsidian/<file>)`, and each folder icon is `folder icon <folder> = <icon> (…)`. Read the values back with `bismuth settings get`.

## What the command copies

The command copies every file in the source except the top-level `.obsidian/`, `.trash/` and `.git/` folders. Notes and bases are rewritten; every other file is copied byte for byte.

- The source's git history is not copied; the report lists that under Defaults taken (area `plugins`), and Bismuth starts its own snapshot history in the new vault.
- A symbolic link is never followed or copied. Each one is listed under Needs a decision (area `syntax`).
- A copied or written file keeps its source modified date, so a base that filters or sorts on `file.mtime` behaves as it did. Creation dates are the import time and the report lists that under Lossy.

## What the command reports

| Section | Item |
|---|---|
| Converted | one line per written setting, and one per folder icon |
| Lossy | file creation dates (they are the import time), `attachmentFolderPath "./sub"`, `userIgnoreFilters`, `newFileLocation`, `useMarkdownLinks`, `alwaysUpdateLinks`, `appearance.json`, CSS snippets, `hotkeys.json`, a daily-note format whose tokens Bismuth lacks or that has slashes, and a folder icon Bismuth cannot show |
| Defaults taken | `no .obsidian folder: settings defaults apply`, and the source's `.git` history not copied |
| Needs a decision | each symbolic link, as `symbolic link not copied; copy what it points to into the vault by hand: "<path>"` |

Only symbolic links land under Needs a decision.

## Resolve a Needs a decision item

- **A symbolic link**: copy what it points to into the new vault by hand, or tell the user the target was not copied. The command never reads outside the source, so the target is not in the new vault.

## Resolve a Lossy item by hand

- **Math macros**: when the vault has a preamble, set it as one string:
  ```bash
  bismuth settings set editor.mathMacros '\newcommand{\R}{\mathbb{R}}' --vault "$OUT"
  ```
- **A daily-note format that fell back to `{{date}}` or was flattened**: the template vocabulary is in `docs/templates/syntax.md`. Choose a `fileName` from it with the user and set `dailyNotes`.
- **A folder icon the command could not map**: set one with `bismuth folder-icon "Projects" Folder --vault "$OUT"`.
- **Hotkeys, CSS snippets, themes**: tell the user; none carries over.
- **File creation dates**: tell the user; Bismuth has no way to set them.

## Validate

- `bismuth settings get --key attachments --vault "$OUT" --pretty` shows the mapped folder.
- `bismuth settings get --key dailyNotes --vault "$OUT" --pretty` shows one item per Obsidian daily-notes config, and its `template` path exists under `$OUT`.
- `ls -A "$OUT"` shows no `.obsidian`. `.settings` is created the first time the app opens the vault when the source mapped no settings, so its absence is then a pass and the CLI reads defaults.
