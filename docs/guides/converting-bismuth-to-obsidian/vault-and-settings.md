# Converting Bismuth settings and vault layout to Obsidian

Bismuth keeps vault settings in a sparse YAML file named `.settings`; Obsidian keeps them in `.obsidian/*.json`. This page maps the few settings that have an Obsidian counterpart (attachments, editor flags, templates, daily notes), lists everything that is dropped, and ends with the link-check script the whole conversion uses.

## Sources

Bismuth:
- `docs/vault/structure.md`: what is in a vault, hidden files, `.trash/`, the tree filter.
- `docs/settings/reference.md`: every `.settings` key, its type and default.
- `docs/overview/storage.md`: `.git/`, the backup allow-list.
- `docs/templates/syntax.md`: `templates.folder`, `dailyNotes`, `{{...}}` tokens.
- `docs/vault/attachments.md`: `attachments.folder` semantics.

Obsidian:
- https://help.obsidian.md/configuration-folder (raw: https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Files%20and%20folders/Configuration%20folder.md): what `.obsidian/` is. It documents the folder, not the JSON keys.
- https://help.obsidian.md/plugins/templates (raw: https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Plugins/Templates.md): template folder, `{{date}}`, `{{time}}`, `{{title}}`.
- https://help.obsidian.md/plugins/daily-notes (raw: https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Plugins/Daily%20notes.md): date format, new-file location, template.

## Format differences

A Bismuth vault is any directory. Hidden entries at the root are `.settings` (extensionless YAML), `.daemon/` (the per-vault brain), `.trash/` (deleted files as `.trash/<timestamp>-<name>`) and `.git/` (local backup snapshots). The tree shows only `.md`, `.draw`, `.sheet`, `.yaml`, `.yml`, images and `.pdf`; everything else stays on disk but invisible.

An Obsidian vault is a folder, and `.obsidian/` (the configuration folder) is optional: Obsidian creates it on first open. Its JSON files are not documented key by key on the help site, so every mapping below is unverified unless it says otherwise. The table orients you; where a live page disagrees, follow the live page and note the difference in the report.

