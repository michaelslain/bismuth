// app/src/chatComposerKeys.ts
//
// Pure key-routing for the visual-chat composer (Row 77). The composer is a CodeMirror instance
// (ChatComposer.tsx) whose keydown is delegated to ChatView; this decides — from the key + the
// composer's state — WHAT the key means, so the precedence (slash popover owns nav first, then
// streaming-Escape interrupts, then Enter sends, else CodeMirror handles it) is unit-testable and
// can't silently drift. ChatView maps each action to its side effect (nav / pick / stop / send) and
// returns true (CodeMirror stops) for every action except `pass`, where Shift+Enter etc. fall
// through to CodeMirror's own handling (a plain newline, ordinary typing).
//
// NOTE: keys the vault autocomplete popup owns while it's OPEN ([[wikilink]]/tag/emoji navigation)
// never reach here — ChatComposer defers those to CodeMirror before calling ChatView — so this only
// ever sees the composer's own chords.

export type ComposerKeyAction =
  | "slash-nav" // Arrow/Escape while the slash-command popover is open → move/close the menu
  | "slash-select" // Enter while the slash popover is open → pick the highlighted command
  | "stop" // Escape while a turn streams → interrupt it (TUI parity)
  | "send" // Enter (no Shift) → send or stage the message
  | "pass"; // let CodeMirror handle it (Shift+Enter newline, plain typing, Escape-with-nothing-open)

export interface ComposerKeyEvent {
  key: string;
  shiftKey: boolean;
}

export interface ComposerKeyState {
  /** The slash-command autocomplete popover is open. */
  slashOpen: boolean;
  /** A turn is currently streaming (so Escape interrupts it). */
  streaming: boolean;
}

/** Decide what a composer keystroke means. Pure — no DOM, no side effects. */
export function classifyComposerKey(e: ComposerKeyEvent, state: ComposerKeyState): ComposerKeyAction {
  // The slash popover owns navigation first, exactly as it did with the old textarea handler.
  if (state.slashOpen) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Escape") return "slash-nav";
    if (e.key === "Enter" && !e.shiftKey) return "slash-select";
  }
  // Escape interrupts an in-flight turn (only when the slash popover isn't open — handled above).
  if (e.key === "Escape" && state.streaming) return "stop";
  // Enter sends / stages; Shift+Enter is left to CodeMirror as a plain newline.
  if (e.key === "Enter" && !e.shiftKey) return "send";
  return "pass";
}
