// app/src/PaneContent.tsx
// Routes one pane's content id (a note path or a ::sentinel) to the right view.
// Shared by single-pane tabs and split panes so routing lives in exactly one place.
import { Switch, Match, Suspense, lazy } from "solid-js";
// Lazy: FileView → Editor → @codemirror/* (+ harper.js glue) is ~117 KB gz. The home
// tab on boot is the graph, so the editor is never needed at first paint — defer it
// off the entry bundle until a note is actually opened.
const FileView = lazy(() => import("./FileView").then((m) => ({ default: m.FileView })));
const SheetView = lazy(() => import("./SheetView").then((m) => ({ default: m.SheetView })));
const DrawingPage = lazy(() => import("./drawing/DrawingPage").then((m) => ({ default: m.DrawingPage })));

import { EmptyPane } from "./EmptyPane";
// Lazy: ExportView pulls in jspdf/html2canvas transitively; defer it off the entry bundle.
const ExportView = lazy(() => import("./ExportView").then((m) => ({ default: m.ExportView })));
// Lazy: ChatView pulls in the shared markdown renderer (marked + KaTeX); defer it off the entry bundle.
const ChatView = lazy(() => import("./ChatView").then((m) => ({ default: m.ChatView })));
import type { NoteCandidate } from "./editor/wikilink";
import { SEARCH_TAB, GRAPH_TAB, TERMINAL_PREFIX, EXPORT_PREFIX, CHAT_PREFIX, isSentinel } from "./tabIds";
import { SearchView } from "./SearchView";

export function PaneContent(props: {
  path: string;
  onSaved: () => void;
  onOpen: (path: string) => void;
  onNewTerminal: () => void;
  noteNames: () => NoteCandidate[];
  tagNames: () => string[];
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
            tagNames={props.tagNames}
          />
        </Suspense>
      }
    >
      {/* Export must win before the extension arms below so an export id is never
          mistaken for the file it targets. */}
      <Match when={props.path.startsWith(EXPORT_PREFIX)}>
        <Suspense fallback={<div class="exp" />}>
          <ExportView path={props.path.slice(EXPORT_PREFIX.length)} />
        </Suspense>
      </Match>
      <Match when={props.path === SEARCH_TAB}>
        <SearchView onOpen={props.onOpen} />
      </Match>
      <Match when={props.path === GRAPH_TAB}>
        {/* Graph panes show a transparent placeholder. The real WebGL graph lives in
            the always-mounted `.graph-floater` overlay in App.tsx, repositioned over
            this host so its Three.js renderer + camera survive a split/tab switch
            instead of being torn down and rebuilt (which reset the view). Same pattern
            as the terminal overlay above. */}
        <div data-graph-host class="full" />
      </Match>
      <Match when={props.path.endsWith(".sheet")}>
        <Suspense fallback={<div class="full" />}>
          <SheetView path={props.path} onSaved={props.onSaved} />
        </Suspense>
      </Match>
      {/* A base is a `type: base` md file — routed by FileView (the fallback), which
          reads its frontmatter and renders BaseView. There is no `.base` extension. */}
      <Match when={props.path.endsWith(".draw")}>
        <Suspense fallback={<div class="full" />}>
          <DrawingPage path={props.path} />
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
          <ChatView chatId={props.path.slice(CHAT_PREFIX.length)} />
        </Suspense>
      </Match>
      {/* Any other sentinel (e.g. a stale "::tasks" tab from before the global
          Tasks page was removed) falls back to an empty pane rather than trying
          to load it as a note. */}
      <Match when={isSentinel(props.path)}>
        <EmptyPane onNewTerminal={props.onNewTerminal} />
      </Match>
    </Switch>
  );
}
