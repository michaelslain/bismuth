import {
    createSignal,
    getOwner,
    onCleanup,
    onMount,
    runWithOwner,
    Show,
} from 'solid-js'
import { EditorView, keymap } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import {
    defaultKeymap,
    history,
    historyKeymap,
    indentMore,
    indentLess,
} from '@codemirror/commands'
import { startCompletion, acceptCompletion } from '@codemirror/autocomplete'
import { markdown } from '@codemirror/lang-markdown'
import { syntaxHighlighting, indentUnit } from '@codemirror/language'
import { codeLanguages } from '../editor/codeLanguages'
import { taskCompletion } from '../editor/autocomplete'
import { api } from '../api'
import { onServerChange } from '../serverVersion'
import { readNoteCached, primeNoteCache, peekNoteCache } from '../noteCache'
import { livePreview } from '../editor/livePreview'
import { toggleBold, toggleItalic } from '../editor/markdownFormat'
import { settingsKeymapCompartment } from '../editor/settingsKeymap'
import { notePathFacet } from '../editor/tableState'
import { codeHighlightStyle } from '../editor/codeHighlight'
import { settings } from '../settings'
import { reorderTaskBlocks } from '../../../core/src/taskReorder'
import { splitCard, type CardMode } from './cardBodySplit'
import {
    cardDoneFold,
    cardTheme,
    ExternalReload,
    hideNonTaskLines,
    navigateOnLinkClick,
    tasksChecklistTheme,
} from '../editor/cardEditorExtensions'
import { Loading } from '../ui/EmptyState'
import styles from './CardEditor.module.css'
import { cursor } from '../editor/cursorTheme'

/**
 * A seamless, always-live inline editor for a card. A click places the cursor, a drag selects, and
 * checkboxes/links work via livePreview — it edits like normal markdown. The non-editable
 * surroundings are kept out of the editor (see splitCard): always the frontmatter + a duplicated
 * `# Title` heading, and in `mode: "tasks"` also the prose before/after the checklist, so a tasks
 * card stays a focused but fully-editable checklist. Edits autosave (`prefix + body + suffix`) with
 * the same echo-suppression Editor.tsx uses, reconciling external changes without clobbering edits.
 */
