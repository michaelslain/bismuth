// app/src/preview/highlightColor.ts
// The PDF highlighter's current colour, one for the whole window: picking green in one PDF keeps
// green for the next highlight in any PDF until another colour is picked. Session-only; a fresh
// window starts on yellow. The value is a `PDF_HIGHLIGHT_COLORS` entry's `c` (core/src/theme/
// tokens.ts), which is what `addHighlight` stores.
import { createSignal } from 'solid-js'
import { PDF_HIGHLIGHT_COLORS } from '../../../core/src/theme/tokens'

const [highlightColor, setHighlightColor] = createSignal(PDF_HIGHLIGHT_COLORS[0]!.c)

export { highlightColor, setHighlightColor }
