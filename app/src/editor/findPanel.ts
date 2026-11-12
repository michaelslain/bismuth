// app/src/editor/findPanel.ts
// In-editor "Find" bar (default Cmd/Ctrl+F). A custom CodeMirror search panel wired
// through @codemirror/search, so we get match highlighting + next/prev navigation for
// free while fully owning the bar's look (it matches the app, not CM's stock panel).
//
// Why a custom `createPanel` rather than a Solid overlay: @codemirror/search only
// highlights matches while a *panel* is registered as open — its highlighter returns
// `Decoration.none` when `state.panel` is null. Supplying `createPanel` keeps that
// highlighting alive and keeps the query/selection plumbing inside CodeMirror, while
// the DOM we build is ours to style. The keybinding itself is owned by Editor.tsx
// (reads settings.keybindings.find) so it's user-rebindable like every other shortcut.
//
// TABLES: a GFM table renders as an atomic block-replace widget that HIDES its source, so a
// match on a table line is invisible behind the widget. The find bar does NOT flip the table to
// raw markdown source (the rejected "cmd+f converts my table to source, which is stupid" behavior,
// #31); instead `tableFindHighlight` (editor/tableWidget.ts) marks matches IN PLACE inside the
// rendered table DOM and scrolls the active one into view. So this file carries ZERO table-reveal
// logic — find just moves the selection like anywhere else, and the widget highlighter reacts to it.

import { Decoration, EditorView, type Panel, type ViewUpdate } from '@codemirror/view'
import { StateEffect, StateField, type EditorState } from '@codemirror/state'
import {
    search,
    SearchQuery,
    setSearchQuery,
    getSearchQuery,
    findNext,
    findPrevious,
    closeSearchPanel,
    searchPanelOpen,
} from '@codemirror/search'
import { findCountLabel } from './findCountLabel'

export { findCountLabel }

// AI ANSWER (while `editor.findAsksAi` is on): a query with no literal match reads `no results ↵ ask`; Enter asks it as a question
// about the note through the editor's `onAsk` (Editor.tsx: POST /find-ai with `ask`). The answer opens
// UNDER the bar, as part of it (`.bismuth-find-answer`, the bar's width): `asking…`, then the answer.
// The passages it rests on come back in the same reply and show through `showAiPassages`: marked
// with the search-match look, the first one selected, the bar reading `ai 1/3`, and Enter /
// Shift+Enter / the chevrons stepping through them. Typing a new query or closing the bar drops the
// answer and the passages.

/** A passage the ai pointed at, as `[from, to)`. */
export type AiRange = { from: number; to: number }
/** Ask the ai `query` as a question about `text` (the note as the bar saw it): its answer and the
 *  passages of `text` the answer rests on, best first. Rejects with the reason it cannot answer. */
export type OnAsk = (query: string, text: string) => Promise<{ answer?: string; matches: AiRange[] }>

/** The index of the passage a step lands on, wrapping. Pure. */
export function stepAiIndex(index: number, total: number, dir: 1 | -1): number {
    return total === 0 ? 0 : (index + dir + total) % total
}

type AiPassages = { ranges: AiRange[]; current: number }
const NO_PASSAGES: AiPassages = { ranges: [], current: 0 }
const setAiPassages = StateEffect.define<AiPassages>()
const aiMatchMark = Decoration.mark({ class: 'cm-searchMatch' })
const aiCurrentMark = Decoration.mark({ class: 'cm-searchMatch cm-searchMatch-selected' })

/** The passages, in document order, mapped through edits; emptied when the find bar closes. */
const aiPassageField = StateField.define<AiPassages>({
    create: () => NO_PASSAGES,
    update(v, tr) {
        for (const e of tr.effects) if (e.is(setAiPassages)) return e.value
        if (searchPanelOpen(tr.startState) && !searchPanelOpen(tr.state)) return NO_PASSAGES
        if (!v.ranges.length || !tr.docChanged) return v
        const ranges = v.ranges
            .map(r => ({ from: tr.changes.mapPos(r.from, 1), to: tr.changes.mapPos(r.to, -1) }))
            .filter(r => r.from < r.to)
        return { ranges, current: Math.min(v.current, Math.max(0, ranges.length - 1)) }
    },
    provide: f =>
        EditorView.decorations.from(f, v =>
            Decoration.set(
                v.ranges.map((r, i) => (i === v.current ? aiCurrentMark : aiMatchMark).range(r.from, r.to)),
                true,
            ),
        ),
})

/** The passages shown, or null when none. */
export function aiPassages(state: EditorState): AiPassages | null {
    const v = state.field(aiPassageField, false)
    return v && v.ranges.length ? v : null
}