| `.settings` key | Obsidian target | Status |
|---|---|---|
| `attachments.folder` (`attachments`; `""` = vault root; `"."` = the note's folder) | `app.json` `attachmentFolderPath` (`"attachments"`, `"/"`, `"./"`) | key name unverified |
| `editor.livePreview`, `editor.lineNumbers`, `editor.spellcheck` | `app.json` `livePreview`, `showLineNumber`, `spellcheck` | key names unverified |
| `templates.folder` (`Templates`) | `templates.json` `folder` | key name unverified |
| `dailyNotes[0]` `{folder, fileName, template}` | `daily-notes.json` `folder`, `format`, `template` | key names unverified; see below |
| `editor.mathMacros` | a `preamble.sty` file in the config folder | unverified |
| `folderIcons`, `icon:` | no core equivalent (an icon plugin) | drop |
| every other section or key (listed below) | none | drop, list in the report |
| `properties` (the vault's property-type registry: name to type and default) | `.obsidian/types.json` | key layout unverified; drop and list every declared property in the report unless a reference `types.json` shows the format |

Obsidian has one daily-note config. `fileName` is a Bismuth token string (for example `{{date}} journal`) and `format` is a Moment string, so map the date token to its Moment form and bracket literal text (`YYYY-MM-DD [journal]`). That mapping is unverified, so check the live Daily notes page. If the `folder` or `template` it names does not exist in the vault, report that instead of writing it.

The keys with no Obsidian counterpart are `keybindings`, `appearance.*`, `toolbar`, `tabBar`, `layout`, `templates.newNote`, `graph`, `calendar`, `googleCalendar`, `chat`, `daemon`, `srs`, `localModel`, `mcp`, `codex`, `ui`, `server`, `update`, `terminal`, `folderVisibility`, `statusBar`, `homePage`, `vault` (`backupOnSave`), `attachments.onDrop`, `attachments.naming`, and the other `editor.*` keys (`lineWrapping`, `autoSaveDelay`, `lineHeight`, `grammarCheck`, `wrapSelection`, `wrapSelectionChars`).

## Convert

1. Read the live values with `bismuth settings get --key attachments.folder --vault "$SRC"` (one key at a time; with no `--key` it prints the whole tree as JSON). Convert only keys whose value differs from the default in `docs/settings/reference.md`. If every value equals its default, there is nothing to convert: skip steps 2 and 3, write no `.obsidian/`, and say so in the report.
2. Decide how to write the keys that did differ. This step is reached only when step 1 found at least one non-default key.
   - If a reference vault created by Obsidian is available (ask the user for one, or find a `.obsidian/app.json`), diff the key names against it and write only the keys you can confirm.
   - If none is available, write only the non-default keys marked unverified above, and list each in the report under "settings to check by hand". Obsidian recreates a missing or invalid config on open, so an omitted file costs nothing, while a wrong key silently does nothing.
3. Write JSON, for example:
   ```bash
   mkdir -p "$OUT/.obsidian"
   printf '{"attachmentFolderPath":"attachments"}\n' > "$OUT/.obsidian/app.json"
   ```
   Never copy `.settings` itself into the output.
4. Templates: the folder named by `templates.folder` copies with the vault. Its `{{cursor}}` and offset tokens (`{{date+1w}}`) are Bismuth-only; see `other-features`.
5. Do not write `.obsidian/plugins/*`, `workspace.json`, `hotkeys.json` or `community-plugins.json`. The user installs the plugins the report names, and Obsidian creates the rest.
6. The copy skips `.settings`, `.daemon/`, `.trash/` and `.git/` (the conversion guide's step 1). Keep `.git/` only if the user asks for history: a Bismuth backup runs `git add -A`, so it would also commit `.obsidian/`.

## Lossy

- Every `.settings` section with no Obsidian counterpart.
- `attachments.folder` values Obsidian cannot express, and `attachments.onDrop` and `attachments.naming` (Obsidian's pasted-image naming is its own setting).
- `dailyNotes` entries beyond `[0]`, and every entry's `id`, `label` and `icon`. Obsidian has one daily-note config, so list each dropped entry (id, folder, fileName, template) in the report.
- `statusBar`, `homePage`, `vault.backupOnSave` and the `properties` registry: reported as dropped.
- Hotkeys, themes, fonts and CSS snippets: Bismuth's `appearance.theme` (`ink`, `paper`, `cathode`, `riso`) has no Obsidian theme equivalent.
- All Bismuth state outside the notes: `.trash/` contents, git history, daemon runtime.

## Validate

- `find "$OUT" -maxdepth 1 -name '.*'` shows only `.obsidian` (and `.git` if kept), with no `.settings`, `.daemon` or `.trash`.
- Each `.obsidian/*.json` parses:
  ```bash
  bun -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$OUT/.obsidian/app.json"
  ```
- The report lists every setting converted by an unverified key.

### Link check script

A `[[` with no closing `]]` on the same line (a stray bracket in a note) is not a link and is not reported. Save this as `check-links.ts` in your scratch directory and run `bun run check-links.ts "$OUT"`. Expected output ends with `missing=0`; `case-only` hits are warnings, because Obsidian matches names case-insensitively, but report them.

```ts
// check-links.ts
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, basename } from 'node:path'

const root = process.argv[2]
const files: string[] = []
const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
        if (entry.startsWith('.')) continue
        const path = join(dir, entry)
        if (statSync(path).isDirectory()) walk(path)
        else files.push(relative(root, path))
    }
}
walk(root)

const exact = new Set<string>()
const lower = new Set<string>()
for (const f of files)
    for (const name of [f, f.replace(/\.md$/, ''), basename(f), basename(f).replace(/\.md$/, '')]) {
        exact.add(name)
        lower.add(name.toLowerCase())
    }

let missing = 0
let caseOnly = 0
for (const f of files.filter(f => f.endsWith('.md'))) {
    const text = readFileSync(join(root, f), 'utf8')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`[^`\n]*`/g, '')
    for (const m of text.matchAll(/!?\[\[([^\]\n]+)\]\]/g)) {
        const target = m[1].split('|')[0].replace(/\\$/, '').split('#')[0].trim()
        if (!target || exact.has(target)) continue
        if (lower.has(target.toLowerCase())) {
            caseOnly++
            console.log('case-only', f, '->', target)
        } else {
            missing++
            console.log('MISSING', f, '->', target)
        }
    }
}
console.log(`missing=${missing} case-only=${caseOnly}`)
process.exit(missing ? 1 : 0)
```
