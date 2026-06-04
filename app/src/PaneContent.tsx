// app/src/PaneContent.tsx
// Routes one pane's content id (a note path or a ::sentinel) to the right view.
// Shared by single-pane tabs and split panes so routing lives in exactly one place.
import { Switch, Match, Suspense, lazy, type JSX } from "solid-js";
import { FileView } from "./FileView";
import { Flashcards } from "./Flashcards";
import { BaseView } from "./bases/BaseView";
import { SheetView } from "./SheetView";
import { EmptyPane } from "./EmptyPane";
import { DrawingPage } from "./drawing/DrawingPage";
// Lazy: ExportView pulls in jspdf/html2canvas transitively; defer it off the entry bundle.
const ExportView = lazy(() => import("./ExportView").then((m) => ({ default: m.ExportView })));
import type { NoteCandidate } from "./editor/wikilink";
import { SEARCH_TAB, GRAPH_TAB, FLASHCARDS_PREFIX, TERMINAL_PREFIX, EXPORT_PREFIX, isSentinel } from "./tabIds";
import { SearchView } from "./SearchView";

export function PaneContent(props: {
  path: string;
  onSaved: () => void;
  onOpen: (path: string) => void;
  onOpenQuickSwitcher: () => void;
  onNewTerminal: () => void;
  noteNames: () => NoteCandidate[];
  tagNames: () => string[];
  // Renders the Knowledge Graph for a ::graph pane. Supplied by App (which owns the graph data +
  // mode), so PaneContent need not thread the whole graph signal through the pane tree.
  renderGraph?: () => JSX.Element;
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
      <Match when={props.path.startsWith(FLASHCARDS_PREFIX)}>
        <Flashcards note={props.path.slice(FLASHCARDS_PREFIX.length)} />
      </Match>
      <Match when={props.path === SEARCH_TAB}>
        <SearchView onOpen={props.onOpen} />
      </Match>
      <Match when={props.path === GRAPH_TAB}>
        {props.renderGraph?.()}
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
        <EmptyPane onOpenFile={props.onOpenQuickSwitcher} onNewTerminal={props.onNewTerminal} />
      </Match>
    </Switch>
  );
}
