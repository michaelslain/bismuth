// app/src/milkdown/milkdownEditor.ts
// The Milkdown bridge — the ONLY module (besides inlineNodes.ts) that imports `@milkdown/*`.
// Code-split behind a dynamic import() from MilkdownField.tsx (the sheet/univerSheet.ts pattern)
// so ProseMirror/Milkdown stays out of app boot.
//
// `createDocEditor` mounts a TRUE-WYSIWYG rich-text surface for a WHOLE markdown document (a
// kanban card's `description`, or any `markdown`-typed base property): it seeds from the plain
// markdown string, renders bold/italic/code/links/wikilinks/tags/math/embeds with NO markdown
// symbols shown, and serializes back to canonical markdown via getMarkdown(). See its own
// section below for the full contract.
//
// ANTI-CLOBBER: onChange routes the serialized markdown to the caller. setMarkdown is guarded by
// a value-equality check + an `applyingExternal` flag so an external/programmatic content set
// NEVER fires a spurious onChange (the feedback loop) and NEVER resets the caret while the user
// types (the el.value!==v guard's ProseMirror equivalent — we only replace the doc when the
// serialized markdown actually differs).

import {
    Editor,
    rootCtx,
    defaultValueCtx,
    editorViewCtx,
    parserCtx,
    serializerCtx,
    remarkStringifyOptionsCtx,
    prosePluginsCtx,
    editorViewOptionsCtx,
} from '@milkdown/core'
import { commonmark } from '@milkdown/preset-commonmark'
import { Plugin, PluginKey, TextSelection } from '@milkdown/prose/state'
import type { EditorView } from '@milkdown/prose/view'
import { inlineAtoms } from './inlineNodes'
import { preserveAffixWhitespace } from './preserveWhitespace'
import { markerAwareEmphasis, markerAwareStrong } from './emphasisMarker'

// A minimal `text`-node handler that writes plain text VERBATIM instead of letting
// mdast-util-to-markdown apply its (very conservative) punctuation escaping. The default
// serializer escapes `_`/`[`/`*`/`&` etc. defensively (`snake_case` → `snake\_case`,
// `array[0]` → `array\[0]`, a literal `*` → `\*`, `R&D` → `R\&D`) — which is technically
// valid markdown but DIVERGES byte-for-byte from what the CodeMirror Editor keeps (both store
// text verbatim). That divergence would rewrite the .md on the first visual edit and ping-pong
// the two surfaces. Since every Obsidian-flavoured construct that needs protection
// (`[[wikilink]]`, `#tag`, `$math$`, `![[embed]]`, bare URLs) is already pulled OUT into verbatim
// `html` atom nodes (inlineNodes.ts), a residual `text` node is genuinely literal prose —
// emitting it raw round-trips exactly. The marks (`**bold**`, `*italic*`, `` `code` ``,
// `[a](b)`) are emitted by their OWN handlers, not this one, so disabling text-escaping never
// touches them.
//
// ACCEPTED NORMALIZATION (documented, same class as `_`→`*` / `__`→`**`): a source backslash
// escape inside prose (`snake\_case`, a literal `\*`) is dropped on round-trip because the
// parser already consumed the backslash before we ever see the text node — the bare char is
// what re-parses, and a lone unpaired `*`/`_`/`[`/`&`/`]`/`(`/`)` in inline text re-parses as
// itself (no construct), so verbatim output is idempotent. HTML entities (`&amp;`) likewise
// decode to their character at parse time and can't be recovered (a doc-model limitation).
const verbatimText: (node: { value?: string }) => string = node =>
    node.value ?? ''

// Canonical remark-stringify options so this surface writes the SAME bytes the CodeMirror Editor
// writes — `-` bullets, `*` emphasis/strong, fenced code, `-` rules, verbatim text (no
// over-escaping), and `<url>` autolinks kept as autolinks. Verified against the project's
// canonical output by milkdownSerialize.test.ts.
const STRINGIFY_OPTIONS = {
    bullet: '-',
    emphasis: '*',
    strong: '*',
    fence: '`',
    fences: true,
    listItemIndent: 'one',
    rule: '-',
    ruleRepetition: 3,
    ruleSpaces: false,
    incrementListMarker: true,
    // FALSE so an explicit `<https://x>` autolink round-trips as `<https://x>` (the autolink form)
    // rather than being rewritten to `[https://x](https://x)`. A real `[text](url)` link still
    // serializes as a resource link because its text differs from its url (formatLinkAsAutolink
    // only collapses to `<url>` when the link's sole text child equals its url + has no title).
    resourceLink: false,
    // Override the `text` node handler with the verbatim emitter above (see its comment), and the
    // `emphasis`/`strong` handlers with marker-aware emitters so an authored `_x_`/`__x__` keeps its
    // underscore marker instead of being normalized to `*x*`/`**x**` (emphasisMarker.ts). The
    // `emphasis`/`strong` defaults below stay `*` as the fallback for marker-less (programmatically
    // built) nodes.
    handlers: {
        text: verbatimText,
        emphasis: markerAwareEmphasis,
        strong: markerAwareStrong,
    },
} as const

// ---------------------------------------------------------------------------------------
// createDocEditor — a WHOLE-DOCUMENT rich-text surface (multi-block: headings/lists/quotes
// as real blocks), for a standalone markdown STRING with no file coupling.
// ---------------------------------------------------------------------------------------
//
// This is the minimal reusable piece factored out so a kanban card's `description` (or any
// `markdown`-typed base property) edits in a true-WYSIWYG Milkdown surface — bold renders bold,
// lists/headings render as blocks, no markdown symbols shown — instead of a plain textarea
// (CardEditModal.tsx). It reuses the shared config (STRINGIFY_OPTIONS + preserveAffixWhitespace +
// commonmark + inlineAtoms) so it serializes byte-for-byte like the rest of the app. It injects NO
// structural keymap, so Enter/Backspace/Arrows behave as normal commonmark editing (paragraph
// splits, list continuation), and it serializes the ENTIRE document (all blocks), trimming
// trailing blank lines so a frontmatter-string value stays clean.

