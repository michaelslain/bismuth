// app/src/editor/noteProseTheme.ts
// How note markdown READS in any CodeMirror view: the prose face, size, ink and row the note editor
// sets, shared with every read-only note view (a chat message, ui/NoteProse) so the two cannot
// drift. Plus `fitContentTheme`, for a view that sizes to its text inside a host's own scroller.
import { EditorView } from '@codemirror/view'
import { Prec } from '@codemirror/state'

export const noteProseTheme = EditorView.theme({
    '&': {
        color: 'color-mix(in srgb, var(--fg) 88%, var(--text-muted))',
    },
    '.cm-scroller': {
        // --prose-font (the prose face), NOT --ui-font-stack. This is the ANSWERED monospace-scope
        // decision from the visual-unification wave (global.css's `styles/tokens.css` section §9.1): mono stays the
        // default for all chrome, labels, tables, code, terminal and graph; the ONE proportional
        // face is scoped to note prose and chat message bodies. The token existed and was loaded
        // but nothing ever read it — the wave that decided it deferred the wiring, so prose kept
        // rendering in Monaspace.
        // Everything that is NOT prose is pulled back to --ui-font-stack in global.css's CodeMirror theming section (headings,
        // code blocks and inline code, tables, frontmatter, math). Editor.tsx's codeFontTheme
        // overrides this whole scroller for config buffers, and its comment has always called
        // this declaration "editorTheme's prose font" — this makes that true.
        fontFamily: 'var(--prose-font)',
        // --prose-font-size, not --editor-font-size: the serif needs ~15% more nominal px to read
        // at the same optical size as the mono it replaced (global.css's `styles/tokens.css` section --prose-scale carries
        // the measurement). The mono exclusions in global.css's CodeMirror theming section reset BOTH family and size, so a code
        // fence or a heading is unaffected by this.
        fontSize: 'var(--prose-font-size)',
        lineHeight: 'var(--prose-row)',
    },
})

// `fitContent`: the editor takes the document's height and lets the host's scroller carry it, so
// whatever the host puts after the editor scrolls with the text. The content's top padding and
// bottom scroll space go (the host spaces what sits around it), and the content box moves left by CodeMirror's line inset (its
// base theme's `.cm-line` padding-left, 6px) so a plain line's first glyph sits on the note
// column's edge, where the host's own text starts (`left`, not a margin; see below); list lines keep their inline indents relative
// to it. Highest precedence so it wins over editorTheme's `height: 100%` / `overflow: auto` /
// content padding.
const CM_LINE_INSET_PX = 6
export const fitContentTheme = Prec.highest(
    EditorView.theme({
        '&': { height: 'auto' },
        '.cm-scroller': { overflow: 'visible' },
        // `left`, not a negative margin: the scroller centres the content box, and a margin only
        // moves a centred box by half its size.
        '.cm-content': {
            paddingTop: '0',
            paddingBottom: '0',
            position: 'relative',
            left: `-${CM_LINE_INSET_PX}px`,
        },
    }),
)
