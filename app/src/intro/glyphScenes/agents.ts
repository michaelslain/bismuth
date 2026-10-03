// The agents slide's hero: six agent names whose typed lines converge on `[ mcp ]`, then down to
// `( vault )`, with coloured packets travelling the lines. Plain ASCII, pure (no DOM, no
// framework). Content replaces the boxed terminal in TermPanel's AGENT_LINES.
import {
    clearFrame,
    putChar,
    putText,
    type GlyphColor,
    type GlyphFrame,
    type GlyphScene,
} from '../../ui/ascii/glyphScene'

export const AGENTS: readonly string[] = [
    'claude',
    'codex',
    'gemini',
    'opencode',
    'cline',
    'goose',
]

const COLS = 96
const ROWS = 16
const REVEAL_MS = 1200
const NAME_ROW = 1
const LINE_TOP = 2
const LINE_BOTTOM = 9
const LINE_STEPS = LINE_BOTTOM - LINE_TOP
const MCP_ROW = 10
const MCP = '[ mcp ]'
const VAULT_ROW = 13
const VAULT = '( vault )'
const PACKET_STEP_MS = 120
const PACKET_PERIOD_MS = 2400
const PACKET_PHASE_MS = 400
/** Cells a packet visits: the converging lines (rows 2-9), then the stem (rows 11-12). */
const PACKET_ROWS = [2, 3, 4, 5, 6, 7, 8, 9, 11, 12]

const centred = (width: number) => Math.floor((COLS - width) / 2)
const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

const labels = AGENTS.map(a => `[${a}]`)
const NAMES_WIDTH =
    labels.reduce((w, l) => w + l.length, 0) + 2 * (AGENTS.length - 1)
const NAMES_LEFT = centred(NAMES_WIDTH)
const MCP_COL = centred(MCP.length) + Math.floor(MCP.length / 2)

/** Each agent label's start column, and the column its line leaves from. */
const starts: number[] = []
{
    let c = NAMES_LEFT
    for (const l of labels) {
        starts.push(c)
        c += l.length + 2
    }
}
const originCols = starts.map((s, i) => s + Math.floor(labels[i].length / 2))

/** Column of agent i's line at row r (LINE_TOP..LINE_BOTTOM). */
function lineCol(i: number, r: number): number {
    const x0 = originCols[i]
    return Math.round(x0 + ((MCP_COL - x0) * (r - LINE_TOP)) / LINE_STEPS)
}

/** ONE glyph per line, from its overall direction: `\` when it runs right (mcp is right of the
 *  agent), `/` when left, `|` when straight. Mixing glyphs row to row reads as jitter. */
function lineGlyph(i: number): string {
    const x0 = originCols[i]
    return MCP_COL > x0 ? '\\' : MCP_COL < x0 ? '/' : '|'
}

function drawNames(f: GlyphFrame, t: number): void {
    const shown = Math.floor(NAMES_WIDTH * clamp01(t / (REVEAL_MS * 0.5)))
    let k = 0
    for (let i = 0; i < labels.length; i++) {
        const l = labels[i]
        for (let j = 0; j < l.length; j++, k++) {
            if (k >= shown) return
            putChar(
                f,
                starts[i] + j,
                NAME_ROW,
                l[j],
                j === 0 || j === l.length - 1 ? 'faint' : 'muted',
            )
        }
        k += 2
    }
}

function drawLines(f: GlyphFrame, t: number): void {
    const rowsDrawn = Math.floor(
        (LINE_STEPS + 1) * clamp01((t - REVEAL_MS * 0.5) / (REVEAL_MS * 0.4)),
    )
    for (let r = LINE_TOP; r < LINE_TOP + rowsDrawn; r++)
        for (let i = 0; i < AGENTS.length; i++)
            putChar(f, lineCol(i, r), r, lineGlyph(i), 'faint')
}

function drawPackets(f: GlyphFrame, a: number): void {
    for (let i = 0; i < AGENTS.length; i++) {
        const local = a - i * PACKET_PHASE_MS
        if (local < 0) continue
        // The first beat of each period is the send; the packet shows from the second.
        const k = Math.floor((local % PACKET_PERIOD_MS) / PACKET_STEP_MS) - 1
        if (k < 0 || k >= PACKET_ROWS.length) continue
        const r = PACKET_ROWS[k]
        const col = r <= LINE_BOTTOM ? lineCol(i, r) : MCP_COL
        putChar(f, col, r, 'o', `graph${i % 5}` as GlyphColor)
    }
}

export const agentsScene: GlyphScene = {
    cols: COLS,
    rows: ROWS,
    revealMs: REVEAL_MS,
    frame(t, out) {
        clearFrame(out)
        drawNames(out, t)
        drawLines(out, t)
        if (t < REVEAL_MS) return
        putText(out, centred(MCP.length), MCP_ROW, MCP, 'accent')
        putChar(out, MCP_COL, MCP_ROW + 1, '|', 'faint')
        putChar(out, MCP_COL, MCP_ROW + 2, '|', 'faint')
        putText(out, centred(VAULT.length), VAULT_ROW, VAULT, 'fg')
        drawPackets(out, t - REVEAL_MS)
    },
}
