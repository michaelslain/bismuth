// Fenced-code line tracking shared by the Obsidian import steps. Pure; no I/O.

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/

/** For each line, the info string of the fence it sits in (the opener line included), or null
 *  outside any fence. An unclosed fence runs to the end of the file. */
export function fenceInfoPerLine(lines: string[]): (string | null)[] {
    const out: (string | null)[] = []
    let open: string | null = null
    let info = ''
    for (const line of lines) {
        const m = FENCE.exec(line)
        if (open === null) {
            if (m && !(m[1][0] === '`' && m[2].includes('`'))) {
                open = m[1]
                info = m[2].trim()
                out.push(info)
            } else out.push(null)
            continue
        }
        out.push(info)
        if (m && m[1][0] === open[0] && m[1].length >= open.length && !m[2].trim()) open = null
    }
    return out
}

export type Fence = {
    info: string
    /** line index of the opening delimiter and of the closing one (or last line when unclosed) */
    startLine: number
    endLine: number
    body: string[]
    closed: boolean
}

/** Every top-level fence; a fence nested inside a longer one is part of the outer body. */
export function findFences(lines: string[]): Fence[] {
    const out: Fence[] = []
    let open: string | null = null
    let cur: Fence | null = null
    for (let i = 0; i < lines.length; i++) {
        const m = FENCE.exec(lines[i])
        if (open === null) {
            if (m && !(m[1][0] === '`' && m[2].includes('`'))) {
                open = m[1]
                cur = { info: m[2].trim(), startLine: i, endLine: i, body: [], closed: false }
            }
            continue
        }
        if (m && m[1][0] === open[0] && m[1].length >= open.length && !m[2].trim()) {
            cur!.endLine = i
            cur!.closed = true
            out.push(cur!)
            open = null
            cur = null
        } else cur!.body.push(lines[i])
    }
    if (cur) {
        cur.endLine = lines.length - 1
        out.push(cur)
    }
    return out
}
