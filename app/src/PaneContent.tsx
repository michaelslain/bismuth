// app/src/PaneContent.tsx
// Routes one pane's content id (a note path or a ::sentinel) to the right view.
// Shared by single-pane tabs and split panes so routing lives in exactly one place.
import { Switch, Match, lazy } from 'solid-js'
// Lazy: FileView → Editor → @codemirror/* (+ harper.js glue) is ~117 KB gz. The home
// tab on boot is the graph, so the editor is never needed at first paint — defer it
// off the entry bundle until a note is actually opened.
const FileView = lazy(() =>
    import('./FileView').then(m => ({ default: m.FileView })),
)
const SheetView = lazy(() =>
    import('./SheetView').then(m => ({ default: m.SheetView })),
)
const DrawingPage = lazy(() =>
    import('./drawing/DrawingPage').then(m => ({ default: m.DrawingPage })),
)
// Preview tab for images / PDFs / code / binary files (the default open). Images and PDFs are
// drawn on in place there (preview/PageInk), into the `<file>.draw` sidecar.
const PreviewView = lazy(() =>
    import('./PreviewView').then(m => ({ default: m.PreviewView })),
)

// The daemon page (living face + crons/services + inbox/log + an inline chat in its centre
// column). Lazy: nothing on the graph home tab needs it at first paint.
const DaemonPageHost = lazy(() => import('./daemon/DaemonPageHost'))
// The feedback page (app/src/feedback/). Lazy, like the daemon page.
const FeedbackPageHost = lazy(() => import('./feedback/FeedbackPageHost'))
// The chat tab. Lazy: it pulls in the shared markdown renderer (marked + KaTeX). Rendered INLINE —
// unmounting it on a tab/pane switch is harmless, because the chat's session (WS, transcript,
// draft, streaming turn) lives in the registry App retains (chat/chatSessions.ts), not in the view.
const ChatView = lazy(() =>
    import('./chat/ChatView').then(m => ({ default: m.ChatView })),
)

import { EmptyPane } from './EmptyPane'
import PaneSuspense from './PaneSuspense'
// Lazy: ExportView pulls in jspdf/html2canvas transitively; defer it off the entry bundle.
const ExportView = lazy(() =>
    import('./ExportView').then(m => ({ default: m.ExportView })),
)
import type { NoteCandidate } from './editor/wikilink'
import type { MemoryCandidate } from '../../core/src/memoryRef'
import {
    GRAPH_TAB,
    TERMINAL_PREFIX,
    EXPORT_PREFIX,
    CHAT_PREFIX,
    ANNOTATE_PREFIX,
    DAEMON_TAB,
    FEEDBACK_TAB,
    isSentinel,
} from './tabIds'
import { isPreviewPath } from './preview/previewKind'
// PaneContent owns its own fallback grid rule (`.export-fallback`, mirroring ExportView's `.exp`
// shape) rather than importing ExportView.module.css — that would make ExportView.module.css's
// stylesheet have two importers. See PaneContent.module.css's header comment.
import styles from './PaneContent.module.css'

