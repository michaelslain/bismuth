# Converting Obsidian vault settings

Obsidian keeps settings in `.obsidian/*.json`; Bismuth keeps a sparse YAML file named `.settings` at the vault root. This page maps the Obsidian settings that have a Bismuth key (attachments, editor flags, templates, daily notes, math macros, folder icons) and lists the ones that carry over to nothing.

## Sources

- Bismuth: `docs/vault/structure.md` (what the tree shows, hidden files), `docs/settings/reference.md` (every `.settings` key), `docs/overview/storage.md` (git snapshots, `.settings`), `docs/templates/syntax.md` (`dailyNotes`, template tokens), `docs/cli/reference.md` (the `settings` and `folder-icon` commands).
- Obsidian: https://obsidian.md/help/data-storage, https://obsidian.md/help/plugins/daily-notes, https://obsidian.md/help/plugins/templates, https://obsidian.md/help/attachments
- The Obsidian docs describe the `.obsidian/` folder but not each JSON key. Read the real files in `$SRC/.obsidian/`; they are the truth for key names and values.

## Format differences

A Bismuth vault is any existing folder. `.settings` (hidden YAML at the vault root) is created on first open as a two-line comment seed with no keys. It is sparse: absent keys read as schema defaults, and the file gains only the keys that the user, or `bismuth settings set`, writes. The table orients you; where a linked live page disagrees, follow the live page and note the difference in the report.

| Obsidian file and key (as read from `.obsidian/`) | Bismuth `.settings` key |
|---|---|
| `app.json` `attachmentFolderPath` `"folder"` | `attachments.folder: folder` (default `attachments`) |
| `attachmentFolderPath` `"/"` (vault root) | `attachments.folder: ""` |
| `attachmentFolderPath` `"./"` (next to the note) | `attachments.folder: "."` |
| `attachmentFolderPath` `"./sub"` | no equivalent (lossy) |
| `app.json` live preview, line numbers, spellcheck | `editor.livePreview`, `editor.lineNumbers`, `editor.spellcheck` |
| math macros file (a LaTeX preamble; file name unverified) | `editor.mathMacros`, one string of `\newcommand`/`\def` |
| `templates.json` `folder` | `templates.folder` (default `Templates`) |
| `daily-notes.json` `folder`, `format`, `template` | `dailyNotes:` list item `{id, label, icon, folder, fileName, template}` |
| `appearance.json` theme | `appearance.theme`: `ink`, `paper`, `cathode` or `riso` (see `docs/settings/themes.md`) |
| `hotkeys.json` | `keybindings:` (a different schema, see `docs/settings/keybindings.md`) |
| plugin config, CSS snippets, community themes | nothing carries over |

Embeds resolve by file name anywhere in the vault, so `attachments.folder` decides only where new files land. Existing `![[x.png]]` embeds keep working.

## Convert

0. No `.obsidian/` in `$SRC`: nothing to map. Skip this whole page, leave `.settings` alone, and write "no `.obsidian/`, settings defaults apply" in the report.
1. Read each file that exists:
   ```bash
   cat "$SRC"/.obsidian/{app,daily-notes,templates,appearance}.json
   ```
2. Attachments: use the mapped value from the table, with `""` and `"."` quoted as empty and dot:
   ```bash
   bismuth settings set attachments.folder assets --vault "$OUT"
   ```
3. Editor flags: repeat for each flag that is set:
   ```bash
   bismuth settings set editor.lineNumbers true --vault "$OUT"
   ```
4. Templates:
   ```bash
   bismuth settings set templates.folder Templates --vault "$OUT"
   ```
5. Daily notes: map `format` to `fileName: "{{date:FORMAT}}"` (no `.md`) and `template` to a vault path with `.md`:
   ```bash
   bismuth settings set dailyNotes '[{"id":"daily","label":"Daily","icon":"calendar","folder":"Daily","fileName":"{{date:YYYY-MM-DD}}","template":"Templates/Daily.md"}]' --vault "$OUT"
   ```
6. Math macros (only if the vault has a preamble):
   ```bash
   bismuth settings set editor.mathMacros '\newcommand{\R}{\mathbb{R}}' --vault "$OUT"
   ```
7. Folder icons (only if an icon plugin is in `community-plugins.json`; read its `data.json` for the folder-to-icon map):
   ```bash
   bismuth folder-icon "Projects" Folder --vault "$OUT"
   ```
8. Do not copy `.obsidian/` into `$OUT`. A Bismuth backup stages everything with `git add -A`, so it would be committed.

## Lossy

- All plugin settings, hotkeys (no automatic mapping), CSS snippets and community themes.
- `attachmentFolderPath` of `"./sub"`, and Obsidian settings with no Bismuth key (`userIgnoreFilters`, `newFileLocation`, `useMarkdownLinks`, `alwaysUpdateLinks`: no key found in `docs/settings/reference.md`).
- A daily-note `format` with slashes (nested folders), or Moment tokens such as `Do`, `W`, `Q`, `[literal]`: it is unverified whether `fileName` supports nested folders, and the template vocabulary is in `docs/templates/syntax.md`. Flatten the name and report it.

## Validate

- `bismuth settings get --key attachments --vault "$OUT" --pretty` shows the mapped folder.
- `bismuth settings get --key dailyNotes --vault "$OUT" --pretty` shows one item per Obsidian daily-notes config, and its `template` path exists under `$OUT`.
- `ls -A "$OUT"` shows no `.obsidian`. `.settings` is created the first time the app opens the vault, so its absence is a pass and the CLI reads defaults. A `settings get` that returns the mapped value proves the mapping.
