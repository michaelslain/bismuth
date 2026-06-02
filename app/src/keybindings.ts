// app/src/keybindings.ts
// Pure keyboard-shortcut matching: turn a settings.keybindings combo string into
// a predicate over a KeyboardEvent. The combo grammar and the action catalog
// live in core/src/keybindings.ts; this is just the runtime matcher used by
// App.tsx's global keydown handler.
//
//   "Mod"  — Cmd on macOS / Ctrl elsewhere (matches metaKey OR ctrlKey),
//            mirroring CodeMirror's convention.
//   "Alt"  — Option/Alt;  "Shift" — Shift.
//   The final "+"-separated token is the key (e.g. "P", "=", "`", "ArrowLeft").
//   Comma-separate alternatives: "Mod+`, Mod+J".
//
// Matching is EXACT on modifiers: a combo with no Shift token does NOT fire when
// Shift is held, so "Mod+D" (split-right) and "Mod+Shift+D" (split-down) stay
// distinct. Key comparison is case-insensitive (against KeyboardEvent.key).

export interface ParsedCombo {
  mod: boolean; // Cmd/Ctrl (either)
  alt: boolean;
  shift: boolean;
  key: string; // normalized main key, lowercased
}

// Modifier tokens → which flag they set. Cmd/Ctrl/Meta all fold into `mod`
// because the app treats Cmd-on-mac and Ctrl-elsewhere as the same shortcut.
const MODIFIER_TOKENS: Record<string, "mod" | "alt" | "shift"> = {
  mod: "mod", cmd: "mod", command: "mod", ctrl: "mod", control: "mod", meta: "mod", super: "mod",
  alt: "alt", option: "alt", opt: "alt",
  shift: "shift",
};

// Friendly aliases → the lowercased KeyboardEvent.key they correspond to.
const KEY_ALIASES: Record<string, string> = {
  esc: "escape",
  return: "enter",
  left: "arrowleft", right: "arrowright", up: "arrowup", down: "arrowdown",
  space: " ", spacebar: " ",
  plus: "+",
};

function normalizeKey(tok: string): string {
  const t = tok.toLowerCase();
  return KEY_ALIASES[t] ?? t;
}

/** Parse one combo (no commas) into its modifier flags + main key, or null. */
export function parseCombo(combo: string): ParsedCombo | null {
  const parts = combo.split("+").map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length === 0) return null;
  const out: ParsedCombo = { mod: false, alt: false, shift: false, key: "" };
  parts.forEach((part, i) => {
    const mod = MODIFIER_TOKENS[part.toLowerCase()];
    // A token counts as a modifier only when it isn't the final (key) token, so
    // "Shift" can still be bound as a literal key if it's last (degenerate).
    if (mod && i < parts.length - 1) out[mod] = true;
    else out.key = normalizeKey(part);
  });
  return out.key ? out : null;
}

/** Does the event match a single combo (exact modifiers, case-insensitive key)? */
export function matchesCombo(e: KeyboardEvent, combo: string): boolean {
  const p = parseCombo(combo);
  if (!p) return false;
  if (p.mod !== (e.metaKey || e.ctrlKey)) return false;
  if (p.alt !== e.altKey) return false;
  if (p.shift !== e.shiftKey) return false;
  return e.key.toLowerCase() === p.key;
}

/**
 * Does the event match a keybinding setting? The setting may list comma-separated
 * alternatives ("Mod+`, Mod+J"); any one matching wins. Empty/undefined → false.
 */
export function matchesKeybinding(e: KeyboardEvent, setting: string | undefined | null): boolean {
  if (!setting) return false;
  return setting.split(",").some((c) => c.trim().length > 0 && matchesCombo(e, c));
}

// ── Authoring helpers (used by the `keybind` autocomplete) ───────────────────

// Modifier tokens offered by the autocomplete. "Mod" is the portable default;
// Cmd/Ctrl/Meta are offered too for users who want an explicit platform key.
export const KEYBIND_MODIFIERS = ["Mod", "Alt", "Shift", "Cmd", "Ctrl", "Meta"];

// Which family a modifier token belongs to, so the completion can hide a family
// that's already present in the combo (e.g. once "Mod" is typed, drop Cmd/Ctrl too).
const MODIFIER_FAMILY: Record<string, string> = {
  mod: "mod", cmd: "mod", command: "mod", ctrl: "mod", control: "mod", meta: "mod", super: "mod",
  alt: "alt", option: "alt", opt: "alt",
  shift: "shift",
};

/** The modifier family of a token, or null if the token is a plain key. */
export function modifierFamily(token: string): string | null {
  return MODIFIER_FAMILY[token.trim().toLowerCase()] ?? null;
}

// Non-modifier keys offered by the autocomplete, in a sensible display form
// (parseCombo lowercases when matching, so case here is cosmetic).
export const KEYBIND_KEYS: string[] = [
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""),
  ..."0123456789".split(""),
  "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
  "Enter", "Escape", "Tab", "Space", "Backspace", "Delete",
  "Home", "End", "PageUp", "PageDown", "Insert",
  "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12",
  "`", "-", "=", "[", "]", "\\", ";", "'", ",", ".", "/",
];

/** Display name for a captured KeyboardEvent.key (e.g. " " → "Space", "d" → "D"). */
function displayKey(key: string): string {
  if (key === " ") return "Space";
  if (key === "Spacebar") return "Space";
  return key.length === 1 ? key.toUpperCase() : key;
}

/**
 * Build a combo string from a KeyboardEvent (for the "record shortcut" feature).
 * Returns null for a bare modifier press (Shift/Ctrl/Alt/Meta alone) so the
 * recorder keeps waiting until a real key is struck.
 */
export function eventToCombo(e: KeyboardEvent): string | null {
  if (["Control", "Shift", "Alt", "Meta", "OS", "AltGraph"].includes(e.key)) return null;
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push("Mod");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  parts.push(displayKey(e.key));
  return parts.join("+");
}
