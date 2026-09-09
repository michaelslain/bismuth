import { decodeStrokes, encodeStrokes } from './inkCodec'
import type { Stroke } from './model'

// Locates ` ```draw ` fences in a note's markdown text, associates each with the block it
// decorates (or marks it standalone), and reads/writes a note's ink without disturbing the
// rest of the document. Kept free of CodeMirror and DOM imports so it runs headless under
// `bun test` — see the comment at the top of app/src/editor/blockRegions.ts for why that
// matters in this codebase.

const FENCE_OPEN = /^\s*```draw\s*$/
const FENCE_CLOSE = /^\s*```\s*$/

export interface DrawBlock {
    // 1-based inclusive line range of the fence itself (the ```draw line through the
    // closing ``` line, or to the end of the document when unterminated).
    fromLine: number
    toLine: number
    strokes: Stroke[]
    // The last line of the block the fence decorates, or null when the fence is standalone
    // (preceded by a blank line or the start of the document).
    attachedToLine: number | null
}

export function scanDrawBlocks(text: string): DrawBlock[] {
    const lines = text.split('\n')
    const blocks: DrawBlock[] = []

    for (let i = 0; i < lines.length; i++) {
        if (!FENCE_OPEN.test(lines[i])) continue

        const fromLine = i + 1 // 1-based
        let closeIdx = -1
        for (let j = i + 1; j < lines.length; j++) {
            if (FENCE_CLOSE.test(lines[j])) {
                closeIdx = j
                break
            }
        }

        const payloadLines = lines.slice(i + 1, closeIdx === -1 ? lines.length : closeIdx)
        const payload = payloadLines.join('\n').trim()

        let strokes: Stroke[] = []
        try {
            strokes = payload ? decodeStrokes(payload) : []
        } catch {
            strokes = []
        }

        const prevLineIdx = i - 1
        const attachedToLine =
            prevLineIdx >= 0 && lines[prevLineIdx].trim() !== '' ? prevLineIdx + 1 : null

        const toLine = closeIdx === -1 ? lines.length : closeIdx + 1

        blocks.push({ fromLine, toLine, strokes, attachedToLine })

        // Resume scanning after this fence (or at end of document if unterminated).
        i = closeIdx === -1 ? lines.length : closeIdx
    }

    return blocks
}

export function writeDrawBlock(text: string, block: DrawBlock, strokes: Stroke[]): string {
    const lines = text.split('\n')
    const payload = encodeStrokes(strokes)
    // fromLine is the ```draw line (1-based); the payload occupies the lines between the
    // opening and closing fence markers.
    const openIdx = block.fromLine - 1
    const closeIdx = block.toLine - 1
    const before = lines.slice(0, openIdx + 1)
    const after = lines.slice(closeIdx)
    return [...before, payload, ...after].join('\n')
}

export function insertDrawBlock(text: string, afterLine: number, strokes: Stroke[]): string {
    const lines = text.split('\n')
    const payload = encodeStrokes(strokes)
    const fenceLines = ['```draw', payload, '```']
    const insertAt = Math.max(0, Math.min(afterLine, lines.length))
    const before = lines.slice(0, insertAt)
    const after = lines.slice(insertAt)
    return [...before, ...fenceLines, ...after].join('\n')
}

export function removeDrawBlock(text: string, block: DrawBlock): string {
    const lines = text.split('\n')
    const openIdx = block.fromLine - 1
    const closeIdx = block.toLine - 1
    const before = lines.slice(0, openIdx)
    const after = lines.slice(closeIdx + 1)
    return [...before, ...after].join('\n')
}
