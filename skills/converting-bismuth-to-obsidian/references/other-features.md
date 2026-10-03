# Sheets, graph blocks, icons, visibility, template tokens, daemon memory

## Sources

Bismuth:
- `docs/sheets/overview.md` — the `.sheet` file (Univer workbook JSON) and what export reads.
- `docs/export/overview.md` — which formats each file kind exports to.
- `docs/editor/graph-block.md` — the ` ```graph ` fence.
- `docs/vault/structure.md` — `icon:` frontmatter and `folderIcons`.
- `docs/vault/visibility.md` — `visibility:` (`hidden`, `chat-only`, `all`), `folderVisibility`, memory notes' own `visibility`.
- `docs/templates/syntax.md` — `{{date}}`, `{{time}}`, `{{title}}`, `{{cursor}}`, offsets and formats.
- `docs/daemon/memory.md` and `docs/daemon/storage.md` — the `.daemon/memory` store and everything else under `.daemon/`.

Obsidian:
- https://help.obsidian.md/plugins/templates (raw: https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Plugins/Templates.md) — core template variables (`{{title}}`, `{{date}}`, `{{time}}`, format strings).
- https://help.obsidian.md/properties (raw: https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Editing%20and%20formatting/Properties.md) — a `visibility:` or `icon:` key is just another property.

## Snapshot
Snapshot as of 2026-10-03 — verify against the sources above before relying on it.

| Bismuth | Obsidian |
|---|---|
| `.sheet` — Univer `IWorkbookData` JSON: `sheets{id: {name, cellData{row: {col: {v}}}}}`, `sheetOrder` | no spreadsheet type |
| ` ```graph ` fence (`a: Alice`, `a -> b: label`, `b -- c`) | an ordinary code block |
| `icon:` frontmatter, `folderIcons` setting | `icon:` is an inert property; icons need a plugin |
| `visibility: hidden / chat-only / all`, `folderVisibility` | nothing — Bismuth-only AI-access rules |
| `{{date}}` `{{time}}` `{{title}}` with `:FORMAT` | same three variables; the format uses Moment tokens |
| `{{cursor}}`, `{{date+1w}}` offsets | no counterpart in the core Templates plugin |
| `.daemon/memory/*.md` (type, tags, created, updated, `[[links]]`) | no counterpart |

