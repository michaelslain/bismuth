/**
 * Keybinding display. Renders each key as its own hairline cap; modifiers use the
 * platform glyphs (⌘ ⌥ ⇧ ↵ ⌫ esc) exactly as app/src/palette/CommandPalette.tsx
 * formats them. This is the ONLY place unicode glyphs are allowed in chrome.
 *
 * @startingPoint section="Display" subtitle="Key caps, chords and hint rows" viewport="700x200"
 */
export interface KbdProps {
  /** The app's keybinding syntax: "Mod+Shift+D", or "Mod+`, Mod+J" for a sequence. */
  combo?: string;
  /** Literal cap content when you aren't passing a combo. */
  children?: React.ReactNode;
  muted?: boolean;
}
export declare function Kbd(props: KbdProps): JSX.Element;
export declare function Key(props: { children?: React.ReactNode }): JSX.Element;
export declare function parseCombo(combo: string): string[][];

export interface KbdHintProps { combo?: string; keys?: React.ReactNode; children?: React.ReactNode; }
/** Caps + what they do — the unit the status bar and overlay footers repeat. */
export declare function KbdHint(props: KbdHintProps): JSX.Element;

export interface KbdHintsProps {
  items: { combo?: string; keys?: React.ReactNode; label: string }[];
  className?: string;
}
export declare function KbdHints(props: KbdHintsProps): JSX.Element;
