// app/src/PaneContent.tsx
// Routes one pane's content id (a note path or a ::sentinel) to the right view.
// Shared by single-pane tabs and split panes so routing lives in exactly one place.
import { Switch, Match, Suspense, lazy } from "solid-js";
import { FileView } from "./FileView";
import { BaseView } from "./bases/BaseView";
import { SheetView } from "./SheetView";
import { EmptyPane } from "./EmptyPane";
import { DrawingPage } from "./drawing/DrawingPage";
// Lazy: ExportView pulls in jspdf/html2canvas transitively; defer it off the entry bundle.
const ExportView = lazy(() => import("./ExportView").then((m) => ({ default: m.ExportView })));
import type { NoteCandidate } from "./editor/wikilink";
import { SEARCH_TAB, GRAPH_TAB, TERMINAL_PREFIX, EXPORT_PREFIX, isSentinel } from "./tabIds";
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
        <FileView
          path={props.path}
          onSaved={props.onSaved}
          onOpen={props.onOpen}
          noteNames={props.noteNames}
          tagNames={props.tagNames}
        />
      }
    >
      {/* Export must win before the extension arms below: an export id like
          "::export:Reading.base" ends with ".base", so without this ordering it
          would be caught by the .base arm and render the BaseView, not ExportView. */}
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
        <div data-graph-host style={{ width: "100%", height: "100%" }} />
      </Match>
      <Match when={props.path.endsWith(".sheet")}>
        <SheetView path={props.path} onSaved={props.onSaved} />
      </Match>
      <Match when={props.path.endsWith(".base")}>
        <BaseView path={props.path} onOpen={props.onOpen} />
      </Match>
      <Match when={props.path.endsWith(".draw")}>
        <DrawingPage path={props.path} />
      </Match>
      <Match when={props.path.startsWith(TERMINAL_PREFIX)}>
        {/* Terminal panes show a transparent placeholder. The real xterm view
            lives in the always-mounted overlay in App.tsx so its WebSocket and
            scrollback survive tab/pane switches. App.tsx measures this host's
            bounding rect to position the overlay over this exact pane body. */}
        <div data-terminal-host={props.path} style={{ width: "100%", height: "100%" }} />
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
