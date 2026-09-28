// The CodeMirror half of CardEditor (bases/CardEditor.tsx): the theme, the tasks-mode checklist
// filter, the "▾ N completed" fold and the link-click handler. Plain CodeMirror — no Solid — so this
// is the plain-DOM-library side of the seam and CardEditor.tsx is left with lifecycle, autosave and
// reconcile. Its classes (`bismuth-card-*`) are global by necessity: CodeMirror builds its own DOM.
import {
    EditorView,
    Decoration,
    WidgetType,
    ViewPlugin,
} from '@codemirror/view'
import type { DecorationSet, ViewUpdate } from '@codemirror/view'
import {
    EditorState,
    StateField,
    StateEffect,
    Facet,
    Annotation,
} from '@codemirror/state'
import { TASK_LINE } from '../bases/taskLine'
import { findBareUrls } from './urls'
import { openExternalUrl } from '../appWindow'

// A disk-pulled reload is annotated so the autosave listener skips it — otherwise reloading an
// external change would write the file back to itself, looping against any external writer.
export const ExternalReload = Annotation.define<boolean>()

// Card-editor theme: transparent, gutterless, auto-height, prose font (`--prose-font`/
// `--prose-font-size`, like Editor.tsx) — so the editable card reads like the note editor's
// live-preview rather than a boxed code editor. Selection/caret tint mirror Editor.tsx so
// drag-highlighting looks identical to the main editor.
export const cardTheme = EditorView.theme({
    '&': { backgroundColor: 'transparent', color: 'var(--fg)' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
        // fontFamily/fontSize are shadowed here — BaseView.module.css's `.cardEditor
        // :global(.cm-scroller)` rule always wins the cascade, since this host is always
        // rendered inside `.cardEditor`. Kept for correctness; harmless to leave.
        fontFamily: 'var(--prose-font)',
        fontSize: 'var(--prose-font-size)',
        lineHeight: '1.55',
        overflow: 'visible',
    },
    '.cm-content': { padding: '0', caretColor: 'var(--fg)' },
    '.cm-line': { padding: '0' },
    // Smooth-glide caret — same 70ms ease as Editor.tsx so the card preview animates the
    // cursor between positions instead of jumping.
    '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: 'var(--fg)',
        borderLeftWidth: '2px',
        transition: 'left 70ms ease-out, top 70ms ease-out',
    },
    '.cm-selectionBackground, .cm-content ::selection': {
        backgroundColor: 'var(--selection)',
    },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground':
        {
            backgroundColor:
                'var(--selection)',
        },
})

function lineIndentWidth(text: string): number {
    const m = /^[ \t]*/.exec(text)
    return m ? m[0].length : 0
}

// In a tasks card the editable region runs first-task → last-task, so it can include
// interleaved `## headings`, blank lines, and standalone prose between task blocks. We keep
// those lines in the document (so prefix+body+suffix stays the exact note — lossless save) but
// HIDE them so the card shows ONLY the checklist, matching the old read-only rendering. A line
// is shown when it's a task line OR an indented continuation/sub-line of the preceding task
// (deeper-indented, non-blank); every other line is collapsed to display:none.
//
// We never hide the line the caret is on, so the user can still click into / type a heading or
// add prose between tasks without it vanishing mid-edit.
//
// We mark whole hidden lines with a CSS class (a line decoration) rather than block-replacing
// them — a block-replace would also swallow the surrounding line breaks and confuse the caret,
// so we keep each line in the layout but collapse it to zero height with `display:none`.
const hideNonTaskTheme = EditorView.theme({
    '.cm-line.bismuth-card-hidden': { display: 'none' },
})

// Tasks-mode-only checklist register: compact mono lines. The `[ ]` / `[x]` / `[/]` / `[-]`
// bracket marker itself and its hanging geometry come from livePreview's own theme
// (editor/livePreview.ts, `.cm-task-checkbox` / `.cm-checkbox` / `.cm-task`) — all in em, so they
// scale down to this editor's --fs-micro unchanged and the marker's left edge stays flush with the
// card title. Scoped to THIS editor instance via EditorView.theme (applied only when tasksMode is
// true, next to hideNonTaskTheme below).
export const tasksChecklistTheme = EditorView.theme({
    '.cm-line': {
        fontFamily: 'var(--ui-font-stack)',
        fontSize: 'var(--fs-micro)',
        lineHeight: '1.45',
    },
})