/** Mark `ranges` (any order) and select + reveal the one at `best` of the given order. Returns the
 *  selected range, or null when there is none to show. */
export function showAiPassages(view: EditorView, ranges: AiRange[], best = 0): AiRange | null {
    const len = view.state.doc.length
    const valid = ranges.filter(r => r.from < r.to && r.to <= len)
    const sorted = [...valid].sort((a, b) => a.from - b.from)
    const pick = valid[best] ?? valid[0]
    return selectPassage(view, sorted, pick ? sorted.indexOf(pick) : 0)
}

/** Step to the next (1) or previous (-1) passage shown. */
export function stepAiPassage(view: EditorView, dir: 1 | -1): AiRange | null {
    const v = aiPassages(view.state)
    return v ? selectPassage(view, v.ranges, stepAiIndex(v.current, v.ranges.length, dir)) : null
}

/** Drop the passages shown. */
export function clearAiPassages(view: EditorView): void {
    if (aiPassages(view.state)) view.dispatch({ effects: setAiPassages.of(NO_PASSAGES) })
}

function selectPassage(view: EditorView, ranges: AiRange[], current: number): AiRange | null {
    const r = ranges[current]
    view.dispatch({
        // centred, clear of the answer box that hangs under the find bar
        effects: [
            setAiPassages.of({ ranges, current }),
            ...(r ? [EditorView.scrollIntoView(r.from, { y: 'center' })] : []),
        ],
        ...(r ? { selection: { anchor: r.from, head: r.to } } : {}),
        userEvent: 'select.search',
    })
    return r ?? null
}

// Cap the count scan so a 1-char query in a huge doc can't stall the UI.
const MAX_COUNT = 10000

/** Total matches of `query` in the doc, and the 1-based index of the one currently
 *  selected (0 when the selection isn't sitting on a match). */
function matchStats(
    view: EditorView,
    query: SearchQuery,
): { total: number; current: number } {
    if (!query.valid) return { total: 0, current: 0 }
    const sel = view.state.selection.main
    const cursor = query.getCursor(view.state)
    let total = 0
    let current = 0
    for (let r = cursor.next(); !r.done; r = cursor.next()) {
        total++
        const m = r.value
        if (m && m.from === sel.from && m.to === sel.to) current = total
        if (total >= MAX_COUNT) break
    }
    return { total, current }
}

/** The match range at/after `pos` (wrapping to the doc start when nothing matches from `pos`
 *  onward), or null when the query is invalid/empty or the doc has no match at all. Pure over
 *  the state + query — this is the range the find bar selects + scrolls to on every keystroke,
 *  factored out of the DOM-coupled panel so the "Cmd+F selects the match" behavior is unit-tested.
 *  Searching from the match START (not its end) means refining the query keeps you on the current
 *  match instead of skipping past it. */
export function nextMatchFrom(
    state: EditorState,
    query: SearchQuery,
    pos: number,
): { from: number; to: number } | null {
    if (!query.valid) return null
    let cursor = query.getCursor(state, pos)
    let r = cursor.next()
    if (r.done) {
        cursor = query.getCursor(state, 0) // wrap to the start of the doc
        r = cursor.next()
    }
    return r.done ? null : { from: r.value.from, to: r.value.to }
}

// THIRD-PARTY-DOM EXEMPTION: this bar is a CodeMirror panel built with raw DOM, so it cannot
// compose the Solid button family (ui/IconButton, ui/CloseButton). It mirrors their look instead,
// one control at a time, in global.css's find section: prev/next are a bare `normal` IconButton,
// `Aa` is an `unselected`/`selected` toggle (`[Aa]` only when on, its bracket space reserved when
// off), close is CloseButton's `[x]`. The preview twin, preview/CodeFindBar.tsx, composes the real
// components. Inline icons: the registry renders Solid components, so we inline the same paths.
const ICONS = {
    prev: '<path d="m18 15-6-6-6 6"/>',
    next: '<path d="m6 9 6 6 6-6"/>',
}

