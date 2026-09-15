// core/src/scratchNotes.ts
// Pure parse/serialize for scratch-note blocks stored inside a companion note's BODY (the text
// after the frontmatter fence — app/src/preview/companionDoc.ts's splitCompanion carves that off;
// this module never sees the fence itself). Format is plan "Companion note format":
//
//   Anything the user wrote by hand stays here, untouched.
//
//   <!-- scratch id=k3f9 p=300 x=842 y=412 w=300 -->
//   **why?** see [[Lecture 7]]
//   <!-- /scratch -->
//
// `p` is 1-based in the file (a person reads it); `page` is 0-based in memory (ScratchBlock, from
// core/src/scratchTypes.ts). A start marker with no matching end, or with unparseable attributes,
// is NOT a block — the line(s) stay in the hand-written text verbatim (no exception thrown, no
// data dropped). Framework-free so it's unit-testable without a DOM.
import type { ScratchBlock } from './scratchTypes'

/** The literal line a block's own text may never contain unescaped — it would otherwise close its
 *  own region early. `escapeEndMarker`/`unescapeEndMarker` round-trip it as `<!-- /scratch -- >`
 *  (an extra space before the closing `>`), which can never match the real closer below. */
const END_MARKER = '<!-- /scratch -->'
const ESCAPED_END_MARKER = '<!-- /scratch -- >'

// A full region: a start marker at the beginning of a line (id: lowercase-base36, p/w: unsigned
// integers, x/y: signed integers — anything else on that line fails to match, so it is left as
// ordinary text rather than thrown), its content (non-greedy — stops at the FIRST literal
// end-marker line, which is safe because any end-marker line INSIDE the content was escaped on
// write), and the first following line that is exactly the end marker. Both markers are anchored
// to the start of a line via a lookbehind/lookahead so an end marker embedded mid-sentence in
// hand-written text can never (mis)start or (mis)close a region.
const REGION_RE =
    /(?<=^|\n)<!-- scratch id=([a-z0-9]+) p=(\d+) x=(-?\d+) y=(-?\d+) w=(\d+) -->\n([\s\S]*?)\n<!-- \/scratch -->(?=\n|$)/g

function escapeEndMarker(text: string): string {
    return text
        .split('\n')
        .map(line => (line === END_MARKER ? ESCAPED_END_MARKER : line))
        .join('\n')
}

function unescapeEndMarker(text: string): string {
    return text
        .split('\n')
        .map(line => (line === ESCAPED_END_MARKER ? END_MARKER : line))
        .join('\n')
}

/** Parse a companion note's body into the hand-written text (`rest`) and every scratch block it
 *  contains. `\r\n` is normalized to `\n` first (this module's own writer — serializeScratch —
 *  only ever emits `\n`, so a CRLF body only arises from a file edited by hand elsewhere).
 *
 *  Hand-written text before, between and after regions is gathered into `rest` in its original
 *  order, with the single blank line serializeScratch uses to separate it from/between regions
 *  stripped back out (so a second parse+serialize round trip is stable — see serializeScratch's
 *  header). Blocks are returned in the order their regions appear in the text; serializeScratch
 *  always writes them sorted by page, then y, then x, so a body it wrote round-trips sorted. */
export function parseScratch(body: string): {
    rest: string
    blocks: ScratchBlock[]
} {
    const normalized = body.replace(/\r\n/g, '\n')
    const blocks: ScratchBlock[] = []
    const gaps: string[] = []
    let cursor = 0
    REGION_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = REGION_RE.exec(normalized))) {
        gaps.push(normalized.slice(cursor, m.index))
        const [, id, p, x, y, w, rawText] = m
        blocks.push({
            id,
            page: parseInt(p, 10) - 1,
            x: parseInt(x, 10),
            y: parseInt(y, 10),
            w: parseInt(w, 10),
            text: unescapeEndMarker(rawText),
        })
        cursor = m.index + m[0].length
        REGION_RE.lastIndex = cursor
    }
    if (blocks.length === 0) return { rest: normalized, blocks }
    gaps.push(normalized.slice(cursor))

    const n = gaps.length
    const pieces = gaps
        .map((g, i) => {
            let s = g
            // Every gap but the first sits right after a region: strip the blank line
            // serializeScratch inserts there (any amount of leading blank-line padding, in case
            // the file was hand-edited with extra spacing).
            if (i > 0) s = s.replace(/^\n+/, '')
            // Every gap but the last sits right before a region: same, on the trailing side.
            if (i < n - 1) s = s.replace(/\n+$/, '')
            return s
        })
        .filter(s => s !== '')
    return { rest: pieces.join('\n\n'), blocks }
}

/** Serialize the hand-written text + blocks back into a companion note's body. Blank blocks
 *  (`text.trim() === ''`) are never written — a click-to-place block abandoned without typing
 *  anything leaves no trace. The remaining blocks are sorted by page, then y, then x, and appended
 *  after `rest`, separated by one blank line each (matching the plan's example format).
 *
 *  Stability: for arbitrary hand-typed `t`, `serializeScratch(parseScratch(t).rest,
 *  parseScratch(t).blocks)` need not equal `t` byte-for-byte (parseScratch normalizes the blank-
 *  line padding around regions). It IS a fixed point from its own output onward: serializing what
 *  you get back from parsing your own serialized output reproduces that output exactly, because
 *  the padding this function adds never depends on whether `rest` already carried a trailing
 *  newline (it normalizes either way) — see the parse/serialize round-trip tests. */
export function serializeScratch(rest: string, blocks: ScratchBlock[]): string {
    const real = blocks
        .filter(b => b.text.trim() !== '')
        .slice()
        .sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x)
    if (real.length === 0) return rest

    const head =
        rest === '' ? '' : rest.endsWith('\n') ? rest + '\n' : rest + '\n\n'
    const regions = real.map(b => {
        const text = escapeEndMarker(b.text)
        return `<!-- scratch id=${b.id} p=${b.page + 1} x=${b.x} y=${b.y} w=${b.w} -->\n${text}\n${END_MARKER}`
    })
    return head + regions.join('\n\n') + '\n'
}

const ID_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz'
const ID_LENGTH = 4

/** 4 lowercase base36 chars not in `taken`. `rand` injectable for tests (defaults to
 *  `Math.random`) — must return a value in `[0, 1)` per call, like `Math.random`. */
export function newScratchId(
    taken: Iterable<string>,
    rand: () => number = Math.random,
): string {
    const takenSet = taken instanceof Set ? taken : new Set(taken)
    let id: string
    do {
        id = ''
        for (let i = 0; i < ID_LENGTH; i++) {
            id += ID_CHARS[Math.floor(rand() * ID_CHARS.length)]
        }
    } while (takenSet.has(id))
    return id
}
