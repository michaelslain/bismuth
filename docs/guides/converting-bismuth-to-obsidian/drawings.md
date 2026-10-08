# Converting Bismuth drawings and ink to Obsidian

Obsidian has no stroke or ink format, so Bismuth drawings convert to pictures or are dropped. This page renders `.draw` files and image or PDF sidecars to PNG, and either strips ` ```draw ` fences from notes (the default) or flattens a note with its ink to a PDF. Excalidraw and similar tools are Obsidian community plugins with their own formats, and nothing here converts to them.

## Sources

Bismuth:
- `docs/drawing/overview.md`: the `.draw` file (`DrawingDoc` JSON), `<file>.draw` image and PDF sidecars, headless export.
- `docs/editor/ink.md`: ink that lives inside a note as a ` ```draw ` fence, and the fence's two modes.
- `docs/export/overview.md`: exporting a note with its ink rendered as pictures.
- `docs/cli/reference.md`: `render` and `export`.

Obsidian:
- https://help.obsidian.md/embeds (raw: https://raw.githubusercontent.com/obsidianmd/obsidian-help/master/en/Linking%20notes%20and%20files/Embed%20files.md): embedding images and PDFs with `![[file]]`.

## Format differences

Ink lives in three places in Bismuth. The list orients you; where a linked live page disagrees, follow the live page and note the difference in the report.

- A standalone `.draw` file is JSON `{v: 1, kind: "drawing", paper: {bg}, pages: [...]}`. It is a file in the tree with its own page, and `![[Sketch.draw]]` renders nothing.
- A ` ```draw ` or ` ```draw block ` fence inside a note holds a base64 payload (a versioned, deflate-compressed stroke stream). ` ```draw ` attaches ink to the block above, and ` ```draw block ` is a standalone sheet. The mode is the info string only.
- A `<file>.draw` sidecar sits next to an image or PDF (`photo.png.draw`). It is created only once something is drawn, and it holds strokes on a blank page background.

Headless tools: `bismuth render <file.draw> [--pdf] [--out FILE] [--theme dark|light]` writes a PNG (or PDF) with no server and no `--vault`. `bismuth export "<note>.md" --format html|pdf|png --vault "$SRC"` renders a note's ink fences as pictures inside page-level output. No command renders one fence on its own.

## Convert

1. `.draw` files to PNG. Keep the `.draw` (Obsidian hides unknown extensions, and the source stays recoverable) and add a picture beside it. The picture is `Sketch.draw.png`:
   ```bash
   find "$OUT" -name '*.draw' | while read -r f; do
       bismuth render "$f" --theme light --out "$f.png" || echo "RENDER FAILED $f"
   done
   ```
   Then rewrite links to the drawing (`[[Sketch.draw]]` or `![[Sketch.draw]]`) to `![[Sketch.draw.png]]`, so they show the picture. Find them, then rewrite each file that matched:
   ```bash
   grep -rnE '\[\[[^]]*\.draw(\||#|\]\])' --include='*.md' "$OUT"
   perl -pi -e 's/!?\[\[([^\]|#]*\.draw)(\|[^\]]*)?\]\]/![[$1.png]]/g' "<file>"
   ```