// `focused` gates the caret-line exception: only protect the line the caret sits on while the
// editor is FOCUSED (so editing a heading/prose doesn't make it vanish mid-edit). An UNFOCUSED
// card editor parks its caret at offset 0 — which is usually the first heading — so without this
// gate that leading `## heading` would flash visible until the next re-render. Mirrors the
// focus gate in editor/livePreview.ts.
function hiddenLineDecorations(
    state: EditorState,
    focused: boolean,
): DecorationSet {
    const doc = state.doc
    const head = state.selection.main.head
    const ranges: { from: number; deco: Decoration }[] = []
    let prevTaskIndent = -1
    for (let i = 1; i <= doc.lines; i++) {
        const line = doc.line(i)
        const text = line.text
        const isTask = TASK_LINE.test(text)
        const indent = lineIndentWidth(text)
        const isContinuation =
            prevTaskIndent >= 0 && text.trim() !== '' && indent > prevTaskIndent
        if (isTask) prevTaskIndent = indent
        else if (!isContinuation) prevTaskIndent = -1
        const show = isTask || isContinuation
        const caretHere = focused && head >= line.from && head <= line.to
        if (!show && !caretHere)
            ranges.push({ from: line.from, deco: hiddenLineClass })
    }
    return Decoration.set(ranges.map(r => r.deco.range(r.from, r.from)))
}
const hiddenLineClass = Decoration.line({ class: 'bismuth-card-hidden' })
// A ViewPlugin (not decorations.compute) so we can read view.hasFocus + recompute on focus change.
export const hideNonTaskLines = [
    ViewPlugin.fromClass(
        class {
            decorations: DecorationSet
            constructor(view: EditorView) {
                this.decorations = hiddenLineDecorations(
                    view.state,
                    view.hasFocus,
                )
            }
            update(u: ViewUpdate) {
                if (u.docChanged || u.selectionSet || u.focusChanged) {
                    this.decorations = hiddenLineDecorations(
                        u.view.state,
                        u.view.hasFocus,
                    )
                }
            }
        },
        { decorations: v => v.decorations },
    ),
    hideNonTaskTheme,
]

// --- "▾ N completed" collapse, per note path ------------------------------------------------
//
// In tasks mode resolved (done/cancelled) tasks are sunk to the bottom of each block; we hide
// that trailing run behind a clickable "▾ N completed" toggle, COLLAPSED BY DEFAULT (matching
// the old read-only BodyCard's `doneExpanded` Google-Keep section). The expanded/collapsed state
// is kept at module scope keyed by note path so it survives a card re-mount (BaseView re-resolving
// rows recreates the cards) — otherwise the section would silently re-collapse on every revalidate.
const doneExpanded = new Map<string, boolean>() // path -> expanded (absent = collapsed default)
const cardPathFacet = Facet.define<string, string>({ combine: v => v[0] ?? '' })

function isResolvedChar(c: string): boolean {
    return c === 'x' || c === 'X' || c === '-'
}
function taskStatusChar(text: string): string | null {
    const m = /^[ \t]*- \[(.)\] /.exec(text)
    return m ? m[1] : null
}

// The trailing run of resolved tasks across the whole checklist (resolved tasks are sunk to the
// bottom, so a single trailing run covers them). Returns the doc position where the run begins,
// the doc end, and the resolved-item count — or null when there's no foldable run (nothing
// resolved, or everything is resolved so there's no list context to keep open).
function resolvedRun(
    state: EditorState,
): { anchorPos: number; endPos: number; count: number } | null {
    const doc = state.doc
    // Walk task items (a task line + its deeper-indented continuation lines), tracking the start
    // line of each. Non-task, non-continuation lines just separate blocks but don't break the
    // "trailing resolved" accounting since resolved tasks are sunk to the very bottom.
    const items: { resolved: boolean; startLine: number }[] = []
    let prevTaskIndent = -1
    for (let i = 1; i <= doc.lines; i++) {
        const text = doc.line(i).text
        const status = taskStatusChar(text)
        const indent = lineIndentWidth(text)
        if (
            status !== null &&
            !(prevTaskIndent >= 0 && indent > prevTaskIndent)
        ) {
            items.push({ resolved: isResolvedChar(status), startLine: i })
            prevTaskIndent = indent
        } else if (
            prevTaskIndent >= 0 &&
            text.trim() !== '' &&
            indent > prevTaskIndent
        ) {
            // continuation/sub-line of the current item
        } else if (status === null) {
            prevTaskIndent = -1
        }
    }
    let trailing = 0
    for (let k = items.length - 1; k >= 0; k--) {
        if (items[k].resolved) trailing++
        else break
    }
    if (trailing === 0 || trailing === items.length) return null
    const anchorLine = items[items.length - trailing].startLine
    return {
        anchorPos: doc.line(anchorLine).from,
        endPos: doc.length,
        count: trailing,
    }
}

