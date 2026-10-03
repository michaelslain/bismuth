// The daemon slide's hero: a prompt, three cron rows with a filling bar, and a scrolling activity
// log — all plain ASCII, written by time. Pure (no DOM, no framework); GlyphCanvas paints it.
// Content replaces the boxed terminal in TermPanel's DAEMON_LINES.
import {
    clearFrame,
    putChar,
    putText,
    type GlyphFrame,
    type GlyphScene,
} from '../../ui/ascii/glyphScene'

export const DAEMON_CRONS: readonly { expr: string; job: string }[] = [
    { expr: '*/15 * * * *', job: 'weave memory' },
    { expr: '0 * * * *', job: 're-link notes' },
    { expr: '0 9 * * *', job: 'morning digest' },
]

export const DAEMON_LOG: readonly { verb: string; result: string }[] = [
    { verb: 'fold memory', result: '4 nodes' },
    { verb: 're-link notes', result: '12 edges' },
    { verb: 'surface', result: '"last spring"' },
    { verb: 'weave memory', result: '+3 edges' },
    { verb: 'tag inbox', result: '5 notes' },
    { verb: 'fold memory', result: '2 nodes' },
    { verb: 'digest', result: 'morning.md' },
    { verb: 're-link notes', result: '7 edges' },
]

const COLS = 96
const ROWS = 16
const REVEAL_MS = 1200
const LEFT = 12
const PROMPT = '> bismuth daemon status'
// the widest bracketed expression: 14 cells, the every-15-minutes one
const EXPR_WIDTH = Math.max(...DAEMON_CRONS.map(cr => cr.expr.length)) + 2
const JOB_WIDTH = 14
const VERB_WIDTH = 16
const BAR_CELLS = 10
const LOG_TOP = 7
const LOG_LINES = 9
/** Bar 0 advances one cell per step; every wrap (11 steps) the log gains a line. */
const BAR_STEP_MS = 300
const BAR_WRAP_MS = BAR_STEP_MS * (BAR_CELLS + 1)
/** The other two crons hold still. */
const HELD_FILLS = [0, 4, 7] as const

/** `HH:MM` of log line n: 03:00 plus 15 minutes per line, wrapping at 24h. */
function logTime(n: number): string {
    const m = (180 + 15 * n) % 1440
    const hh = String(Math.floor(m / 60)).padStart(2, '0')
    const mm = String(m % 60).padStart(2, '0')
    return `${hh}:${mm}`
}

function drawPrompt(f: GlyphFrame, t: number): void {
    const shown = Math.floor(
        PROMPT.length * Math.min(1, Math.max(0, t / (REVEAL_MS * 0.4))),
    )
    for (let k = 0; k < shown; k++)
        putChar(f, LEFT + k, 1, PROMPT[k], k === 0 ? 'accent' : 'fg')
}

function drawCron(f: GlyphFrame, row: number, i: number, fill: number): void {
    const { expr, job } = DAEMON_CRONS[i]
    let c = LEFT
    putChar(f, c++, row, '[', 'faint')
    putText(f, c, row, expr, 'accent')
    c += expr.length
    putChar(f, c++, row, ']', 'faint')
    // Pad the bracketed expression to the widest one so job names and bars share columns.
    c = LEFT + EXPR_WIDTH + 2
    putText(f, c, row, job.padEnd(JOB_WIDTH), 'fg')
    c += JOB_WIDTH + 2
    putChar(f, c++, row, '[', 'faint')
    for (let b = 0; b < BAR_CELLS; b++)
        putChar(
            f,
            c++,
            row,
            b < fill ? '#' : '.',
            b < fill ? 'accent' : 'faint',
        )
    putChar(f, c, row, ']', 'faint')
}

function drawLogLine(f: GlyphFrame, row: number, n: number): void {
    const { verb, result } = DAEMON_LOG[n % DAEMON_LOG.length]
    let c = LEFT
    putText(f, c, row, logTime(n), 'faint')
    c += 5 + 2
    putText(f, c, row, verb.padEnd(VERB_WIDTH), 'fg')
    c += VERB_WIDTH + 2
    putText(f, c, row, '->', 'faint')
    c += 3
    putText(f, c, row, result, 'accent')
}

export const daemonScene: GlyphScene = {
    cols: COLS,
    rows: ROWS,
    revealMs: REVEAL_MS,
    frame(t, out) {
        clearFrame(out)
        drawPrompt(out, t)

        const a = Math.max(0, t - REVEAL_MS)
        const fills = [
            Math.floor(a / BAR_STEP_MS) % (BAR_CELLS + 1),
            HELD_FILLS[1],
            HELD_FILLS[2],
        ]
        for (let i = 0; i < DAEMON_CRONS.length; i++)
            if (t >= REVEAL_MS * (0.5 + 0.1 * i))
                drawCron(out, 3 + i, i, fills[i])

        // How many log lines exist: 3 from the reveal (80/90/100%), then one per bar wrap.
        let count = 0
        for (let k = 0; k < 3; k++)
            if (t >= REVEAL_MS * (0.8 + 0.1 * k)) count = k + 1
        if (t >= REVEAL_MS) count = 3 + Math.floor(a / BAR_WRAP_MS)
        // Lines fill down from the top slot, then scroll once the 9 slots are full.
        const first = Math.max(0, count - LOG_LINES)
        for (let n = first; n < count; n++)
            drawLogLine(out, LOG_TOP + (n - first), n)
    },
}