2. Image and PDF sidecars to PNG. The `find` in step 1 already renders `photo.png.draw` to `photo.png.draw.png`. A sidecar written by drawing in place holds strokes only, so the picture shows the strokes on a plain background and not over the photo. A sidecar page that carries an embedded copy of its source image or PDF page renders that picture under the ink (see Lossy). If a companion note exists for the binary, append `![[photo.png.draw.png]]` under a line `Ink:` (see `companion-notes`); otherwise leave the PNG and say so in the report.
3. ` ```draw ` fences: decide per vault, and the default is strip and report, because Obsidian cannot display the payload.
   - Default, strip: remove every fence and count them. Indented fences, `draw  block` with extra whitespace, empty fences and fences closed by 3 or more backticks all count, as in Bismuth's own scanner, and a backtick fence is closed only by a run of 3 or more backticks. Save the script below as `strip-ink.ts` and run `bun run strip-ink.ts "$OUT"`. Report each file it printed: the ink is absent from the output (the source keeps it).
   - Opt-in, flatten to a picture of the whole note: for notes where the ink matters, before stripping, run the export below. `--out` is cwd-relative, so always give the absolute `$OUT` path, and PDF export needs headless Chrome. Then append `![[<note path without .md>.ink.pdf]]` to the converted note under a heading `Ink (flattened)`. The PDF holds the whole note with its ink drawn in, so the text appears twice; use it only when the user wants the ink kept visible. Check `[ -s "$OUT/<note path without .md>.ink.pdf" ]` before appending the embed; if it fails, do not append it and report the note.
     ```bash
     bismuth export "<note>.md" --format pdf --out "$OUT/<note path without .md>.ink.pdf" --vault "$SRC"
     ```
4. Do not decode a fence payload into another stroke format: no target exists.

The strip script:

```ts
// strip-ink.ts
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// A line scanner that follows core/src/drawing/drawBlocks.ts (scanDrawBlocks): any fence
// (indented, 3+ backticks or tildes) is opened and consumed to its closer, which must be
// the same character, at least as long, alone on its line. Only an exactly-3-backtick fence
// whose info string is `draw` or `draw block` (any whitespace between the words) is removed.
// Fences quoted inside a longer fence are content and stay.
const MARKER = /^(\s*)(`{3,}|~{3,})(.*)$/
const isDrawInfo = (info: string) => {
    const n = info.trim().split(/\s+/).join(' ')
    return n === 'draw' || n === 'draw block'
}

let removed = 0
const unterminated: string[] = []
const strip = (text: string, path: string) => {
    const lines = text.split('\n')
    const keep: string[] = []
    let i = 0
    while (i < lines.length) {
        const m = lines[i].replace(/\r$/, '').match(MARKER)
        if (!m) {
            keep.push(lines[i++])
            continue
        }
        const closer = new RegExp(`^\\s*${m[2][0]}{${m[2].length},}\\s*$`)
        let close = -1
        for (let j = i + 1; j < lines.length; j++) {
            if (closer.test(lines[j].replace(/\r$/, ''))) {
                close = j
                break
            }
        }
        const draw = m[2] === '```' && isDrawInfo(m[3])
        if (draw && close === -1) {
            // Bismuth reads an unterminated draw fence as running to the end of the note;
            // do not delete the rest of the note blindly: leave it and report it.
            unterminated.push(path)
            keep.push(...lines.slice(i))
            break
        }
        if (draw) removed++
        else keep.push(...lines.slice(i, close === -1 ? lines.length : close + 1))
        i = close === -1 ? lines.length : close + 1
    }
    return keep.join('\n')
}

const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
        if (entry.startsWith('.')) continue
        const path = join(dir, entry)
        if (statSync(path).isDirectory()) walk(path)
        else if (entry.endsWith('.md')) {
            const text = readFileSync(path, 'utf8')
            const next = strip(text, path)
            if (next !== text) {
                writeFileSync(path, next)
                console.log(path)
            }
        }
    }
}
walk(process.argv[2])
for (const p of unterminated) console.log('UNTERMINATED draw fence left in place:', p)
console.log(`removed=${removed}`)
```

## Lossy

- All ` ```draw ` ink is lost from the output markdown (default) or reduced to a flat picture (opt-in). This is the one conversion with no equivalent.
- Standalone `.draw` files keep their strokes only as a picture, and cannot be edited.
- Sidecar ink renders on a blank background, not over its photo or PDF page, when the sidecar was written by in-place drawing (`paper.bg` blank, strokes only). A sidecar page that stores its source image or PDF page in `pages[i].images` renders that image too, so its PNG includes the photo or page (`docs/drawing/overview.md`, "Where sidecar ink sits on its source page").
- PDF annotations stored in a sidecar (highlights, margin, bookmarks) are not rendered by `render`.
- Page backgrounds other than blank may differ slightly between `render --theme` and what the app showed.

## Validate

- This prints nothing (guide step 5 a). The pattern allows indentation (a fence inside a list item) and extra whitespace in the info string, as Bismuth's scanner does. A hit inside a longer outer fence (a quoted example) is documentation; judge it by eye. Any `UNTERMINATED` line the script printed is a fence it left in place: report the file.
  ```bash
  grep -rcE '^[[:space:]]*```[[:space:]]*draw([[:space:]]+block)?[[:space:]]*$' --include='*.md' "$OUT" | grep -v ':0$'
  ```
- Every `.draw` in `$OUT` has a non-empty `.draw.png` beside it:
  ```bash
  find "$OUT" -name '*.draw' | while read -r f; do [ -s "$f.png" ] || echo "MISSING $f.png"; done
  ```
- No `[[...draw]]` link still points at a bare `.draw` (the grep from step 1 returns nothing).
- The report lists every file with stripped fences and every drawing that failed to render.