export function PaneContent(props: {
    path: string
    onSaved: () => void
    onOpen: (path: string) => void
    onNewTerminal: () => void
    noteNames: () => NoteCandidate[]
    memoryNames: () => MemoryCandidate[]
    tagNames: () => string[]
    /** The owning tab's user-set name — a chat pane's header title follows it. */
    tabName?: () => string | undefined
}) {
    return (
        <Switch
            fallback={
                // FileView is lazy; the fallback keeps the pane's full box during the brief
                // chunk load so a split/tab doesn't flash a collapsed pane.
                <PaneSuspense>
                    <FileView
                        path={props.path}
                        onSaved={props.onSaved}
                        onOpen={props.onOpen}
                        noteNames={props.noteNames}
                        memoryNames={props.memoryNames}
                        tagNames={props.tagNames}
                    />
                </PaneSuspense>
            }
        >
            {/* Export must win before the extension arms below so an export id is never
          mistaken for the file it targets. */}
            <Match when={props.path.startsWith(EXPORT_PREFIX)}>
                <PaneSuspense fallback={<div class={styles['export-fallback']} />}>
                    <ExportView path={props.path.slice(EXPORT_PREFIX.length)} />
                </PaneSuspense>
            </Match>
            {/* There is NO ::search route anymore (#8: search unified into the Cmd+O switcher) —
          persisted ::search tabs are migrated to ::graph on restore (panes.ts deserializeTabs);
          anything that slips through lands on the unknown-sentinel EmptyPane below. There is
          no ::inbox route either: the inbox folded into the daemon page, and persisted ::inbox
          tabs migrate to ::daemon the same way. */}
            <Match when={props.path === DAEMON_TAB}>
                {/* The page renders its daemon chat itself; that chat's session is retained by App
            like a chat tab's (chat/chatSessions.ts), once a trusted gesture arms it. */}
                <PaneSuspense>
                    <DaemonPageHost
                        onOpen={props.onOpen}
                        noteNames={props.noteNames}
                        memoryNames={props.memoryNames}
                        tagNames={props.tagNames}
                    />
                </PaneSuspense>
            </Match>
            <Match when={props.path === FEEDBACK_TAB}>
                <PaneSuspense>
                    <FeedbackPageHost
                        noteNames={props.noteNames}
                        memoryNames={props.memoryNames}
                        tagNames={props.tagNames}
                    />
                </PaneSuspense>
            </Match>
            <Match when={props.path === GRAPH_TAB}>
                {/* Graph panes show a transparent placeholder. The real WebGL graph lives in
            the always-mounted `.graph-floater` overlay in App.tsx, repositioned over
            this host so its Three.js renderer + camera survive a split/tab switch
            instead of being torn down and rebuilt (which reset the view). Same pattern
            as the terminal overlay above. */}
                <div data-graph-host class="full" />
            </Match>
            <Match when={props.path.endsWith('.sheet')}>
                <PaneSuspense>
                    <SheetView path={props.path} onSaved={props.onSaved} />
                </PaneSuspense>
            </Match>
            {/* A base is a `.base.jsonl` file (line 1 = config) or a `type: base` md file — routed by
          FileView (the fallback), which decides by path and content and renders BaseView. `jsonl`
          is not a preview extension, so a `.base.jsonl` is never claimed by the code preview. */}
            {/* The retired ANNOTATE surface. A tab persisted from before it went away still carries
          "::annotate:<file>", so it opens that file's preview — where the same sidecar's ink is
          now drawn in place. Must precede the `.draw`/preview Matches below: the sentinel ends in
          the source file's extension, which isPreviewPath would otherwise claim. */}
            <Match when={props.path.startsWith(ANNOTATE_PREFIX)}>
                <PaneSuspense>
                    <PreviewView
                        path={props.path.slice(ANNOTATE_PREFIX.length)}
                        tagNames={props.tagNames}
                        noteNames={props.noteNames}
                    />
                </PaneSuspense>
            </Match>
            <Match when={props.path.endsWith('.draw')}>
                <PaneSuspense>
                    <DrawingPage path={props.path} />
                </PaneSuspense>
            </Match>
            {/* Images, PDFs, and code/text open as a PREVIEW by default. Images/PDFs take ink in
          place (the toggle-draw-mode key); binary formats (PSD/Figma/…) show a "preview not
          available" state + "Open in default app". Placed AFTER the `.draw` Match so a
          `<file>.png.draw` sidecar opened directly still routes to DrawingPage. */}
            <Match when={isPreviewPath(props.path)}>
                <PaneSuspense>
                    <PreviewView
                        path={props.path}
                        tagNames={props.tagNames}
                        noteNames={props.noteNames}
                    />
                </PaneSuspense>
            </Match>
            <Match when={props.path.startsWith(TERMINAL_PREFIX)}>
                {/* Terminal panes show a transparent placeholder. The real xterm view
            lives in the always-mounted overlay in App.tsx so its WebSocket and
            scrollback survive tab/pane switches. App.tsx measures this host's
            bounding rect to position the overlay over this exact pane body. */}
                <div data-terminal-host={props.path} class="full" />
            </Match>
            <Match when={props.path.startsWith(CHAT_PREFIX)}>
                <PaneSuspense>
                    <ChatView
                        chatId={props.path.slice(CHAT_PREFIX.length)}
                        tabName={props.tabName}
                        noteNames={props.noteNames}
                        memoryNames={props.memoryNames}
                        tagNames={props.tagNames}
                    />
                </PaneSuspense>
            </Match>
            {/* Any other sentinel (e.g. a stale "::tasks" tab from before the global
          Tasks page was removed) falls back to an empty pane rather than trying
          to load it as a note. */}
            <Match when={isSentinel(props.path)}>
                <EmptyPane onNewTerminal={props.onNewTerminal} />
            </Match>
        </Switch>
    )
}
