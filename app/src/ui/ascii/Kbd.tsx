// app/src/ui/ascii/Kbd.tsx
// Keybinding display: the command palette, overlay footers, menu rows, and the
// status bar all build on this. A keybinding is a run of individual caps
// (`.asc-key`), not one box — adjacency is the chord. Ported from
// design-system/components/display/Kbd.jsx.
import { For, Show, type JSX } from "solid-js";
import { parseCombo } from "./parseCombo";
import "../ui.css";

/** One key cap. */
export function Key(props: { children?: JSX.Element }) {
  return <span class="asc-key">{props.children}</span>;
}

export type KbdProps = {
  /** The app's keybinding syntax: "Mod+Shift+D", or "Mod+`, Mod+J" for a sequence. */
  combo?: string;
  /** Literal cap content when you aren't passing a combo. */
  children?: JSX.Element;
  muted?: boolean;
};

/**
 * A keybinding. Pass `combo` in the app's syntax ("Mod+Shift+D") or literal
 * children. Chords render as adjacent caps; a comma-separated sequence renders
 * its groups separated by a faint "then".
 */
export function Kbd(props: KbdProps) {
  return (
    <span class="asc-kbd" classList={{ muted: !!props.muted }}>
      <Show when={props.combo} fallback={props.children}>
        <For each={parseCombo(props.combo)}>
          {(keys, gi) => (
            <>
              <Show when={gi() > 0}>
                <span class="asc-kbd-then">then</span>
              </Show>
              <For each={keys}>{(k) => <Key>{k}</Key>}</For>
            </>
          )}
        </For>
      </Show>
    </span>
  );
}

export type KbdHintProps = { combo?: string; keys?: JSX.Element; children?: JSX.Element };

/** A labelled hint: caps followed by what they do. The status-bar / palette-footer unit. */
export function KbdHint(props: KbdHintProps) {
  return (
    <span class="asc-kbd-hint">
      <Kbd combo={props.combo}>{props.keys}</Kbd>
      <span class="asc-kbd-desc">{props.children}</span>
    </span>
  );
}

export type KbdHintsProps = {
  items: { combo?: string; keys?: JSX.Element; label: string }[];
  class?: string;
};

/** A row of hints — the bottom bar and every overlay footer are built from this. */
export function KbdHints(props: KbdHintsProps) {
  return (
    <span class={"asc-kbd-hints" + (props.class ? ` ${props.class}` : "")}>
      <For each={props.items}>
        {(it) => (
          <KbdHint combo={it.combo} keys={it.keys}>
            {it.label}
          </KbdHint>
        )}
      </For>
    </span>
  );
}