export interface DocEditorHandle {
    /** Current serialized markdown of the whole document (trailing blank lines trimmed). */
    getMarkdown: () => string
    /** Replace the document from external markdown; no-op (no onChange, no caret reset) when the
     *  serialized doc already equals `md`. */
    setMarkdown: (md: string) => void
    /** Focus the surface, placing the caret at the start or end (default end). */
    focus: (caret?: 'start' | 'end') => void
    /** Tear down the ProseMirror view + Milkdown editor. */
    destroy: () => void
}

export interface CreateDocEditorOptions {
    /** The mount node. */
    root: HTMLElement
    /** Initial markdown. */
    value: string
    /** Whether the user can type (default true). */
    editable?: boolean
    /** Spellcheck toggle (settings.editor.spellcheck). */
    spellcheck?: boolean
    /** Fired after every USER edit with the whole document's serialized markdown (never on a
     *  programmatic setMarkdown). The host keeps this as its draft + persists it however it likes. */
    onChange: (markdown: string) => void
    /** Fired when the editable loses focus — the host commits the draft here (like a textarea blur). */
    onBlur?: () => void
}

/** Create a full-document Milkdown WYSIWYG surface bound to a plain markdown string. Async
 *  because Editor.create() is async; MilkdownField awaits it inside onMount. */
export async function createDocEditor(
    opts: CreateDocEditorOptions,
): Promise<DocEditorHandle> {
    let applyingExternal = false
    let lastEmitted = normalizeTrailing(opts.value)
    let view: EditorView | null = null

    const serialize = (): string => {
        if (!view) return lastEmitted
        const md = editor.action(ctx => ctx.get(serializerCtx)(view!.state.doc))
        return normalizeTrailing(md)
    }

    const onChangePlugin = new Plugin({
        key: new PluginKey('bismuth-doc-onchange'),
        view: () => ({
            update: (v, prevState) => {
                if (applyingExternal) return
                if (v.state.doc.eq(prevState.doc)) return // selection-only move → nothing to emit
                const md = serialize()
                if (md !== lastEmitted) {
                    lastEmitted = md
                    opts.onChange(md)
                }
            },
        }),
    })

    const editor = await Editor.make()
        .config(ctx => {
            ctx.set(rootCtx, opts.root)
            ctx.set(defaultValueCtx, opts.value)
            ctx.set(
                remarkStringifyOptionsCtx,
                STRINGIFY_OPTIONS as unknown as Record<string, unknown>,
            )
            // Only the onChange plugin — NO structural keymap, so Enter/lists/headings edit normally.
            ctx.update(prosePluginsCtx, prev => [onChangePlugin, ...prev])
            ctx.update(editorViewOptionsCtx, prev => ({
                ...prev,
                editable: () => opts.editable !== false,
                attributes: {
                    class: 'bismuth-doc-milkdown',
                    spellcheck: opts.spellcheck ? 'true' : 'false',
                },
                handleDOMEvents: {
                    blur: () => {
                        opts.onBlur?.()
                        return false // don't swallow — let ProseMirror handle its own blur
                    },
                },
            }))
        })
        .use(preserveAffixWhitespace)
        .use(commonmark)
        .use(inlineAtoms)
        .create()

    view = editor.ctx.get(editorViewCtx)

    return {
        getMarkdown: serialize,

        setMarkdown: (md: string) => {
            if (!view) return
            const want = normalizeTrailing(md)
            if (serialize() === want) {
                lastEmitted = want
                return
            }
            applyingExternal = true
            try {
                editor.action(ctx => {
                    const v = ctx.get(editorViewCtx)
                    const parser = ctx.get(parserCtx)
                    const doc = parser(md)
                    if (!doc) return
                    const tr = v.state.tr.replaceWith(
                        0,
                        v.state.doc.content.size,
                        doc.content,
                    )
                    tr.setMeta('addToHistory', false)
                    v.dispatch(tr)
                })
                lastEmitted = want
            } finally {
                applyingExternal = false
            }
        },

        focus: (caret?: 'start' | 'end') => {
            if (!view) return
            const v = view
            v.focus()
            placeCaret(v, caret === 'start' ? 0 : v.state.doc.content.size)
        },

        destroy: () => {
            view = null
            void editor.destroy()
        },
    }
}

/** Trim trailing blank lines from serialized markdown (the serializer always appends a
 *  trailing "\n"; a multi-paragraph doc can accrue several) so a stored frontmatter-string
 *  value stays clean. */
function normalizeTrailing(md: string): string {
    return md.replace(/\n+$/, '')
}

// ---------------------------------------------------------------------------------------
// Caret helper (ProseMirror equivalent of textarea selection placement)
// ---------------------------------------------------------------------------------------

function placeCaret(v: EditorView, pos: number): void {
    try {
        const clamped = Math.min(Math.max(0, pos), v.state.doc.content.size)
        const tr = v.state.tr.setSelection(textSelectionNear(v, clamped))
        v.dispatch(tr)
    } catch {
        /* selection not applicable (empty doc) */
    }
}

function textSelectionNear(v: EditorView, pos: number) {
    // TextSelection.near clamps `pos` to the nearest valid text position.
    return TextSelection.near(v.state.doc.resolve(pos))
}
