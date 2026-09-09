import { decodeStrokes, encodeStrokes } from './inkCodec'
import type { Stroke } from './model'

// Locates ` ```draw ` fences in a note's markdown text, associates each with the block it
// decorates (or marks it standalone), and reads/writes a note's ink without disturbing the
// rest of the document. Kept free of CodeMirror and DOM imports so it runs headless under
// `bun test` — see the comment at the top of app/src/editor/blockRegions.ts for why that
// matters in this codebase.
//
// Fence tracking follows CommonMark's fenced-code rule: a fence opens with a run of 3+
// backticks or tildes, and only closes on a line whose marker is the SAME character with a
// run at least as long. A shorter or differently-charactered run inside the body is just
// content. This is what makes "```draw fenced inside an outer ````-fenced example" legal
// markdown and NOT a live draw block — see app/src/editor/blockRegions.ts (FENCE_OPEN_RE) and
// core/src/wikilinks.ts, which both already blank/skip fence bodies by the same rule.

// Matches ANY fence marker line (open, with optional info string, or bare close).
const FENCE_MARKER_RE = /^(\s*)(`{3,}|~{3,})(.*)$/

export interface DrawBlock {
    // 1-based inclusive line range of the fence itself (the ```draw line through the
    // closing ``` line, or to the end of the document when unterminated).
    fromLine: number
    toLine: number
    strokes: Stroke[]
    // The last line of the block the fence decorates, or null when the fence is standalone
    // (preceded by a blank line, another fence marker line, or the start of the document).
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

        const isDrawFence = markerChar === '`' && markerLen === 3 && info === 'draw'

        if (isDrawFence) {
            const payloadLines = lines.slice(i + 1, closeIdx === -1 ? lines.length : closeIdx)
            const payload = payloadLines.map(stripCr).join('\n').trim()

            let strokes: Stroke[] = []
            try {
                strokes = payload ? decodeStrokes(payload) : []
            } catch {
                strokes = []
            }

            const prevIdx = i - 1
            const prevLine = prevIdx >= 0 ? stripCr(lines[prevIdx]) : null
            const attachedToLine =
                prevLine !== null && prevLine.trim() !== '' && !FENCE_MARKER_RE.test(prevLine)
                    ? prevIdx + 1
                    : null

            const toLine = closeIdx === -1 ? lines.length : closeIdx + 1

            blocks.push({ fromLine: i + 1, toLine, strokes, attachedToLine })
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

export function insertDrawBlock(text: string, afterLine: number, strokes: Stroke[]): string {
    const lines = text.split('\n')
    const payload = encodeStrokes(strokes)
    // Match the document's line ending, the way writeDrawBlock already does for the payload it
    // replaces. Emitting bare LF into a CRLF note leaves three mixed-ending lines in the middle
    // of the file, which every later scan has to `stripCr` around and which shows up as a
    // whole-file diff the first time an editor normalizes it.
    const eol = lines.some(l => l.endsWith('\r')) ? '\r' : ''
    const fenceLines = ['```draw' + eol, payload + eol, '```' + eol]
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
    if (block.attachedToLine === null && openIdx > 0 && lines[openIdx - 1].trim() === '') {
        openIdx -= 1
    }

    const before = lines.slice(0, openIdx)
    const after = lines.slice(closeIdx + 1)
    return [...before, ...after].join('\n')
}
