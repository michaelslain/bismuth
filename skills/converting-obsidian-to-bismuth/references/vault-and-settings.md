# Vault layout and settings

## Sources

- Bismuth: `docs/vault/structure.md` (what the tree shows, hidden files), `docs/settings/reference.md` (every `.settings` key), `docs/overview/storage.md` (git snapshots, `.settings`), `docs/templates/syntax.md` (`dailyNotes`, template tokens), `docs/cli/reference.md` (the `settings` and `folder-icon` commands).
- Obsidian: https://obsidian.md/help/data-storage, https://obsidian.md/help/plugins/daily-notes, https://obsidian.md/help/plugins/templates, https://obsidian.md/help/attachments
- The Obsidian docs describe the `.obsidian/` folder but not each JSON key. Read the real files in `$SRC/.obsidian/`; they are the truth for key names and values.

## Snapshot

Snapshot as of 2026-10-03 — verify against the sources above before relying on it.

A Bismuth vault is any existing folder. `.settings` (hidden YAML at the vault root) is created on first open and only ever gains missing keys.

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
| `hotkeys.json` | `keybindings:` (different schema, see `docs/settings/keybindings.md`) |
| plugin config, CSS snippets, community themes | nothing carries over |

Embeds resolve by file name anywhere in the vault, so `attachments.folder` only decides where NEW files land; existing `![[x.png]]` keep working.

## Convert

0. No `.obsidian/` in `$SRC`: nothing to map. Skip this whole reference, leave `.settings` alone, and write "no `.obsidian/`, settings defaults apply" in the report.
1. Read each file that exists: `cat "$SRC"/.obsidian/{app,daily-notes,templates,appearance}.json`.
2. Attachments: `bismuth settings set attachments.folder assets --vault "$OUT"` (use the mapped value from the table; `""` and `"."` are quoted empty/dot).
3. Editor flags: `bismuth settings set editor.lineNumbers true --vault "$OUT"` (repeat for each flag that is set).
4. Templates: `bismuth settings set templates.folder Templates --vault "$OUT"`.
5. Daily notes: map `format` to `fileName: "{{date:FORMAT}}"` (no `.md`) and `template` to a vault path with `.md`:
   ```bash
   bismuth settings set dailyNotes '[{"id":"daily","label":"Daily","icon":"calendar","folder":"Daily","fileName":"{{date:YYYY-MM-DD}}","template":"Templates/Daily.md"}]' --vault "$OUT"
   ```
6. Math macros (only if the vault has a preamble): `bismuth settings set editor.mathMacros '\newcommand{\R}{\mathbb{R}}' --vault "$OUT"`.
7. Folder icons (only if an icon plugin is in `community-plugins.json`; read its `data.json` for the folder-to-icon map): `bismuth folder-icon "Projects" Folder --vault "$OUT"`.
8. Do not copy `.obsidian/` into `$OUT`. A Bismuth backup stages everything with `git add -A`, so it would be committed.

## Lossy

- All plugin settings, hotkeys (no automatic mapping), CSS snippets and community themes.
- `attachmentFolderPath` of `"./sub"`, and Obsidian settings with no Bismuth key (`userIgnoreFilters`, `newFileLocation`, `useMarkdownLinks`, `alwaysUpdateLinks`: no key found in `docs/settings/reference.md`).
- A daily-note `format` with slashes (nested folders), or Moment tokens such as `Do`, `W`, `Q`, `[literal]`: unverified whether `fileName` supports nested folders; the template vocabulary is in `docs/templates/syntax.md`. Flatten the name and report it.

## Validate

- `bismuth settings get --key attachments --vault "$OUT" --pretty` shows the mapped folder.
- `bismuth settings get --key dailyNotes --vault "$OUT" --pretty` shows one item per Obsidian daily-notes config, and its `template` path exists under `$OUT`.
- `ls -A "$OUT"` shows no `.obsidian`. `.settings` is created the first time the app opens the vault, so its absence is a pass (the CLI reads defaults). `bismuth settings set` writes one; a `settings get` that returns the mapped value proves the mapping.
