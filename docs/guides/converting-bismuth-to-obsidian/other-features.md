# Converting sheets, graph blocks, icons, visibility and daemon memory to Obsidian

Several Bismuth features have no Obsidian counterpart: `.sheet` spreadsheets, ` ```graph ` fences, `icon:` frontmatter, `visibility:` keys, template tokens beyond the core three, and the daemon's memory notes. This page converts what can be converted (sheets to markdown tables, memory notes to a `Memory/` folder), keeps the rest as inert text, and makes the privacy decision about restricted notes explicit.

## Sources

Bismuth:
- `docs/sheets/overview.md`: the `.sheet` file (Univer workbook JSON) and what export reads.
- `docs/export/overview.md`: which formats each file kind exports to.
- `docs/editor/graph-block.md`: the ` ```graph ` fence.
- `docs/vault/structure.md`: `icon:` frontmatter and `folderIcons`.
- `docs/vault/visibility.md`: `visibility:` (`hidden`, `chat-only`, `all`), `folderVisibility`, memory notes' own `visibility`.
- `docs/templates/syntax.md`: `{{date}}`, `{{time}}`, `{{title}}`, `{{cursor}}`, offsets and formats.
- `docs/daemon/memory.md` and `docs/daemon/storage.md`: the `.daemon/memory` store and everything else under `.daemon/`.

Obsidian:
- https://help.obsidian.md/plugins/templates (raw: https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Plugins/Templates.md): core template variables (`{{title}}`, `{{date}}`, `{{time}}`, format strings).
- https://help.obsidian.md/properties (raw: https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Editing%20and%20formatting/Properties.md): a `visibility:` or `icon:` key is just another property.

## Format differences

The table orients you; where a linked live page disagrees, follow the live page and note the difference in the report.

