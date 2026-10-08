# Converting Bismuth companion notes to Obsidian

A companion note is the hidden markdown note that holds an image's or PDF's tags and scratch text, named `<file>.<ext>.md`. Obsidian has no per-binary tags, so the companion becomes an ordinary visible note. This page offers three ways to convert it; the default keeps every companion and prepends an embed of its binary.

## Sources

Bismuth:
- `docs/vault/frontmatter.md`: the companion-notes section, covering what a companion is, how tags attach to an image or PDF, and scratch-note regions.
- `docs/vault/structure.md`: how the file tree hides and moves companions.
- `docs/drawing/overview.md`: the scratch-note feature that writes into companions.
- `docs/vault/attachments.md`: how embeds of images and PDFs resolve.

Obsidian:
- https://help.obsidian.md/embeds (raw: https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Linking%20notes%20and%20files/Embed%20files.md): `![[photo.png]]`, `![[paper.pdf]]`.
- https://help.obsidian.md/properties (raw: https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Editing%20and%20formatting/Properties.md): frontmatter properties, including `tags`.
- https://help.obsidian.md/tags (raw: https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Editing%20and%20formatting/Tags.md): tags.

## Format differences

The comparison orients you; where a linked live page disagrees, follow the live page and note the difference in the report.

In Bismuth an image or PDF has no frontmatter of its own, so its tags live in a companion note whose name is the binary's full file name plus `.md`: `photo.png` has `photo.png.md`, and `paper.pdf` has `paper.pdf.md`. The extension stays. The companion is an ordinary note, with frontmatter `tags: [...]` plus an optional hand-written body, created on the first tag edit. Companionable files are images (`png jpg jpeg gif webp avif bmp ico svg heic heif tif tiff`) and `pdf`. While the binary exists, the app hides the companion in the file tree and opens the binary instead; the companion is still a node in the graph, the tag graph and Bases. The body may also hold scratch-note regions:

```
<!-- scratch id=k3f9 p=3 x=842 y=412 w=300 -->
text the user placed beside page 3
<!-- /scratch -->
```

Obsidian has no per-binary tags. `photo.png.md` is a plain visible note named `photo.png`; Obsidian shows it in the file explorer, and its tags join the tag pane.

## Convert

Three options exist, and the default is (b): keep the companions and make them visible and useful.

| | Option | Tags | Cost |
|---|---|---|---|
| a | Drop the companions | lost | simplest; the binaries stay but lose their tags |
| b | Keep, prepend an embed of the binary (default) | kept, searchable in Obsidian's tag pane | one extra visible note per binary |
| c | Merge tags into whichever note embeds the binary | kept, on a different note | judgment per note; rewrites user notes |

Option (b) loses nothing the user wrote, needs no judgment, and turns the companion into a gallery card: the note shows the picture or PDF, carries the tags, and keeps any scratch text. Option (a) silently deletes the tags, and option (c) edits notes the user never asked you to touch.

Procedure for (b). Save the script as `companions.ts` and run `bun run companions.ts "$OUT"`:

```ts
// companions.ts
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'

const root = process.argv[2]
let done = 0
const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
        if (entry.startsWith('.')) continue
        const path = join(dir, entry)
        if (statSync(path).isDirectory()) walk(path)
        else if (/\.[A-Za-z0-9]+\.md$/.test(entry) && existsSync(path.slice(0, -3))) {
            const binary = basename(path.slice(0, -3))
            const embed = `![[${binary}]]`
            let text = readFileSync(path, 'utf8')
            // scratch regions: keep the text, drop the markers, keep the page number
            text = text
                .replace(/^<!-- scratch [^>]*?\bp=(\d+)[^>]*-->[ \t]*$/gm, '**Scratch note (page $1):**')
                .replace(/^<!-- scratch [^>]*-->[ \t]*$/gm, '**Scratch note:**')
                .replace(/^<!-- \/scratch -->[ \t]*\r?\n?/gm, '')
            if (!text.includes(embed)) {
                const fm = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
                const head = fm ? fm[0] : ''
                text = head + (head && !head.endsWith('\n') ? '\n' : '') + embed + '\n\n' + text.slice(head.length).replace(/^\s+/, '')
            }
            writeFileSync(path, text)
            done++
            console.log(path)
        }
    }
}
walk(root)
console.log(`companions=${done}`)
```

For option (a), delete every companion that has a sibling binary. The inventory loop from guide step 2 lists exactly these files:

```bash
find "$OUT" -name '*.*.md' | while read -r f; do [ -e "${f%.md}" ] && rm "$f"; done
```

For option (c), run `grep -rl '!\[\[<binary>\]\]'` per companion to find the notes that embed the binary, add the companion's tags to each one's `tags:`, and delete the companion. Do this only when the user asked for it.

`<file>.draw` sidecars (ink on the binary) are handled in `drawings`. If you appended a picture there, it goes into the same companion note.

## Lossy

- Under (a) every companion's tags and scratch text are lost. Under (b) and (c) the position data of a scratch note (`x`, `y`, `w`, `id`) is lost, and only the page number and text survive.
- The companion is a visible note in Obsidian; Bismuth hid it while its binary existed.
- A link `[[photo.png]]` means the picture in Obsidian, never the companion note. Reach the note as `[[photo.png.md]]`, which is unverified: check in Obsidian before promising it.
- Obsidian has no per-binary tags, so a user who edits the companion's tags in Obsidian edits a note, not the binary.

## Validate

- Every binary with a companion in the inventory still has it (b) or has none (a). Compare `find "$OUT" -name '*.*.md'` against the inventory list.
- No scratch comment markers remain; this prints nothing:
  ```bash
  grep -rn '<!-- /\?scratch' --include='*.md' "$OUT"
  ```
- Under (b) each companion starts with its embed after the frontmatter, and `tags:` is unchanged (diff against `$SRC`).
- Every `![[binary]]` resolves (guide step 5 c).
