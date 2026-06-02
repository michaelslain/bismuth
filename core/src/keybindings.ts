// core/src/keybindings.ts
// The keybinding catalog: pure metadata for every global, app-level keyboard
// shortcut. Lives in core (no frontend imports) so the settings schema can
// derive the `keybindings` section from it, and the frontend can match a
// KeyboardEvent against each id (see app/src/keybindings.ts + App.tsx). Single
// source of truth for keybinding ids AND their default combos — App.tsx reads
// settings.keybindings.<id>, never a hardcoded combo.
//
// Combo syntax (see app/src/keybindings.ts for the matcher):
//   "Mod"   — Cmd on macOS / Ctrl elsewhere (matches metaKey OR ctrlKey)
//   "Alt"   — Option/Alt;  "Shift" — Shift
//   final token is the key, e.g. "P", "D", "=", "`", "ArrowLeft"
//   comma-separate alternatives: "Mod+`, Mod+J"
// Matching is EXACT on modifiers, so "Mod+D" (split-right) and "Mod+Shift+D"
// (split-down) never collide.

export interface KeybindingSpec {
  /** Stable id; the YAML key under `keybindings:` and the lookup App.tsx uses. */
  id: string;
  /** Human label (for docs / a future shortcuts cheat-sheet). */
  label: string;
  /** Default combo string, equal to the value previously hardcoded in App.tsx. */
  default: string;
  /** One-line doc surfaced by settings autocomplete + the parity test. */
  doc: string;
}

export const KEYBINDING_CATALOG: KeybindingSpec[] = [
  { id: "command-palette", label: "Toggle command palette", default: "Mod+P",
    doc: "Open/close the command palette." },
  { id: "quick-switcher", label: "Toggle quick switcher", default: "Mod+O",
    doc: "Open/close the quick file switcher." },
  { id: "terminal", label: "Open terminal", default: "Mod+`, Mod+J",
    doc: "Open a terminal tab (comma-separated alternatives allowed)." },
  { id: "split-right", label: "Split pane right", default: "Mod+D",
    doc: "Split the focused pane into a new pane to the right." },
  { id: "split-down", label: "Split pane down", default: "Mod+Shift+D",
    doc: "Split the focused pane into a new pane below." },
  { id: "equalize-panes", label: "Equalize panes", default: "Mod+Alt+=",
    doc: "Reset all split panes to equal sizes." },
  { id: "close-pane", label: "Close pane", default: "Mod+W",
    doc: "Close the focused pane." },
  { id: "focus-pane-left", label: "Focus pane left", default: "Mod+Alt+ArrowLeft",
    doc: "Move focus to the pane on the left." },
  { id: "focus-pane-right", label: "Focus pane right", default: "Mod+Alt+ArrowRight",
    doc: "Move focus to the pane on the right." },
  { id: "focus-pane-up", label: "Focus pane up", default: "Mod+Alt+ArrowUp",
    doc: "Move focus to the pane above." },
  { id: "focus-pane-down", label: "Focus pane down", default: "Mod+Alt+ArrowDown",
    doc: "Move focus to the pane below." },
  { id: "insert-template", label: "Insert template", default: "Alt+T",
    doc: "Open the template-insertion palette (ignored while typing in a form field)." },
];

/** All keybinding ids, in catalog order. */
export const KEYBINDING_IDS: string[] = KEYBINDING_CATALOG.map((k) => k.id);