`bismuth export` gives a sheet `html`/`pdf`/`png` only (HTML reads just the first sheet's raw values), so a sheet needs your own conversion.

## Convert

1. **Sheets → a markdown table per sheet.** Cell values only (`v`); formulas collapse to their last value. Save as `sheets.ts`, run `bun run sheets.ts "$OUT"`; it writes `<name>.md` beside each `.sheet` (keeping the `.sheet`), refuses to overwrite an existing note, and prints `sheets=<n>`:
   ```ts
   // sheets.ts
   import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs'
   import { join } from 'node:path'

   let count = 0
   const cell = (v: unknown) => String(v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')
   const walk = (dir: string) => {
       for (const entry of readdirSync(dir)) {
           if (entry.startsWith('.')) continue
           const path = join(dir, entry)
           if (statSync(path).isDirectory()) { walk(path); continue }
           if (!entry.endsWith('.sheet')) continue
           const out = path.replace(/\.sheet$/, '.md')
           if (existsSync(out)) { console.log('EXISTS, skipped', out); continue }
           const raw = readFileSync(path, 'utf8').trim()
           const book = raw ? JSON.parse(raw) : {}
           const ids: string[] = book.sheetOrder ?? Object.keys(book.sheets ?? {})
           let md = ''
           for (const id of ids) {
               const sheet = book.sheets?.[id]
               if (!sheet) continue
               const rows = Object.keys(sheet.cellData ?? {}).map(Number).sort((a, b) => a - b)
               const width = Math.max(0, ...rows.flatMap(r => Object.keys(sheet.cellData[r]).map(c => +c + 1)))
               if (!rows.length || !width) continue
               const grid = Array.from({ length: Math.max(...rows) + 1 }, (_, r) =>
                   Array.from({ length: width }, (_, c) => cell(sheet.cellData[r]?.[c]?.v)))
               md += `## ${sheet.name ?? id}\n\n| ${grid[0].join(' | ')} |\n| ${grid[0].map(() => '---').join(' | ')} |\n`
               for (const row of grid.slice(1)) md += `| ${row.join(' | ')} |\n`
               md += '\n'
           }
           writeFileSync(out, md || '(empty sheet)\n')
           count++
       }
   }
   walk(process.argv[2])
   console.log(`sheets=${count}`)
   ```
   The first sheet row becomes the table header. Report that formatting, formulas, merged cells and charts are gone.
2. **` ```graph ` fences — keep** as ordinary code blocks (Obsidian shows the text) and report each file; do not invent a diagram. Mermaid is an option only if the user asks.
3. **`icon:` frontmatter** — leave it (an unused property). Drop `folderIcons` (see `vault-and-settings`). Mention an icon plugin in the report if the user cares.
4. **`visibility:` keys — keep them, and ask before copying restricted notes.** To Obsidian `visibility:` is an inert property, so by default **leave the key in place** (stripping it would erase the only marker of what was restricted). **First** record the keys for the report (counts of `hidden`, `chat-only`, `all`, with paths: `grep -rE '^visibility:' --include='*.md' "$SRC"` plus the `folderVisibility` rules from `bismuth settings get --key folderVisibility --vault "$SRC"`).

   Then **ask the user** whether `hidden` and `chat-only` notes (and every note under a `folderVisibility` folder) should be copied at all: they are ordinary notes to Obsidian, and the vault may be handed to someone else. To leave them out, build an exclude list **before the step 1 copy** and add `--exclude-from="$LIST"` to that rsync (paths are relative to the vault root with a leading `/`, which is what rsync anchors on):
   ```bash
   LIST="${SRC%/}.exclude-list"
   find "$SRC" -name '*.md' -print0 | while IFS= read -r -d '' f; do
     awk 'NR==1&&/^---[ \t\r]*$/{fm=1;next} fm&&/^---[ \t\r]*$/{exit} fm&&/^visibility:[ \t]*["'"'"']?(hidden|chat-only)["'"'"']?[ \t\r]*(#.*)?$/{found=1;exit} END{exit !found}' "$f" && printf '/%s\n' "${f#"$SRC"/}"
   done | sed 's/[][*?\\]/\\&/g' > "$LIST"
   # one line per folderVisibility folder that is hidden / chat-only, e.g.:  echo '/private/' >> "$LIST"
   ```
   If the copy already exists, do not merge: the notes are removed by redoing the copy into a fresh `$OUT` (the step 1 refusal makes you choose a new name or delete the old one yourself).

   If the user wants the notes copied, they copy with the key intact and the report lists every one so the user can delete them from `$OUT` before handing the vault over.

   Only if the user asks for the key itself to go, strip it from frontmatter (record the keys first, since nothing marks them afterwards):
   ```bash
   grep -rlE '^visibility:' --include='*.md' "$OUT" | while read -r f; do
       awk 'NR==1&&/^---[ \t\r]*$/{fm=1;print;next} fm&&/^---[ \t\r]*$/{fm=0} fm&&/^visibility:/{next} {print}' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
   done
   ```
   `[ \t\r]` lets the fence match on CRLF files. If the key was the only frontmatter line, an empty `---`/`---` pair is left; clear it with `perl -0pi -e 's/\A---\r?\n---\r?\n//' "$f"` inside the same loop.