const toggleDoneFold = StateEffect.define<void>()

// Expanded flag for THIS editor, seeded (collapsed by default) from the per-path map and written
// back through it on every toggle so it persists across re-mounts.
const doneFoldExpanded = StateField.define<boolean>({
    create(state) {
        return doneExpanded.get(state.facet(cardPathFacet)) ?? false
    },
    update(value, tr) {
        let next = value
        for (const e of tr.effects) if (e.is(toggleDoneFold)) next = !next
        if (next !== value)
            doneExpanded.set(tr.state.facet(cardPathFacet), next)
        return next
    },
})

class DoneFoldWidget extends WidgetType {
    constructor(
        readonly count: number,
        readonly expanded: boolean,
    ) {
        super()
    }
    eq(o: DoneFoldWidget): boolean {
        return o.count === this.count && o.expanded === this.expanded
    }
    toDOM(view: EditorView): HTMLElement {
        const el = document.createElement('button')
        el.className = 'bismuth-card-done-toggle'
        el.textContent = `${this.expanded ? '▾' : '▸'} ${this.count} completed`
        el.addEventListener('mousedown', e => {
            e.preventDefault() // don't move the caret into the (possibly hidden) run first
            view.dispatch({ effects: toggleDoneFold.of() })
        })
        return el
    }
    ignoreEvent(): boolean {
        return false
    }
}

function doneFoldDecorations(state: EditorState): DecorationSet {
    const run = resolvedRun(state)
    if (!run) return Decoration.none
    const expanded = state.field(doneFoldExpanded)
    const head = state.selection.main.head
    const caretInside = head >= run.anchorPos && head <= run.endPos
    // Toggle widget sits just before the resolved run.
    const ranges = [
        Decoration.widget({
            block: true,
            side: -1,
            widget: new DoneFoldWidget(run.count, expanded || caretInside),
        }).range(run.anchorPos),
    ]
    // Collapsed (and caret not inside it) → replace the run with nothing so it's hidden.
    if (!expanded && !caretInside) {
        ranges.push(
            Decoration.replace({ block: true }).range(
                run.anchorPos,
                run.endPos,
            ),
        )
    }
    return Decoration.set(ranges, true)
}

const doneFoldTheme = EditorView.theme({
    '.bismuth-card-done-toggle': {
        display: 'inline-flex',
        alignItems: 'center',
        marginTop: '6px',
        padding: '4px 0',
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        fontFamily: 'var(--ui-font-stack)',
        fontSize: 'var(--fs-micro)',
        color: 'var(--text-muted)',
    },
    '.bismuth-card-done-toggle:hover': { color: 'var(--fg)' },
})

export function cardDoneFold(path: string) {
    return [
        cardPathFacet.of(path),
        doneFoldExpanded,
        EditorView.decorations.compute(
            ['doc', 'selection', doneFoldExpanded],
            doneFoldDecorations,
        ),
        doneFoldTheme,
    ]
}

// Click a wikilink / markdown-link / bare URL inside the card editor → navigate, matching the
// note editor. Returns false for any other click so livePreview can place the cursor / toggle a
// task. Mirrors Editor.tsx's mousedown link handling (filename-based wikilink open).
export function navigateOnLinkClick(e: MouseEvent, view: EditorView): boolean {
    if (e.button !== 0) return false
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }, false)
    if (pos == null) return false
    const line = view.state.doc.lineAt(pos)
    // `(?<!!)` skips embeds (`![[...]]`) — those are media, not links.
    for (const m of line.text.matchAll(/(?<!!)\[\[([^\]]+?)\]\]/g)) {
        const s = line.from + (m.index ?? 0)
        if (pos >= s && pos <= s + m[0].length) {
            const target = m[1].split('|')[0].split('#')[0].trim()
            window.dispatchEvent(
                new CustomEvent('bismuth-open', {
                    detail: target.endsWith('.md') ? target : `${target}.md`,
                }),
            )
            return true
        }
    }
    for (const m of line.text.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
        const s = line.from + (m.index ?? 0)
        if (pos >= s && pos <= s + m[0].length) {
            void openExternalUrl(m[2])
            return true
        }
    }
    for (const { start, end, url } of findBareUrls(line.text)) {
        if (pos >= line.from + start && pos <= line.from + end) {
            void openExternalUrl(url)
            return true
        }
    }
    return false
}
