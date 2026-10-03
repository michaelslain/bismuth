// app/src/intro/glyphScenes/begin.ts
// The begin hero: the wordmark already formed, with a typed `> open vault_` prompt under it.
import {
    clearFrame,
    putChar,
    type GlyphColor,
    type GlyphScene,
} from '../../ui/ascii/glyphScene'
import { drawNoiseField, drawWordmark } from './wordmark'
import { WORDMARK } from './wordmarkBitmap'

export const CARET_PERIOD_MS = 1100

const COLS = 96
const ROWS = 16
const REVEAL_MS = 700
const WORDMARK_TOP = 1
const PROMPT_ROW = 13
const PROMPT = '> open vault_'
const PROMPT_COL = Math.floor((COLS - PROMPT.length) / 2)
const WORDMARK_COL = Math.floor((COLS - WORDMARK[0].length) / 2)

const promptColor = (i: number): GlyphColor =>
    i === 0 || i === PROMPT.length - 1 ? 'accent' : 'fg'

export const beginScene: GlyphScene = {
    cols: COLS,
    rows: ROWS,
    revealMs: REVEAL_MS,
    frame(t, out) {
        clearFrame(out)
        // the prompt row stays clear of noise so the typed line reads cleanly
        drawNoiseField(out, t, WORDMARK_COL, WORDMARK_TOP, PROMPT_ROW)
        drawWordmark(
            out,
            WORDMARK_COL,
            WORDMARK_TOP,
            Math.max(0, t - REVEAL_MS),
            1,
        )

        const typing = t < REVEAL_MS
        const typed = typing
            ? Math.floor((PROMPT.length * t) / REVEAL_MS)
            : PROMPT.length
        const caretOn =
            typing ||
            Math.floor((t - REVEAL_MS) / (CARET_PERIOD_MS / 2)) % 2 === 0
        for (let i = 0; i < typed; i++) {
            if (i === PROMPT.length - 1 && !caretOn) continue
            putChar(out, PROMPT_COL + i, PROMPT_ROW, PROMPT[i], promptColor(i))
        }
    },
}