| Bismuth | Obsidian |
|---|---|
| `.sheet`: Univer `IWorkbookData` JSON, `sheets{id: {name, cellData{row: {col: {v}}}}}`, `sheetOrder` | no spreadsheet type |
| ` ```graph ` fence (`a: Alice`, `a -> b: label`, `b -- c`) | an ordinary code block |
| `icon:` frontmatter, `folderIcons` setting | `icon:` is an inert property; icons need a plugin |
| `visibility: hidden / chat-only / all`, `folderVisibility` | nothing; Bismuth-only AI-access rules |
| `{{date}}` `{{time}}` `{{title}}` with `:FORMAT` | the same three variables; the format uses Moment tokens |
| `{{cursor}}`, `{{date+1w}}` offsets | no counterpart in the core Templates plugin |
| `.daemon/memory/*.md` (type, tags, created, updated, `[[links]]`) | no counterpart |

`bismuth export` gives a sheet `html`, `pdf` or `png` only, and HTML reads only the first sheet's raw values, so a sheet needs your own conversion.

## Convert

### 1. Sheets to a markdown table per sheet

Cell values only (`v`); formulas collapse to their last value. Save the script as `sheets.ts` and run `bun run sheets.ts "$OUT"`. It writes `<name>.md` beside each `.sheet` (keeping the `.sheet`), refuses to overwrite an existing note, and prints `sheets=<n>`:

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

The first sheet row becomes the table header. Report that formatting, formulas, merged cells and charts are not carried over.

### 2. Graph fences

Keep ` ```graph ` fences as ordinary code blocks (Obsidian shows the text) and report each file. Do not invent a diagram; Mermaid is an option only if the user asks.

### 3. Icons

Leave `icon:` frontmatter in place (an unused property). Drop `folderIcons` (see `vault-and-settings`). Mention an icon plugin in the report if the user cares.

### 4. Visibility keys

Keep `visibility:` keys, and ask before copying restricted notes. To Obsidian `visibility:` is an inert property, so by default leave the key in place: stripping it would erase the only marker of what was restricted. First record the keys for the report (counts of `hidden`, `chat-only` and `all`, with paths), using `grep -rE '^visibility:' --include='*.md' "$SRC"` plus the `folderVisibility` rules from `bismuth settings get --key folderVisibility --vault "$SRC"`.

Then ask the user whether `hidden` and `chat-only` notes (and every note under a `folderVisibility` folder) should be copied at all. They are ordinary notes to Obsidian, and the vault may be handed to someone else. To leave them out, build an exclude list before the guide's step 1 copy and add `--exclude-from="$LIST"` to that rsync. Paths are relative to the vault root with a leading `/`, which is what rsync anchors on:

```bash
LIST="${SRC%/}.exclude-list"
find "$SRC" -name '*.md' -print0 | while IFS= read -r -d '' f; do
  awk 'NR==1&&/^---[ \t\r]*$/{fm=1;next} fm&&/^---[ \t\r]*$/{exit} fm&&/^visibility:[ \t]*["'"'"']?(hidden|chat-only)["'"'"']?[ \t\r]*(#.*)?$/{found=1;exit} END{exit !found}' "$f" && printf '/%s\n' "${f#"$SRC"/}"
done | sed 's/[][*?\\]/\\&/g' > "$LIST"
# one line per folderVisibility folder that is hidden / chat-only, e.g.:  echo '/private/' >> "$LIST"
```

If the copy already exists, do not merge: redo the copy into a fresh `$OUT`, because the step 1 refusal makes you choose a new name or delete the old one yourself.

If the user wants the notes copied, they copy with the key intact, and the report lists every one so the user can delete them from `$OUT` before handing the vault over.

Only if the user asks for the key itself to go, strip it from frontmatter. Record the keys first, since nothing marks them afterwards:

```bash
grep -rlE '^visibility:' --include='*.md' "$OUT" | while read -r f; do
    awk 'NR==1&&/^---[ \t\r]*$/{fm=1;print;next} fm&&/^---[ \t\r]*$/{fm=0} fm&&/^visibility:/{next} {print}' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
done
```

`[ \t\r]` lets the fence match on CRLF files. If the key was the only frontmatter line, an empty `---`/`---` pair is left; clear it with `perl -0pi -e 's/\A---\r?\n---\r?\n//' "$f"` inside the same loop.

### 5. Template tokens

Only files under the `templates.folder` setting (default `Templates`) matter. Remove `{{cursor}}`, because Obsidian's core Templates plugin has no cursor token. Leave `{{date}}`, `{{time}}`, `{{title}}` and `{{date:FORMAT}}` alone; Moment formats beyond Bismuth's small vocabulary are Obsidian-side only, so there is nothing to rewrite. Offset tokens (`{{date+1w}}`, `{{time-30m}}`) have no Obsidian equivalent and cannot be pre-computed, because they evaluate when the template is used: leave them and list each in the report as Bismuth-only.

Read the folder with `TPL=$(bismuth settings get --key templates.folder --vault "$SRC")` (it prints the default `Templates` when unset). Find the tokens, then remove the cursor token; the perl line behaves the same on macOS and Linux, does not recurse, and must be repeated per subfolder:

```bash
grep -rnE '\{\{(cursor|(date|time)[+-][^}]*)\}\}' "$OUT/$TPL"
perl -pi -e 's/\{\{cursor\}\}//g' "$OUT/$TPL"/*.md
```

### 6. Daemon memory (omitted by default)

`.daemon/` is hidden, runtime-bound state (crons, processes, sessions, logs, identity) and was excluded at the copy. Only if the user asks for the memory notes, copy them as ordinary notes into `Memory/`. This is lossy, and because memory can hold content derived from notes the user hid from agents, it must honour visibility. Save the script as `memory-copy.ts` and run `bun run memory-copy.ts "$SRC" "$OUT"`:

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
// folderVisibility exactly as core reads it (core/src/settings.ts readFolderVisibilityFrom):
// only 'chat-only' | 'hidden' count, and each key is normalised (trailing slashes stripped,
// repeated slashes collapsed), so a key written `Private/` still enforces as `Private`
const normKey = (k: string) => k.replace(/\/+$/, '').replace(/\/{2,}/g, '/')
const folderVis: Record<string, string> = {}
for (const [k, v] of Object.entries(settings.folderVisibility ?? {}))
    if (v === 'chat-only' || v === 'hidden') folderVis[normKey(k)] = v
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
        for (let i = parts.length; i > 0 && !v; i--) v = folderVis[parts.slice(0, i).join('/')]
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

The script skips a memory note when the note's own `visibility` is `hidden` or `chat-only`, or when it links to a vault note whose resolved visibility is `hidden` or `chat-only` (the file value, else the nearest `folderVisibility` rule). Folder keys are normalised like core's, so `Private/` matches `Private`, and a folder rule other than `chat-only` or `hidden` is ignored, as core ignores it. That is deliberately over-cautious: memory has no provenance field, so a link is the only evidence of derivation. Report the skipped list.

## Lossy

- Sheets lose formulas, formatting, merged cells and charts; only raw values survive, with every sheet as a separate table.
- ` ```graph ` blocks are text, not pictures; `folderIcons` and tab or pane icons are not carried over.
- `visibility` is only an inert property in the output. The notes are not hidden from anyone, and any the user chose to exclude are absent.
- `{{cursor}}` and offset tokens are Bismuth-only.
- Daemon memory is omitted by default. When copied, `type`, `created` and `updated` become plain properties and `[[links]]` still resolve by file name to vault notes. Name clashes with vault notes are possible: the copy goes under `Memory/`, so a clash means two notes with the same basename (check guide step 5c). Crons, processes, identity, pages, logs and session state are never copied.
- A memory note can embed facts derived from a hidden note even with no link to it, and the copy cannot detect that. Say so when the user opts in.

## Validate

- Every `.sheet` has a sibling `.md`, or an `EXISTS, skipped` line you explained in the report:
  ```bash
  find "$OUT" -name '*.sheet'
  ```
- The report lists every note that carried `visibility:`. If the user chose to exclude restricted notes, this prints nothing:
  ```bash
  grep -rlE "^visibility:[[:space:]]*['\"]?(hidden|chat-only)" --include='*.md' "$OUT"
  ```
- No `{{cursor}}` remains; this prints nothing:
  ```bash
  grep -rn '{{cursor}}' "$OUT"
  ```
- If memory was copied, `Memory/` exists, the script's `skipped` list is in the report, and no `.daemon` folder exists in `$OUT`.
