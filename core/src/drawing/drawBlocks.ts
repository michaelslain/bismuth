import { decodeStrokes, encodeStrokes } from './inkCodec'
import type { Stroke } from './model'

// Locates ` ```draw ` fences in a note's markdown text, associates each with the block it
// decorates, and reads/writes a note's ink without disturbing the rest of the document. Kept
// free of CodeMirror and DOM imports so it runs headless under `bun test` — see the comment at
// the top of app/src/editor/blockRegions.ts for why that matters in this codebase.
//
// A fence's MODE IS WRITTEN IN THE FENCE, not inferred from what surrounds it:
//
//     ```draw          an ATTACHED fence — ink over the block above it, reserving no height
//     ```draw block    a STANDALONE fence — a drawing of its own, reserving the ink's height
//
// This used to be decided by whether a blank line sat above the fence, and that inference was
// the root of two separate defects: the autosave's frontmatter normalizer flipped a fence's
// mode by inserting a blank line, and pressing Enter once at the end of an annotated paragraph
// flipped it by hand — measured, the annotation jumped 78px into a newly reserved 139px box.
// Both are the same bug: geometry stored under one rule, reinterpreted under the other, by an
// edit somewhere else in the note. A marker makes the mode a property of the fence, so nothing
// outside it can reinterpret its contents.
//
// Fence tracking follows CommonMark's fenced-code rule: a fence opens with a run of 3+
// backticks or tildes, and only closes on a line whose marker is the SAME character with a
// run at least as long. A shorter or differently-charactered run inside the body is just
// content. This is what makes "```draw fenced inside an outer ````-fenced example" legal
// markdown and NOT a live draw block — see app/src/editor/blockRegions.ts (FENCE_OPEN_RE) and
// core/src/wikilinks.ts, which both already blank/skip fence bodies by the same rule.

// Matches ANY fence marker line (open, with optional info string, or bare close).
const FENCE_MARKER_RE = /^(\s*)(`{3,}|~{3,})(.*)$/

/** The info string of an attached draw fence, and of a standalone one. */
export const DRAW_INFO = 'draw'
export const DRAW_BLOCK_INFO = 'draw block'

/** Is this fence info string a draw fence, and if so which kind? `null` for anything else, so
 *  an unrecognised `draw whatever` stays an ordinary code fence rather than being guessed at.
 *  Exported because `app/src/editor/blockRegions.ts` has to skip these fences in its own
 *  per-line pass and must agree with this module about which ones they are. */
export function drawFenceKind(info: string): 'attached' | 'standalone' | null {
    const normalized = info.trim().split(/\s+/).join(' ')
    if (normalized === DRAW_INFO) return 'attached'
    if (normalized === DRAW_BLOCK_INFO) return 'standalone'
    return null
}

export interface DrawBlock {
    // 1-based inclusive line range of the fence itself (the ```draw line through the
    // closing ``` line, or to the end of the document when unterminated).
    fromLine: number
    toLine: number
    strokes: Stroke[]
    // From the fence's own info string, never from its surroundings. `true` for ```draw block.
    standalone: boolean
    // The last line of the block an ATTACHED fence decorates: the nearest non-blank line above
    // it, skipping any blank lines the user has typed in between — which is what keeps the fence
    // pointing at its paragraph when someone presses Enter at the end of it. Always null for a
    // standalone fence (it decorates nothing), and null for an attached fence with nothing above
    // it at all.
    attachedToLine: number | null
}

function stripCr(line: string): string {
    return line.endsWith('\r') ? line.slice(0, -1) : line
}

