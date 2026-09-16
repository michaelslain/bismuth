// app/src/PaneContent.tsx
// Routes one pane's content id (a note path or a ::sentinel) to the right view.
// Shared by single-pane tabs and split panes so routing lives in exactly one place.
import { Switch, Match, Suspense, lazy } from 'solid-js'
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
// The chat tab. Lazy: it pulls in the shared markdown renderer (marked + KaTeX). Rendered INLINE —
// unmounting it on a tab/pane switch is harmless, because the chat's session (WS, transcript,
// draft, streaming turn) lives in the registry App retains (chat/chatSessions.ts), not in the view.
const ChatView = lazy(() =>
    import('./ChatView').then(m => ({ default: m.ChatView })),
)

import { EmptyPane } from './EmptyPane'
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
    isSentinel,
} from './tabIds'
import { isPreviewPath } from './preview/previewKind'
// Only the hashed `.exp` class token, never the ExportView component — ExportView itself stays
// behind lazy() below because it transitively pulls in jspdf/html2canvas, and a static import of
// anything from './ExportView' here would pull that whole chunk back into the entry bundle. A
// CSS Modules import has no such cost (just a scoped stylesheet + a plain class-name map), so this
// is a deliberate, narrow exception to "import the component, not the stylesheet": the Suspense
// fallback below needs only the paper-cream grid frame's STYLE, never ExportView's logic.
import exportStyles from './ExportView.module.css'

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
                <Suspense fallback={<div class="full" />}>
                    <FileView
                        path={props.path}
                        onSaved={props.onSaved}
                        onOpen={props.onOpen}
                        noteNames={props.noteNames}
                        memoryNames={props.memoryNames}
                        tagNames={props.tagNames}
                    />
                </Suspense>
            }
        >
            {/* Export must win before the extension arms below so an export id is never
          mistaken for the file it targets. */}
            <Match when={props.path.startsWith(EXPORT_PREFIX)}>
                <Suspense fallback={<div class={exportStyles.exp} />}>
                    <ExportView path={props.path.slice(EXPORT_PREFIX.length)} />
                </Suspense>
            </Match>
            {/* There is NO ::search route anymore (#8: search unified into the Cmd+O switcher) —
          persisted ::search tabs are migrated to ::graph on restore (panes.ts deserializeTabs);
          anything that slips through lands on the unknown-sentinel EmptyPane below. There is
          no ::inbox route either: the inbox folded into the daemon page, and persisted ::inbox
          tabs migrate to ::daemon the same way. */}
            <Match when={props.path === DAEMON_TAB}>
                {/* The page renders its daemon chat itself; that chat's session is retained by App
            like a chat tab's (chat/chatSessions.ts), once a trusted gesture arms it. */}
                <Suspense fallback={<div class="full" />}>
                    <DaemonPageHost
                        onOpen={props.onOpen}
                        noteNames={props.noteNames}
                        memoryNames={props.memoryNames}
                        tagNames={props.tagNames}
                    />
                </Suspense>
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
                <Suspense fallback={<div class="full" />}>
                    <SheetView path={props.path} onSaved={props.onSaved} />
                </Suspense>
            </Match>
            {/* A base is a `type: base` md file — routed by FileView (the fallback), which
          reads its frontmatter and renders BaseView. There is no `.base` extension. */}
            {/* The retired ANNOTATE surface. A tab persisted from before it went away still carries
          "::annotate:<file>", so it opens that file's preview — where the same sidecar's ink is
          now drawn in place. Must precede the `.draw`/preview Matches below: the sentinel ends in
          the source file's extension, which isPreviewPath would otherwise claim. */}
            <Match when={props.path.startsWith(ANNOTATE_PREFIX)}>
                <Suspense fallback={<div class="full" />}>
                    <PreviewView
                        path={props.path.slice(ANNOTATE_PREFIX.length)}
                        tagNames={props.tagNames}
                        noteNames={props.noteNames}
                    />
                </Suspense>
            </Match>
            <Match when={props.path.endsWith('.draw')}>
                <Suspense fallback={<div class="full" />}>
                    <DrawingPage path={props.path} />
                </Suspense>
            </Match>
            {/* Images, PDFs, and code/text open as a PREVIEW by default. Images/PDFs take ink in
          place (the toggle-draw-mode key); binary formats (PSD/Figma/…) show a "preview not
          available" state + "Open in default app". Placed AFTER the `.draw` Match so a
          `<file>.png.draw` sidecar opened directly still routes to DrawingPage. */}
            <Match when={isPreviewPath(props.path)}>
                <Suspense fallback={<div class="full" />}>
                    <PreviewView
                        path={props.path}
                        tagNames={props.tagNames}
                        noteNames={props.noteNames}
                    />
                </Suspense>
            </Match>
            <Match when={props.path.startsWith(TERMINAL_PREFIX)}>
                {/* Terminal panes show a transparent placeholder. The real xterm view
            lives in the always-mounted overlay in App.tsx so its WebSocket and
            scrollback survive tab/pane switches. App.tsx measures this host's
            bounding rect to position the overlay over this exact pane body. */}
                <div data-terminal-host={props.path} class="full" />
            </Match>
            <Match when={props.path.startsWith(CHAT_PREFIX)}>
                <Suspense fallback={<div class="full" />}>
                    <ChatView
                        chatId={props.path.slice(CHAT_PREFIX.length)}
                        tabName={props.tabName}
                        noteNames={props.noteNames}
                        memoryNames={props.memoryNames}
                        tagNames={props.tagNames}
                    />
                </Suspense>
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
