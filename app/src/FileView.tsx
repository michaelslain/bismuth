import { createResource, Show, Switch, Match } from 'solid-js'
import { readNoteCached, peekNoteCache } from './noteCache'
import { parseFrontmatter } from '../../core/src/frontmatter'
import { Editor } from './Editor'
import { BaseView } from './bases/BaseView'
import { InboxPageView } from './InboxPageView'
import { Loading } from './ui/EmptyState'
import {
    bodyForPath,
    isForeignBody,
    type LoadedBody,
} from './bases/prefetchedBody'
import type { NoteCandidate } from './editor/wikilink'
import type { MemoryCandidate } from '../../core/src/memoryRef'
import styles from './FileView.module.css'

/**
 * Routes a `.md` file to the right view: a `type: base` file renders as a BaseView,
 * everything else as an editor. Both branches need the file body, so FileView fetches it
 * once and parses the frontmatter client-side (same `parseFrontmatter` the backend's /meta
 * used) to branch — no separate /meta round-trip, and the already-read body is handed to
 * BaseView so it doesn't re-read, but only when it's provably that path's text (see
 * `bases/prefetchedBody.ts`) — otherwise BaseView reads /file itself. While the body is
 * loading we show a neutral spinner.
 *
 * A plain note always renders as the CodeMirror `Editor` (raw markdown).
 */
export function FileView(props: {
    path: string
    onSaved: () => void
    onOpen: (path: string) => void
    noteNames: () => NoteCandidate[]
    memoryNames: () => MemoryCandidate[]
    tagNames: () => string[]
}) {
    const [loaded] = createResource(
        () => props.path,
        // Read through the note-body cache: a reopen of an unchanged note resolves
        // synchronously (no spinner). A missing/unreadable file is treated as an empty
        // note (a new, not-yet-written file routes to the Editor), matching how the
        // Editor handles a failed read. The value is TAGGED with the path it was read
        // for, so a consumer can tell a lagging previous-note body from this note's
        // (see bases/prefetchedBody.ts).
        (p): LoadedBody | Promise<LoadedBody> => {
            const r = readNoteCached(p)
            return typeof r === 'string'
                ? { path: p, text: r }
                : r.catch(() => '').then(text => ({ path: p, text }))
        },
    )
    const body = () => loaded()?.text
    const isBase = () => {
        const text = body()
        return text !== undefined && parseFrontmatter(text).data.type === 'base'
    }
    // A daemon-authored inbox page (core/src/daemonPages.ts) — routes to InboxPageView, which
    // wraps the SAME Editor body in an action-bar header. Same idiom as isBase() above.
    const isDaemonPage = () => {
        const text = body()
        return (
            text !== undefined &&
            parseFrontmatter(text).data.type === 'daemon-page'
        )
    }
    return (
        <Show when={loaded.state === 'ready'} fallback={<Loading />}>
            <Switch>
                <Match when={isBase()}>
                    {/* Keyed on `props.path` so a tab switch between two bases REMOUNTS
                        BaseView instead of reusing it — otherwise BaseView's `pendingBody`
                        (captured once at mount from `props.body`) can outlive the mount it was
                        captured for and get parsed as a LATER, unrelated base's document (see
                        BaseView.tsx's own `pendingBody` comment).

                        The body handed in must be PROVABLY this `path`'s text, because BaseView
                        caches the parse in a module-level docCache keyed by path and every later
                        mount of that path trusts the entry — a wrong body here poisons every
                        future mount, not just this one. `bodyForPath` (bases/prefetchedBody.ts)
                        enforces that: it prefers `peekNoteCache(path)` (keyed by path, so always
                        right), and falls back to the resource's value ONLY when that value is
                        tagged with this same `path` — the resource can still be settling a
                        previous note's fetch when this Match first reacts to a new path. Anything
                        else is refused, and BaseView reads `/file` itself instead: one extra
                        round-trip, never wrong.

                        The warn below fires on a refusal. It exists because the trigger that
                        produced a foreign body in the INSTALLED APP (Task 9's real-vault repro,
                        the calendar tab showing the previously opened base) was never reproduced
                        headlessly — no story here guards this line — so the log is the breadcrumb
                        for whenever it recurs. */}
                    <Show when={props.path} keyed>
                        {path => {
                            const prefetched = loaded()
                            if (
                                isForeignBody(path, prefetched) &&
                                peekNoteCache(path) === undefined
                            )
                                console.warn(
                                    `[bismuth] refused ${prefetched!.path}'s body while mounting base ${path}; reading /file instead`,
                                )
                            return (
                                <BaseView
                                    path={path}
                                    body={bodyForPath(
                                        path,
                                        peekNoteCache(path),
                                        prefetched,
                                    )}
                                    onOpen={props.onOpen}
                                />
                            )
                        }}
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
                            <Editor
                                path={props.path}
                                initialText={body()}
                                onSaved={props.onSaved}
                                noteNames={props.noteNames}
                                memoryNames={props.memoryNames}
                                tagNames={props.tagNames}
                            />
                        </div>
                    </div>
                </Match>
            </Switch>
        </Show>
    )
}
