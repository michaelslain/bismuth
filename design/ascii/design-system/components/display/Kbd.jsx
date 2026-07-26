import React from "react";

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || "");

/** Modifier → glyph, mirroring app/src/palette/CommandPalette.tsx formatShortcut(). */
const TOKEN = {
  Mod: () => (IS_MAC ? "\u2318" : "Ctrl"),
  Cmd: () => "\u2318", Meta: () => "\u2318", Ctrl: () => "Ctrl",
  Alt: () => (IS_MAC ? "\u2325" : "Alt"),
  Option: () => "\u2325",
  Shift: () => (IS_MAC ? "\u21E7" : "Shift"),
  Enter: () => "\u21B5", Return: () => "\u21B5",
  Backspace: () => "\u232B", Delete: () => "\u232B",
  Escape: () => "esc", Esc: () => "esc",
  Tab: () => "\u21E5", Space: () => "space",
  Up: () => "\u2191", Down: () => "\u2193", Left: () => "\u2190", Right: () => "\u2192",
};

/**
 * Split a stored combo into display caps. Accepts the app's keybinding syntax:
 *   "Mod+Shift+D"        → ["⌘","⇧","D"]        a chord
 *   "Mod+`, Mod+J"       → [["⌘","`"], ["⌘","J"]]  a sequence (comma-separated)
 */
export function parseCombo(combo) {
  return String(combo || "")
    .split(",")
    .map((part) => part.trim()).filter(Boolean)
    .map((part) => part.split("+").map((t) => {
      const k = t.trim();
      return TOKEN[k] ? TOKEN[k]() : k;
    }));
}

/** One key cap. */
export function Key({ children }) {
  return <span className="asc-key">{children}</span>;
}

/**
 * A keybinding. Pass `combo` in the app's syntax ("Mod+Shift+D") or literal
 * children. Chords render as adjacent caps; a comma-separated sequence renders
 * its groups separated by a faint "then".
 */
export function Kbd({ combo, children, muted }) {
  if (!combo) return <span className={"asc-kbd" + (muted ? " muted" : "")}>{children}</span>;
  const groups = parseCombo(combo);
  return (
    <span className={"asc-kbd" + (muted ? " muted" : "")}>
      {groups.map((keys, gi) => (
        <React.Fragment key={gi}>
          {gi > 0 ? <span className="asc-kbd-then">then</span> : null}
          {keys.map((k, i) => <Key key={i}>{k}</Key>)}
        </React.Fragment>
      ))}
    </span>
  );
}

/** A labelled hint: caps followed by what they do. The status-bar / palette-footer unit. */
export function KbdHint({ combo, keys, children }) {
  return (
    <span className="asc-kbd-hint">
      <Kbd combo={combo}>{keys}</Kbd>
      <span className="asc-kbd-desc">{children}</span>
    </span>
  );
}

/** A row of hints — the bottom bar and every overlay footer are built from this. */
export function KbdHints({ items = [], className }) {
  return (
    <span className={["asc-kbd-hints", className].filter(Boolean).join(" ")}>
      {items.map((it) => (
        <KbdHint key={it.label} combo={it.combo} keys={it.keys}>{it.label}</KbdHint>
      ))}
    </span>
  );
}
