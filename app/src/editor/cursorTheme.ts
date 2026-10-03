// app/src/editor/cursorTheme.ts
// THE text cursor for every CodeMirror surface — note editor, chat composer, Bases fields, cells,
// card editors, the story harness. One 2px accent bar whose width, glide and blink come from the
// app-wide `appearance.cursor*` settings (via --cursor-width/--cursor-glide/--cursor-blink, which
// settingsCssVars.ts projects onto :root). The terminal's overlay draws the same bar from the same
// vars; ui/Caret's decorative `_` brand mark is deliberately a different shape but blinks on the
// same --cursor-blink.
//
// The blink: CodeMirror animates `.cm-cursorLayer` with its own `cm-blink` keyframes and writes
// `drawSelection({ cursorBlinkRate })` into an INLINE animation-duration, which a plain rule cannot
// beat — hence the `!important`, which is what lets a settings change retime every open editor
// live instead of only the ones created after it.
import { drawSelection, EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'

export const cursorTheme = EditorView.theme({
    // The native caret only shows where drawSelection is not drawing (IME composition, a11y
    // fallbacks); keep it the same colour as the drawn bar.
    '.cm-content': { caretColor: 'var(--accent)' },
    '.cm-cursor, .cm-dropCursor': {
        borderLeft: 'var(--cursor-width) solid var(--accent)',
        marginLeft: 'calc(var(--cursor-width) / -2)',
        transition:
            'left var(--cursor-glide) ease-out, top var(--cursor-glide) ease-out',
    },
    '.cm-cursorLayer': { animationDuration: 'var(--cursor-blink) !important' },
})

/** drawSelection + the shared cursor look. Use in place of a bare `drawSelection()`. */
export const cursor: Extension = [drawSelection(), cursorTheme]