export function scanDrawBlocks(text: string): DrawBlock[] {
    const lines = text.split('\n')
    const blocks: DrawBlock[] = []

    let i = 0
    while (i < lines.length) {
        const line = stripCr(lines[i])
        const m = line.match(FENCE_MARKER_RE)
        if (!m) {
            i++
            continue
        }

        const markerChar = m[2][0]
        const markerLen = m[2].length
        const info = m[3].trim()
        const closeRe = new RegExp(`^\\s*${markerChar}{${markerLen},}\\s*$`)

        let closeIdx = -1
        for (let j = i + 1; j < lines.length; j++) {
            if (closeRe.test(stripCr(lines[j]))) {
                closeIdx = j
                break
            }
        }

        const kind =
            markerChar === '`' && markerLen === 3 ? drawFenceKind(info) : null

        if (kind) {
            const payloadLines = lines.slice(i + 1, closeIdx === -1 ? lines.length : closeIdx)
            const payload = payloadLines.map(stripCr).join('\n').trim()

            let strokes: Stroke[] = []
            try {
                strokes = payload ? decodeStrokes(payload) : []
            } catch {
                strokes = []
            }

            // The nearest non-blank line above, skipping blanks. A fence marker line counts: a
            // fence sitting under a closing ``` decorates that code block.
            let attachedToLine: number | null = null
            if (kind === 'attached') {
                for (let k = i - 1; k >= 0; k--) {
                    if (stripCr(lines[k]).trim() === '') continue
                    attachedToLine = k + 1
                    break
                }
            }

            const toLine = closeIdx === -1 ? lines.length : closeIdx + 1

            blocks.push({
                fromLine: i + 1,
                toLine,
                strokes,
                standalone: kind === 'standalone',
                attachedToLine,
            })
        }

        // Whether or not this fence is a draw fence, its whole body is consumed here — a
        // nested fence-looking line inside it (e.g. a ```draw example quoted inside a wider
        // ```` fence) is content, not a real fence, and must never be scanned on its own.
        i = closeIdx === -1 ? lines.length : closeIdx + 1
    }

    return blocks
}

export function writeDrawBlock(text: string, block: DrawBlock, strokes: Stroke[]): string {
    const lines = text.split('\n')
    // fromLine is the ```draw line (1-based); the payload occupies the lines between the
    // opening and closing fence markers.
    const openIdx = block.fromLine - 1
    const closeIdx = block.toLine - 1

    // Preserve the original payload line's indentation and line ending (CRLF vs LF) rather
    // than emitting a bare LF/unindented line — this module's contract is that it does not
    // disturb what it did not intend to touch.
    const oldPayloadLines = lines.slice(openIdx + 1, closeIdx)
    const sample = oldPayloadLines[0] ?? lines[openIdx]
    const eol = sample.endsWith('\r') ? '\r' : ''
    const prefixMatch = stripCr(sample).match(/^(\s*)/)
    const prefix = prefixMatch ? prefixMatch[1] : ''

    const payload = prefix + encodeStrokes(strokes) + eol
    const before = lines.slice(0, openIdx + 1)
    const after = lines.slice(closeIdx)
    return [...before, payload, ...after].join('\n')
}

export function insertDrawBlock(
    text: string,
    afterLine: number,
    strokes: Stroke[],
    standalone = false,
): string {
    const lines = text.split('\n')
    const payload = encodeStrokes(strokes)
    // Match the document's line ending, the way writeDrawBlock already does for the payload it
    // replaces. Emitting bare LF into a CRLF note leaves three mixed-ending lines in the middle
    // of the file, which every later scan has to `stripCr` around and which shows up as a
    // whole-file diff the first time an editor normalizes it.
    const eol = lines.some(l => l.endsWith('\r')) ? '\r' : ''
    const open = '```' + (standalone ? DRAW_BLOCK_INFO : DRAW_INFO)
    const fenceLines = [open + eol, payload + eol, '```' + eol]
    const insertAt = Math.max(0, Math.min(afterLine, lines.length))
    const before = lines.slice(0, insertAt)
    const after = lines.slice(insertAt)
    return [...before, ...fenceLines, ...after].join('\n')
}

export function removeDrawBlock(text: string, block: DrawBlock): string {
    const lines = text.split('\n')
    let openIdx = block.fromLine - 1
    const closeIdx = block.toLine - 1

    // A standalone fence is preceded by a blank line that exists only to separate it from
    // the previous block. Deleting the fence but not that blank line leaves it stacked
    // against whatever blank line follows the fence, doubling the separator. Swallow it too
    // so removal restores exactly one blank line, matching the attached case (which never had
    // a leading blank to begin with).
    if (block.standalone && openIdx > 0 && lines[openIdx - 1].trim() === '') {
        openIdx -= 1
    }

    const before = lines.slice(0, openIdx)
    const after = lines.slice(closeIdx + 1)
    return [...before, ...after].join('\n')
}