function iconButton(svgPath: string, label: string): HTMLButtonElement {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'bismuth-find-btn'
    b.title = label
    b.setAttribute('aria-label', label)
    b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svgPath}</svg>`
    return b
}

/** Build the find bar for a view. Conforms to CodeMirror's `Panel` contract so
 *  openSearchPanel/closeSearchPanel manage its lifecycle. */
export function createFindPanel(view: EditorView, askFor?: () => OnAsk | undefined): Panel {
    const onAskNow = () => askFor?.()
    const dom = document.createElement('div')
    dom.className = 'bismuth-find'
    // Keys typed in the bar are the bar's business — don't let them bubble to the
    // editor's keymap or App.tsx's global shortcut handler.
    dom.addEventListener('keydown', e => e.stopPropagation())
    dom.addEventListener('mousedown', e => e.stopPropagation())

    const field = document.createElement('div')
    field.className = 'bismuth-find-field'

    const prompt = document.createElement('span')
    prompt.className = 'bismuth-find-prompt'
    prompt.setAttribute('aria-hidden', 'true')
    prompt.textContent = '/'

    const input = document.createElement('input')
    input.className = 'bismuth-find-input'
    input.placeholder = 'find'
    input.setAttribute('aria-label', 'Find in note')
    // NOTE: intentionally NOT tagged `main-field`. CM's findNext/findPrevious end by
    // calling selectSearchInput(), which select-all's the `main-field` element. Since we
    // run a search on every keystroke, that would make each new character replace the whole
    // query (the "one character at a time" bug). We manage focus ourselves (mount() +
    // Editor.tsx's onFindKey), so opting out of CM's field auto-management is what we want.

    field.append(prompt, input)

    const count = document.createElement('span')
    count.className = 'bismuth-find-count'

    const prevBtn = iconButton(ICONS.prev, 'Previous match (Shift+Enter)')
    const nextBtn = iconButton(ICONS.next, 'Next match (Enter)')

    // A toggle: `aria-pressed` is both its state for assistive tech and the CSS hook that paints
    // the `[` `]` (global.css `.bismuth-find-case`), so the two can never disagree.
    const caseBtn = document.createElement('button')
    caseBtn.type = 'button'
    caseBtn.className = 'bismuth-find-case'
    caseBtn.textContent = 'Aa'
    caseBtn.title = 'Match case'
    caseBtn.setAttribute('aria-label', 'Match case')
    const setCasePressed = (on: boolean) =>
        caseBtn.setAttribute('aria-pressed', on ? 'true' : 'false')

    // CloseButton's `[x]`: the letter in a label span (the hover underline draws under it alone),
    // the brackets generated around it.
    const closeBtn = document.createElement('button')
    closeBtn.type = 'button'
    closeBtn.className = 'bismuth-find-close'
    closeBtn.title = 'Close (Esc)'
    closeBtn.setAttribute('aria-label', 'Close (Esc)')
    const closeLabel = document.createElement('span')
    closeLabel.className = 'bismuth-find-close-label'
    closeLabel.textContent = 'x'
    closeBtn.append(closeLabel)

    // The answer, under the bar and part of it: hidden until a question is asked.
    const answer = document.createElement('div')
    answer.className = 'bismuth-find-answer'
    answer.setAttribute('aria-live', 'polite')
    answer.hidden = true

    dom.append(field, count, prevBtn, nextBtn, caseBtn, closeBtn, answer)

    let caseSensitive = getSearchQuery(view.state).caseSensitive
    setCasePressed(caseSensitive)

    // One question at a time: `asked` is the query the box is for (asking or answered), `ticket`
    // drops a reply that arrives after the query changed or the bar closed.
    let asked = ''
    let ticket = 0

    const updateCount = () => {
        const q = getSearchQuery(view.state)
        const ai = aiPassages(view.state)
        const literal = q.search && !ai ? matchStats(view, q) : { total: 0, current: 0 }
        const label = findCountLabel(
            ai ? { total: ai.ranges.length, current: ai.current + 1 } : null,
            { query: q.search, ...literal },
            !!onAskNow(),
            !!asked,
        )
        count.textContent = label.text
        count.classList.toggle('bismuth-find-empty', label.danger)
        if (label.hint) {
            // the key that asks, in the muted tone beside the red readout
            const hint = document.createElement('span')
            hint.className = 'bismuth-find-hint'
            hint.title = 'Press Enter to ask ai about this note'
            hint.textContent = label.hint
            count.append(' ', hint)
        }
    }

    const showAnswer = (text: string, tone: 'muted' | 'danger' | null) => {
        answer.hidden = false
        answer.textContent = text
        answer.dataset.tone = tone ?? ''
    }
    const clearAnswer = () => {
        ticket++
        asked = ''
        answer.hidden = true
        answer.textContent = ''
    }
    const ask = async (query: string) => {
        const onAsk = onAskNow()
        if (!onAsk || query === asked) return
        const mine = ++ticket
        asked = query
        const doc = view.state.doc
        showAnswer('asking…', 'muted')
        updateCount()
        try {
            const r = await onAsk(query, doc.toString())
            if (mine !== ticket) return
            const text = r.answer?.trim()
            if (text) showAnswer(text, null)
            else if (!r.matches.length) showAnswer('nothing in this note answers that', 'muted')
            else answer.hidden = true
            // ranges are into the text sent: an edit made while asking would shift them
            if (r.matches.length && view.state.doc === doc) showAiPassages(view, r.matches)
        } catch (e) {
            if (mine !== ticket) return
            showAnswer((e as Error).message || 'ai could not answer', 'danger')
        }
        updateCount()
    }

    // Enter, Shift+Enter and the chevrons: step the ai's passages while they show; ask when the
    // literal query matched nothing; otherwise CodeMirror's own next/previous match.
    const step = (dir: 1 | -1) => {
        if (aiPassages(view.state)) stepAiPassage(view, dir)
        else {
            const q = getSearchQuery(view.state)
            if (q.search.trim() && onAskNow() && matchStats(view, q).total === 0) return void ask(q.search.trim())
            ;(dir === 1 ? findNext : findPrevious)(view)
        }
        updateCount()
    }

    // Close the bar and return focus to the editor. Tables never need "un-revealing": the in-place
    // table highlighter (tableFindHighlight) clears its own marks the moment the panel closes (#31).
    const closeBar = () => {
        closeSearchPanel(view)
        view.focus()
    }

    // Move the editor selection to the nearest match at/after `pos` (wrapping to the top),
    // WITHOUT touching the input. We reveal matches ourselves on the typing path instead of
    // calling CM's findNext, because findNext select-all's the search field on every call —
    // which would clobber what the user is typing. Searching from the match START (not its
    // end) means refining the query keeps you on the current match instead of skipping it.
    // A match inside a table is highlighted in place by tableFindHighlight; scrolling the
    // selection into view brings the containing table widget into view too.
    const revealFrom = (pos: number) => {
        const m = nextMatchFrom(view.state, getSearchQuery(view.state), pos)
        if (!m) return // no match → leave the selection where it is
        view.dispatch({
            selection: { anchor: m.from, head: m.to },
            effects: EditorView.scrollIntoView(m.to, { y: 'center' }),
            userEvent: 'select.search',
        })
    }

    // Push the input's text as the active query (live highlight) and reveal the nearest match.
    const runQuery = () => {
        clearAnswer()
        clearAiPassages(view)
        const from = view.state.selection.main.from
        const q = new SearchQuery({
            search: input.value,
            caseSensitive,
            literal: true,
        })
        view.dispatch({ effects: setSearchQuery.of(q) })
        revealFrom(from)
        updateCount()
    }

    input.addEventListener('input', runQuery)
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault()
            step(e.shiftKey ? -1 : 1)
        } else if (e.key === 'Escape') {
            e.preventDefault()
            closeBar()
        }
    })
    prevBtn.addEventListener('click', () => {
        step(-1)
        input.focus()
    })
    nextBtn.addEventListener('click', () => {
        step(1)
        input.focus()
    })
    caseBtn.addEventListener('click', () => {
        caseSensitive = !caseSensitive
        setCasePressed(caseSensitive)
        runQuery()
        input.focus()
    })
    closeBtn.addEventListener('click', closeBar)

    return {
        dom,
        top: true,
        mount() {
            // openSearchPanel seeds the query from the selection (single-line, <100 chars);
            // reflect whatever's active so the input + count are correct on open.
            const q = getSearchQuery(view.state)
            if (q.search) input.value = q.search
            caseSensitive = q.caseSensitive
            setCasePressed(caseSensitive)
            updateCount()
            input.focus()
            input.select()
        },
        destroy() {
            ticket++ // a reply landing after the bar closed shows nowhere
        },
        update(u: ViewUpdate) {
            const queryChanged = u.transactions.some(t =>
                t.effects.some(ef => ef.is(setSearchQuery)),
            )
            const passagesChanged = u.startState.field(aiPassageField, false) !== u.state.field(aiPassageField, false)
            if (!u.docChanged && !u.selectionSet && !queryChanged && !passagesChanged) return
            updateCount()
        },
    }
}

/** The editor extension that enables in-editor find with our custom bar; `askFor` returns the
 *  asker while Enter on a query with no literal match may ask the ai about the note
 *  (`editor.findAsksAi`), read at each use so the setting applies to an open bar. */
export function findExtension(askFor?: () => OnAsk | undefined) {
    return [
        search({ top: true, literal: true, createPanel: view => createFindPanel(view, askFor) }),
        aiPassageField,
    ]
}
