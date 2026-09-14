import { createResource, Show, Switch, Match } from 'solid-js'
import { readNoteCached, peekNoteCache } from './noteCache'
import { parseFrontmatter } from '../../core/src/frontmatter'
import { Editor } from './Editor'
import { BlockEditor } from './BlockEditor'
import { BaseView } from './bases/BaseView'
import { InboxPageView } from './InboxPageView'
import { Loading } from './ui/EmptyState'
import { settings } from './settings'
import { isConfigBuffer } from './editor/settingsBuffer'
import type { NoteCandidate } from './editor/wikilink'
import type { MemoryCandidate } from '../../core/src/memoryRef'
import styles from './FileView.module.css'

/**
 * Routes a `.md` file to the right view: a `type: base` file renders as a BaseView,
 * everything else as an editor. Both branches need the file body, so FileView fetches it
 * once and parses the frontmatter client-side (same `parseFrontmatter` the backend's /meta
 * used) to branch — no separate /meta round-trip, and the already-read body is handed to
 * BaseView so it doesn't re-read. While the body is loading we show a neutral spinner.
 *
 * A plain note renders as either the CodeMirror `Editor` (raw markdown) or the Notion-like
 * `BlockEditor`, chosen ENTIRELY by the `editor.defaultMode` setting — there is no per-note UI
 * toggle. `settings` is reactive, so flipping `editor.defaultMode` in settings.yaml swaps every
 * open note's surface live. Both surfaces are interchangeable over the SAME file (same `body()`
 * as initialText, same `onSaved`), so the swap never loses an edit.
 */
export function FileView(props: {
    path: string
    onSaved: () => void
    onOpen: (path: string) => void
    noteNames: () => NoteCandidate[]
    memoryNames: () => MemoryCandidate[]
    tagNames: () => string[]
}) {
    const [body] = createResource(
        () => props.path,
        // Read through the note-body cache: a reopen of an unchanged note resolves
        // synchronously (no spinner). A missing/unreadable file is treated as an empty
        // note (a new, not-yet-written file routes to the Editor), matching how the
        // Editor handles a failed read.
        p => {
            const r = readNoteCached(p)
            return typeof r === 'string' ? r : r.catch(() => '')
        },
    )
    const isBase = () => {
        const text = body()
        return text !== undefined && parseFrontmatter(text).data.type === 'base'
    }
    // A daemon-authored inbox page (core/src/daemonPages.ts) — routes to InboxPageView, which
    // wraps the SAME Editor/BlockEditor body in an action-bar header. Same idiom as isBase() above.
    const isDaemonPage = () => {
        const text = body()
        return (
            text !== undefined &&
            parseFrontmatter(text).data.type === 'daemon-page'
        )
    }
    // Visual (Milkdown) mode is for real prose notes only. A YAML CONFIG buffer — the app
    // `.settings` file, or any `.yaml`/`.yml` — must ALWAYS open in the CodeMirror source Editor:
    // that's where the schema-driven settings autocomplete + lint live (isSettingsBuffer), and where
    // the YAML round-trips losslessly. Routing `.settings` to the BlockEditor is what silently killed
    // settings autocomplete (and would mangle the YAML on save) whenever defaultMode was `visual`.
    const visualMode = () =>
        settings.editor.defaultMode === 'visual' && !isConfigBuffer(props.path)
    return (
        <Show when={body.state === 'ready'} fallback={<Loading />}>
            <Switch>
                <Match when={isBase()}>
                    {/* Keyed on `props.path` so a tab switch between two bases REMOUNTS
                        BaseView instead of reusing it — otherwise BaseView's `pendingBody`
                        (captured once at mount from `props.body`) can outlive the mount it was
                        captured for and get parsed as a LATER, unrelated base's document (see
                        BaseView.tsx's own `pendingBody` comment).

                        Body comes from `peekNoteCache(path)`, NOT `body()`, on this branch: when
                        `path` changes to an ALREADY-cached note, this `<Show keyed>` reacts to the
                        raw `props.path` prop and remounts in the same synchronous pass, but the
                        `body` resource above (sourced from that same `props.path`) settles its
                        re-fetch — even a synchronous cache hit — one reactive pass later. Reading
                        `body()` here at the moment of remount can still return the PREVIOUS path's
                        text, which is exactly the same stale-body bug this fix exists to remove,
                        just moved from BaseView's `pendingBody` into this prop. `peekNoteCache`
                        reads the same underlying cache synchronously and without that lag; it
                        falls back to `body()` only for a genuine cache miss.

                        On a miss, what actually keeps this Match from painting a stale body is the
                        OUTER `<Show when={body.state === 'ready'}>` above (not isBase() — Solid
                        1.9.13's createResource keeps the PREVIOUS value while refreshing, so
                        `body()` and isBase() both stay at the old note's until the fetch settles):
                        `body.state` leaves `'ready'` the instant `props.path` changes and a real
                        fetch is needed, so the whole Switch — this Match included — is hidden
                        behind the Loading fallback until `body()` has genuinely caught up. A miss
                        is not just "a note never opened before", either: `noteCache` evicts a path
                        on every SSE change that touches it, and again at its 200-entry LRU cap, so
                        an already-visited note can miss again later in the same session. */}
                    <Show when={props.path} keyed>
                        {path => (
                            <BaseView
                                path={path}
                                body={peekNoteCache(path) ?? body()}
                                onOpen={props.onOpen}
                            />
                        )}
                    </Show>
                </Match>
                <Match when={isDaemonPage()}>
                    <InboxPageView
                        path={props.path}
                        initialText={body()}
                        onSaved={props.onSaved}
                        noteNames={props.noteNames}
                        memoryNames={props.memoryNames}
                        tagNames={props.tagNames}
                    />
                </Match>
                <Match when={!isBase() && !isDaemonPage()}>
                    {/* Column wrapper: the editor takes the full height and owns its own internal scroll.
              No backlinks surface here any more — neither the below-editor strip nor the corner
              control. The note's connections are answered by the graph's LOCAL lens (GraphView's
              MODE_ICON/local mode), which shows inbound AND outbound links rather than a list of
              inbound ones. Backlinks.tsx / BacklinksPanel are unmounted; backlinkGraph.ts (pure +
              tested) stays for whatever surfaces them next. */}
                    <div class={styles['fv-column']}>
                        <div class={styles['fv-editor-slot']}>
                            <Show
                                when={visualMode()}
                                fallback={
                                    <Editor
                                        path={props.path}
                                        initialText={body()}
                                        onSaved={props.onSaved}
                                        noteNames={props.noteNames}
                                        memoryNames={props.memoryNames}
                                        tagNames={props.tagNames}
                                    />
                                }
                            >
                                <BlockEditor
                                    path={props.path}
                                    initialText={body()}
                                    onSaved={props.onSaved}
                                    noteNames={props.noteNames}
                                    tagNames={props.tagNames}
                                />
                            </Show>
                        </div>
                    </div>
                </Match>
            </Switch>
        </Show>
    )
}
