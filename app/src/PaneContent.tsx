// app/src/PaneContent.tsx
// Routes one pane's content id (a note path or a ::sentinel) to the right view.
// Shared by single-pane tabs and split panes so routing lives in exactly one place.
import { Switch, Match } from "solid-js";
import { Editor } from "./Editor";
import { Flashcards } from "./Flashcards";
import { CalendarPage } from "./calendar/CalendarPage";
import { SettingsPage } from "./SettingsPage";
import { TasksPage } from "./TasksPage";
import { BaseView } from "./bases/BaseView";
import { EmptyPane } from "./EmptyPane";
import type { NoteCandidate } from "./editor/wikilink";
import { SETTINGS_TAB, CALENDAR_TAB, TASKS_TAB, FLASHCARDS_PREFIX, TERMINAL_PREFIX, EMPTY_PANE } from "./tabIds";

export function PaneContent(props: {
  path: string;
  onSaved: () => void;
  onOpen: (path: string) => void;
  onOpenQuickSwitcher: () => void;
  onNewTerminal: () => void;
  noteNames: () => NoteCandidate[];
  tagNames: () => string[];
}) {
  return (
    <Switch
      fallback={
        <Editor
          path={props.path}
          onSaved={props.onSaved}
          noteNames={props.noteNames}
          tagNames={props.tagNames}
        />
      }
    >
      <Match when={props.path.startsWith(FLASHCARDS_PREFIX)}>
        <Flashcards note={props.path.slice(FLASHCARDS_PREFIX.length)} />
      </Match>
      <Match when={props.path === CALENDAR_TAB}>
        <CalendarPage />
      </Match>
      <Match when={props.path === SETTINGS_TAB}>
        <SettingsPage />
      </Match>
      <Match when={props.path === TASKS_TAB}>
        <TasksPage onOpen={props.onOpen} />
      </Match>
      <Match when={props.path === EMPTY_PANE}>
        <EmptyPane onOpenFile={props.onOpenQuickSwitcher} onNewTerminal={props.onNewTerminal} />
      </Match>
      <Match when={props.path.endsWith(".base")}>
        <BaseView path={props.path} onOpen={props.onOpen} />
      </Match>
      <Match when={props.path.startsWith(TERMINAL_PREFIX)}>
        {/* Terminal panes show a transparent placeholder. The real xterm view
            lives in the always-mounted overlay in App.tsx so its WebSocket and
            scrollback survive tab/pane switches. App.tsx measures this host's
            bounding rect to position the overlay over this exact pane body. */}
        <div data-terminal-host={props.path} style={{ width: "100%", height: "100%" }} />
      </Match>
    </Switch>
  );
}