5. **Template tokens.** Only files under the `templates.folder` setting (default `Templates`) matter. Remove `{{cursor}}` (Obsidian's core Templates plugin has no cursor token); leave `{{date}}`, `{{time}}`, `{{title}}` and `{{date:FORMAT}}` alone — but Moment formats beyond Bismuth's small vocabulary are Obsidian-side only, so nothing to rewrite. Offset tokens (`{{date+1w}}`, `{{time-30m}}`) have no Obsidian equivalent and cannot be pre-computed (they evaluate when the template is used): leave them, list each in the report as Bismuth-only. Read the folder with `TPL=$(bismuth settings get --key templates.folder --vault "$SRC")` (it prints the default `Templates` when unset). `grep -rnE '\{\{(cursor|(date|time)[+-][^}]*)\}\}' "$OUT/$TPL"` finds them; `perl -pi -e 's/\{\{cursor\}\}//g' "$OUT/$TPL"/*.md` removes the cursor token (the same on macOS and Linux; it does not recurse, so repeat per subfolder).
6. **Daemon memory — omitted by default.** `.daemon/` is hidden, runtime-bound state (crons, processes, sessions, logs, identity) and was excluded at the copy. **Only if the user asks** for the memory notes, copy them as ordinary notes into `Memory/`. This is lossy and, because memory can hold content derived from notes the user hid from agents, **it must honour visibility**. Save as `memory-copy.ts`, run `bun run memory-copy.ts "$SRC" "$OUT"`:
   ```ts
   // memory-copy.ts
   import { readdirSync, readFileSync, writeFileSync, statSync, mkdirSync, existsSync } from 'node:fs'
   import { join, relative, dirname, basename } from 'node:path'

   const [src, out] = process.argv.slice(2)
   let settings: any = {}
   // no catch: if .settings exists but does not parse, abort rather than drop every folder rule
   if (existsSync(join(src, '.settings'))) settings = Bun.YAML.parse(readFileSync(join(src, '.settings'), 'utf8')) ?? {}
   const LIT = ['all', 'chat-only', 'hidden']
   const lit = (v?: string) => (v && LIT.includes(v.toLowerCase()) ? v.toLowerCase() : undefined)
   const folderVis: Record<string, string> = settings.folderVisibility ?? {}
   const fmVis = (t: string) => lit(t.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1].match(/^visibility:\s*['"]?([\w-]+)/m)?.[1])
   const norm = (t: string) => t.replace(/\.md$/i, '').replace(/\\$/, '').toLowerCase()
   const files = (dir: string, acc: string[] = []) => {
       for (const e of readdirSync(dir)) {
           if (e.startsWith('.')) continue
           const p = join(dir, e)
           statSync(p).isDirectory() ? files(p, acc) : e.endsWith('.md') && acc.push(p)
       }
       return acc
   }

   // vault notes: resolved visibility per note (explicit file value, else nearest folder rule)
   const vault = files(src)
   const byPath = new Map<string, string>()
   const byBase = new Map<string, string>()
   const visOf = new Map<string, string>()
   for (const p of vault) {
       const rel = relative(src, p).replace(/\.md$/, '')
       byPath.set(norm(rel), rel)
       byBase.set(norm(basename(rel)), rel)
       let v = fmVis(readFileSync(p, 'utf8'))
       if (!v) {
           const parts = dirname(rel) === '.' ? [] : dirname(rel).split('/')
           for (let i = parts.length; i > 0 && !v; i--) v = lit(folderVis[parts.slice(0, i).join('/')])
       }
       visOf.set(rel, v ?? 'all')
   }
   const restricted = (v?: string) => v === 'hidden' || v === 'chat-only'

   let copied = 0
   const skipped: string[] = []
   const memDir = join(src, '.daemon', 'memory')
   for (const p of files(memDir)) {
       const text = readFileSync(p, 'utf8')
       const targets = [...text.matchAll(/\[\[([^\]]+)\]\]/g)].map(m => norm(m[1].split('|')[0].split('#')[0].trim()))
       const touchesRestricted = targets.some(t => restricted(visOf.get(byPath.get(t) ?? byBase.get(t) ?? '')))
       if (restricted(fmVis(text)) || touchesRestricted) { skipped.push(relative(memDir, p)); continue }
       const dest = join(out, 'Memory', relative(memDir, p))
       mkdirSync(dirname(dest), { recursive: true })
       writeFileSync(dest, text)
       copied++
   }
   console.log(`memory copied=${copied} skipped=${skipped.length}`)
   for (const s of skipped) console.log('skipped (restricted):', s)
   ```
   It skips a memory note when the note's own `visibility` is `hidden`/`chat-only`, **or** when it links to a vault note whose resolved visibility is `hidden`/`chat-only` (file value, else nearest `folderVisibility` rule). That is deliberately over-cautious: memory has no provenance field, so a link is the only evidence of derivation. Report the skipped list.

## Lossy

- Sheets lose formulas, formatting, merged cells, charts; only the first-sheet-style raw values survive (all sheets here, as separate tables).
- ` ```graph ` blocks are text, not pictures; `folderIcons` and tab/pane icons are gone.
- `visibility` is only an inert property in the output; the notes are not hidden from anyone, and any the user chose to exclude are simply absent.
- `{{cursor}}` and offset tokens (Bismuth-only).
- Daemon memory: omitted by default; when copied, `type`, `created`, `updated` become plain properties, `[[links]]` still resolve by file name to vault notes, name clashes with vault notes are possible (the copy goes under `Memory/`, so a clash means two notes with the same basename — check SKILL step 5c). Crons, processes, identity, pages, logs and session state are **never** copied.
- A memory note can embed facts derived from a hidden note even with no link to it; the copy cannot detect that. Say so when the user opts in.

## Validate

- `find "$OUT" -name '*.sheet'` each has a sibling `.md` (or an `EXISTS, skipped` line you explained in the report).
- The report lists every note that carried `visibility:`. If the user chose to exclude restricted notes, `grep -rlE "^visibility:[[:space:]]*['\"]?(hidden|chat-only)" --include='*.md' "$OUT"` prints nothing.
- No `{{cursor}}` remains: `grep -rn '{{cursor}}' "$OUT"` prints nothing.
- If memory was copied: `Memory/` exists, the script's `skipped` list is in the report, and no `.daemon` folder exists in `$OUT`.
