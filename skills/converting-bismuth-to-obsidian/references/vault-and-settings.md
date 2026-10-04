# Vault layout and `.settings` → `.obsidian/`

## Sources

Bismuth (read these first; they say how it is stored now):
- `docs/vault/structure.md` — what is in a vault: hidden files, `.trash/`, the tree filter.
- `docs/settings/reference.md` — every `.settings` key, its type and default.
- `docs/overview/storage.md` — `.git/`, the backup allow-list, the legacy `settings.yaml`.
- `docs/templates/syntax.md` — `templates.folder`, `dailyNotes`, `{{...}}` tokens.
- `docs/vault/attachments.md` — `attachments.folder` semantics.

Obsidian:
- https://help.obsidian.md/configuration-folder (raw: https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Files%20and%20folders/Configuration%20folder.md) — what `.obsidian/` is (it documents the folder, not the JSON keys).
- https://help.obsidian.md/plugins/templates (raw: https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Plugins/Templates.md) — template folder, `{{date}}`/`{{time}}`/`{{title}}`.
- https://help.obsidian.md/plugins/daily-notes (raw: https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Plugins/Daily%20notes.md) — date format, new-file location, template.

## Snapshot
Snapshot as of 2026-10-03 — verify against the sources above before relying on it.

**Bismuth.** A vault is any directory. Hidden entries at the root: `.settings` (extensionless YAML, the settings "page"), `.daemon/` (the per-vault brain), `.trash/` (deleted files as `.trash/<timestamp>-<name>`), `.git/` (local backup snapshots). The tree shows only `.md`, `.draw`, `.sheet`, `.yaml`, `.yml`, images and `.pdf`; everything else stays on disk but invisible.

**Obsidian.** A vault is a folder; `.obsidian/` (the configuration folder) is optional — Obsidian creates it on first open. Its JSON files are not documented key by key on the help site, so the mapping below is *unverified* unless it says otherwise.

| `.settings` key | Obsidian target | Status |
|---|---|---|
| `attachments.folder` (`attachments`; `""` = vault root; `"."` = the note's folder) | `app.json` `attachmentFolderPath` (`"attachments"`, `"/"`, `"./"`) | key name unverified |
| `editor.livePreview`, `editor.lineNumbers`, `editor.spellcheck` | `app.json` `livePreview`, `showLineNumber`, `spellcheck` | key names unverified |
| `templates.folder` (`Templates`) | `templates.json` `folder` | key name unverified |
| `dailyNotes[0]` `{folder, fileName, template}` | `daily-notes.json` `folder`, `format`, `template` | key names unverified; Obsidian has ONE daily-note config. `fileName` is a Bismuth token string (e.g. `{{date}} journal`); `format` is a Moment string, so map the date token to its Moment form and bracket literal text (`YYYY-MM-DD [journal]`) — **unverified**, check the live Daily notes page. If the `folder` or `template` it names does not exist in the vault, report that instead of writing it |
| `editor.mathMacros` | a `preamble.sty` file in the config folder | unverified |
| `folderIcons`, `icon:` | no core equivalent (an icon plugin) | drop |
| `keybindings`, `appearance.*`, `toolbar`, `tabBar`, `templates.newNote`, `graph`, `calendar`, `googleCalendar`, `chat`, `daemon`, `srs`, `localModel`, `mcp`, `codex`, `ui`, `server`, `update`, `terminal`, `folderVisibility`, `statusBar`, `homePage`, `vault` (`backupOnSave`), `attachments.onDrop`, `attachments.naming`, the other `editor.*` keys (`lineWrapping`, `autoSaveDelay`, `lineHeight`, `grammarCheck`, `wrapSelection`, `wrapSelectionChars`) | none | drop, list in the report |
| `properties` (the vault's property-type registry: name → type/default) | Obsidian keeps property types in `.obsidian/types.json` | key layout **unverified**; drop and list every declared property in the report unless a reference `types.json` shows the format |

## Convert

1. **Read the live values** — `bismuth settings get --key attachments.folder --vault "$SRC"` (one key at a time; no `--key` prints the whole tree as JSON). Only convert keys whose value **differs from the default** in `docs/settings/reference.md`. If every value equals its default, there is nothing to convert: skip steps 2 and 3, write no `.obsidian/`, and say so in the report.
2. **Decide how to write the keys that did differ.** (Only reached when step 1 found at least one non-default key; with none, the unverified keys in the table are not written at all.) If a reference vault created by Obsidian is available (ask the user for one, or find a `.obsidian/app.json`), diff the key names against it and write only the keys you can confirm. If none is available, write only those non-default keys, marked *unverified* above, **and** list each in the report under "settings to check by hand". Obsidian recreates a missing or invalid config on open, so an omitted file costs nothing; a wrong key silently does nothing.
3. **Write JSON** — e.g. `mkdir -p "$OUT/.obsidian"` then `printf '{"attachmentFolderPath":"attachments"}\n' > "$OUT/.obsidian/app.json"`. Never copy `.settings` itself into the output.
4. **Templates**: the folder named by `templates.folder` copies with the vault. Its `{{cursor}}` and offset tokens (`{{date+1w}}`) are Bismuth-only — see `other-features`.
5. **Do not write** `.obsidian/plugins/*`, `workspace.json`, `hotkeys.json`, `community-plugins.json`. The user installs the plugins the report names; Obsidian creates the rest.
6. **Skipped on copy** (SKILL step 1): `.settings`, `.daemon/`, `.trash/`, `.git/`. Keep `.git/` only if the user asks for history — a Bismuth backup `git add -A` would then also commit `.obsidian/`.

## Lossy

- Every `.settings` section with no Obsidian counterpart (last table row).
- `attachments.folder` values Obsidian cannot express, and `attachments.onDrop` / `attachments.naming` (Obsidian's pasted-image naming is its own setting).
- `dailyNotes` entries beyond `[0]`, and every entry's `id`, `label` and `icon`: Obsidian has one daily-note config, so list each dropped entry (id, folder, fileName, template) in the report.
- `statusBar`, `homePage`, `vault.backupOnSave` and the `properties` registry (see the table): no Obsidian counterpart, reported as dropped.
- Hotkeys, themes, fonts, CSS snippets — Bismuth's `appearance.theme` (`ink`, `paper`, `cathode`, `riso`) has no Obsidian theme equivalent.
- All Bismuth state outside the notes: `.trash/` contents, git history, daemon runtime.

## Validate

- `find "$OUT" -maxdepth 1 -name '.*'` shows only `.obsidian` (and `.git` if kept) — no `.settings`, `.daemon`, `.trash`.
- Each `.obsidian/*.json` parses: `bun -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$OUT/.obsidian/app.json"`.
- The report lists every setting converted by an unverified key.

### Link check script

A `[[` with no closing `]]` on the same line (a stray bracket in a note) is not a link and is not reported. Save this as `check-links.ts` in your scratch directory and run `bun run check-links.ts "$OUT"` (expected `missing=0`; `case-only` hits are warnings — Obsidian matches names case-insensitively, but report them):

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
