// Cut one section or one block out of a note's markdown, the way an Obsidian embed does:
// `![[Note#Heading]]` shows that heading and everything under it, `![[Note#^id]]` the one
// paragraph, list item or block marked `^id`. Pure: no I/O, no framework imports.

const FENCE_RE = /^\s*(```|~~~)/
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/
const LIST_ITEM_RE = /^(\s*)(?:[-*+]|\d+[.)])\s/
/** A block id at the end of a line: after a space (` ^id`), straight after an embed or link
 *  (`![[image.png]]^id`), or alone on its own line (`^id`). */
const BLOCK_ID_TAIL = /(?:^|(?<=[\s\])]))\^([A-Za-z0-9-]+)\s*$/

function normalize(s: string): string {
    return s.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Per line: true when it is inside a fenced code block (fence lines included). */
function fenceMask(lines: string[]): boolean[] {
    const mask: boolean[] = []
    let open = false
    for (const line of lines) {
        if (FENCE_RE.test(line)) {
            mask.push(true)
            open = !open
            continue
        }
        mask.push(open)
    }
    return mask
}

function indentOf(line: string): number {
    return /^\s*/.exec(line)![0].replace(/\t/g, '    ').length
}

/** `heading` may be a path, `Parent#Child`: each step is looked for inside the section before. */
function headingSection(lines: string[], code: boolean[], heading: string): string[] | null {
    const [first, ...rest] = heading.split('#').filter(h => h.trim())
    if (!first) return null
    let part = headingSectionOne(lines, code, first)
    for (const step of rest) {
        if (!part) return null
        // `part` starts at its heading line, so search below it.
        const sub = headingSectionOne(part.lines.slice(1), part.code.slice(1), step)
        part = sub
    }
    return part ? part.lines : null
}

function headingSectionOne(
    lines: string[],
    code: boolean[],
    heading: string,
): { lines: string[]; code: boolean[] } | null {
    const want = normalize(heading)
    for (let i = 0; i < lines.length; i++) {
        if (code[i]) continue
        const h = HEADING_RE.exec(lines[i])
        if (!h || normalize(h[2]) !== want) continue
        const level = h[1].length
        let end = i + 1
        for (; end < lines.length; end++) {
            if (code[end]) continue
            const next = HEADING_RE.exec(lines[end])
            if (next && next[1].length <= level) break
        }
        return { lines: lines.slice(i, end), code: code.slice(i, end) }
    }
    return null
}

/** The 0-based line range `[from, to)` of the block marked `^id`, or null. */
function blockRange(lines: string[], code: boolean[], id: string): { from: number; to: number } | null {
    for (let i = 0; i < lines.length; i++) {
        if (code[i]) continue
        const m = BLOCK_ID_TAIL.exec(lines[i])
        if (!m || m[1] !== id) continue
        // `^id` alone on its line names the block just above it (a table, a quote, a list).
        if (lines[i].trim() === `^${id}`) {
            let start = i
            while (start > 0 && lines[start - 1].trim() !== '') start--
            return start === i ? null : { from: start, to: i }
        }
        const item = LIST_ITEM_RE.exec(lines[i])
        if (item) {
            // A list item: the item and the lines nested under it.
            const indent = indentOf(lines[i])
            let end = i + 1
            while (end < lines.length && lines[end].trim() !== '' && indentOf(lines[end]) > indent) end++
            return { from: i, to: end }
        }
        // A paragraph: back up to the blank line, heading or list item before it.
        let start = i
        while (
            start > 0 &&
            lines[start - 1].trim() !== '' &&
            !HEADING_RE.test(lines[start - 1]) &&
            !LIST_ITEM_RE.test(lines[start - 1])
        )
            start--
        return { from: start, to: i + 1 }
    }
    return null
}

/** Where the block marked `^id` sits in `lines` (a whole note, frontmatter included is fine):
 *  its 0-based line range `[from, to)`, or null. A `[[Note#^id]]` link opens the note there. */
export function findBlockLines(lines: string[], id: string): { from: number; to: number } | null {
    return blockRange(lines, fenceMask(lines), id.replace(/^\^/, ''))
}

/** Drop block ids from markdown: a trailing ` ^id` on a line, and a line that is only `^id`.
 *  Code blocks are left alone. An id marks a block for links; it is never shown. */
export function stripBlockIds(md: string): string {
    if (md.indexOf('^') === -1) return md
    const lines = md.split('\n')
    const code = fenceMask(lines)
    const out: string[] = []
    lines.forEach((line, i) => {
        if (code[i] || !BLOCK_ID_TAIL.test(line)) return out.push(line)
        if (/^\s*\^[A-Za-z0-9-]+\s*$/.test(line)) return
        out.push(line.replace(BLOCK_ID_TAIL, '').trimEnd())
    })
    return out.join('\n')
}

/** The part of a note body (frontmatter already removed) that `anchor` names: a heading's
 *  section (the heading line through the line before the next heading of the same or a higher
 *  level), or for `^id` the block marked with it. Block ids are stripped from the result. Null
 *  when nothing in the body matches. */
export function noteSection(body: string, anchor: string): string | null {
    const lines = body.split('\n')
    const code = fenceMask(lines)
    const a = anchor.trim()
    let part: string[] | null
    if (a.startsWith('^')) {
        const r = blockRange(lines, code, a.slice(1))
        part = r ? lines.slice(r.from, r.to) : null
    } else part = headingSection(lines, code, a)
    return part ? stripBlockIds(part.join('\n')).trim() : null
}