export function CardEditor(props: {
    path: string
    title?: string
    mode: CardMode
}) {
    let host!: HTMLDivElement
    let view: EditorView | undefined
    let prefix = '' // text before the editable region (frontmatter, title, in tasks mode pre-checklist prose)
    let suffix = '' // text after the editable region (tasks mode only: content past the checklist)
    let saveTimer: ReturnType<typeof setTimeout> | undefined
    let pendingSave = false // local edits not yet flushed — block external-reload revert
    let lastSavedFull: string | undefined // last full file text we wrote — recognizes our own SSE echo
    // Set once the component is torn down. Guards every post-await step (reconcile/mount) so an
    // in-flight read can't dispatch onto — or rebuild — a destroyed view.
    let disposed = false
    // "Loading…" until a successful read builds the view. Staying in this state on a read failure is
    // deliberate: an empty editor whose autosave fired would overwrite the note's frontmatter.
    const [loading, setLoading] = createSignal(true)

    // Captured HERE (synchronously, at component setup) because `buildView` below can run after an
    // await (onMount's cache-miss read, or reconcile()'s disk read) — by that point Solid's ambient
    // Owner has already reverted to whatever was current before that microtask, so a `createEffect`
    // registered from inside `buildView` needs to be pinned back to THIS component's owner
    // explicitly (see the `runWithOwner` call below) or it attaches unowned and is never disposed.
    const owner = getOwner()
    // Settings-driven: toggle-bold/toggle-italic (default Mod-B/Mod-I), open-completion (default
    // Ctrl-Space, Mod-Shift-Space fallback), accept-completion (default Tab) and indent/outdent
    // (default Tab/Shift-Tab) — core/src/keybindings.ts has the ids. A compartment (not
    // buildSettingsKeymap) because this view is long-lived and a rebind must reconfigure it live,
    // without rebuilding — `attach` is called once buildView constructs the view, below.
    const cardKeymap = settingsKeymapCompartment([
        { id: 'toggle-bold', run: toggleBold },
        { id: 'toggle-italic', run: toggleItalic },
        { id: 'open-completion', run: startCompletion },
        { id: 'accept-completion', run: acceptCompletion },
        { id: 'indent', run: indentMore },
        { id: 'outdent', run: indentLess },
    ])

    const save = async () => {
        if (!view) return
        const text = view.state.doc.toString()
        const full = prefix + text + suffix
        lastSavedFull = full // record BEFORE the await so a fast echo still matches
        try {
            await api.write(props.path, full)
            primeNoteCache(props.path, full) // keep the body cache warm for sibling cards / reopen
        } catch {
            return // write failed — leave pendingSave set so the next edit / flush retries
        }
        // Clear the pending flag only if nothing was typed during the write — otherwise a newer edit
        // is queued and reconcile must keep treating disk as stale (mirrors Editor.tsx).
        if (view && view.state.doc.toString() === text) pendingSave = false
    }

    // Build the live editor over the note's body once we have its content. Split off the prefix
    // (frontmatter + duplicate title) so only the editable body is shown.
    const tasksMode = props.mode === 'tasks'

    // In tasks mode the checklist body is shown with resolved (done/cancelled) tasks SUNK to the
    // bottom of each block — both for display AND on disk (so the note matches what the card
    // shows). `reorderTaskBlocks` is pure + idempotent, so re-running it on already-sorted content
    // is a no-op (no spurious save). Body mode is untouched.
    const sink = (body: string): string =>
        tasksMode ? reorderTaskBlocks(body) : body

    function buildView(raw: string) {
        if (disposed || view) return
        const split = splitCard(raw, props.title, props.mode)
        prefix = split.prefix
        suffix = split.suffix
        const initialBody = sink(split.body)
        // If sinking reorders the body, persist that order: record the full file we'll actually save
        // (not the unsorted disk text) and flush once the view is up so disk matches the card.
        const sorted = initialBody !== split.body
        lastSavedFull = sorted ? prefix + initialBody + suffix : raw

        const autosave = EditorView.updateListener.of(u => {
            if (!u.docChanged) return
            if (u.transactions.some(tr => tr.annotation(ExternalReload))) return
            pendingSave = true
            clearTimeout(saveTimer)
            saveTimer = setTimeout(
                () => void save(),
                settings.editor.autoSaveDelay,
            )
        })

        view = new EditorView({
            parent: host,
            state: EditorState.create({
                doc: initialBody,
                extensions: [
                    history(),
                    cursor,
                    // Match the note editor: a 4-space Tab so list nesting clears the `1. ` marker
                    // (ordered renumbering survives) and indents uniformly across bullets/numbers/text.
                    indentUnit.of('    '),
                    EditorState.tabSize.of(4),
                    // Settings-driven, same as the note editor: toggle-bold/toggle-italic, open-
                    // completion, accept-completion (falling through to indent when no popup is
                    // open) and indent/outdent — see cardKeymap above. The rest is the standard
                    // editing + history keymap.
                    cardKeymap.extension,
                    keymap.of([...defaultKeymap, ...historyKeymap]),
                    // remove IndentedCode so a 4-space-indented line stays prose, not a code block.
                    markdown({
                        codeLanguages,
                        extensions: [{ remove: ['IndentedCode'] }],
                    }),
                    syntaxHighlighting(codeHighlightStyle),
                    notePathFacet.of(props.path),
                    // The note editor's task-metadata autocomplete (due/scheduled/priority/recurrence
                    // signifiers + named weekday due dates), popup styling included — same extension, not a
                    // reimplementation. Its source only fires on `- [ ] …` lines, so it's inert in
                    // body-mode cards and active in tasks-mode cards.
                    taskCompletion(),
                    livePreview, // rendered-yet-editable markdown + checkbox toggle + right-click status menu
                    // Tasks card: show ONLY the checklist (hide interleaved headings/prose lines, which the
                    // split keeps in the doc for a lossless save), keep resolved tasks sunk to the bottom of
                    // their block, and collapse the trailing resolved run behind a "▾ N completed" toggle.
                    ...(tasksMode
                        ? [
                              hideNonTaskLines,
                              cardDoneFold(props.path),
                              tasksChecklistTheme,
                          ]
                        : []),
                    EditorView.lineWrapping,
                    cardTheme,
                    autosave,
                    // Click a link/wikilink → navigate (like the note editor); other clicks fall through so
                    // livePreview places the cursor or toggles a task.
                    EditorView.domEventHandlers({
                        mousedown: (e, v) =>
                            navigateOnLinkClick(e as MouseEvent, v),
                    }),
                ],
            }),
        })
        // See the `owner` comment above: this can run after an await, so the compartment's
        // createEffect must be pinned back to this component's owner explicitly.
        if (owner) runWithOwner(owner, () => cardKeymap.attach(view!))
        else cardKeymap.attach(view)
        setLoading(false)
        // Persist the sunk order so the note on disk matches the card. We didn't go through the
        // editor's autosave (no docChanged fired for the initial doc), so write directly.
        if (sorted) void save()
    }

    onMount(async () => {
        let raw = peekNoteCache(props.path)
        if (raw === undefined) {
            try {
                const r = readNoteCached(props.path)
                raw = typeof r === 'string' ? r : await r
            } catch {
                return // read failed — stay in "Loading…"; onServerChange retries via reconcile()
            }
        }
        if (disposed) return // unmounted while reading — don't build a detached, undestroyed view
        buildView(raw)
    })

    // Reconcile an external change to this note (edited in a pane, a daemon write, an external sync)
    // in place — without reverting in-flight edits or looping on our own save echo.
    const off = onServerChange(c => {
        if (c.paths.length === 0 || c.paths.includes(props.path))
            void reconcile()
    })
    onCleanup(off)

    async function reconcile() {
        if (disposed) return
        let onDisk: string
        try {
            onDisk = await api.read(props.path)
        } catch {
            return // file may have been deleted; tab cleanup handles that elsewhere
        }
        if (disposed) return // unmounted while reading — view is destroyed, do not dispatch
        primeNoteCache(props.path, onDisk)
        if (!view) {
            buildView(onDisk) // first successful read after a failed mount
            return
        }
        if (onDisk === lastSavedFull) return // our own write echoed back — no-op
        const split = splitCard(onDisk, props.title, props.mode)
        // Always refresh the (invisible) prefix/suffix from disk, even mid-edit: that text isn't shown
        // in the card, so an external change to it would otherwise be silently overwritten by our next
        // save (prefix + body + suffix). Refreshing here means that save merges in the new surroundings.
        prefix = split.prefix
        suffix = split.suffix
        if (pendingSave) return // disk body is stale vs our edits; our pending save will write it
        // Sink resolved tasks for the shown body (tasks mode) so an external task toggle re-sinks.
        const nextBody = sink(split.body)
        if (view.state.doc.toString() === nextBody) return
        // Full-document replace, preserving the caret/selection by character offset (clamped).
        const sel = view.state.selection.main
        const len = nextBody.length
        view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: nextBody },
            selection: {
                anchor: Math.min(sel.anchor, len),
                head: Math.min(sel.head, len),
            },
            annotations: ExternalReload.of(true),
        })
    }

    onCleanup(() => {
        disposed = true
        clearTimeout(saveTimer)
        if (pendingSave && view) void save() // flush a queued edit before teardown
        view?.destroy()
        view = undefined // so an in-flight reconcile's `if (!view)` guard short-circuits
    })

    return (
        <div class={styles.cardEditor}>
            <div ref={host} />
            <Show when={loading()}>
                <Loading />
            </Show>
        </div>
    )
}
