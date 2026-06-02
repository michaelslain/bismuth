// app/src/ui/Chip.tsx
// A selectable pill — the canonical "toggle button" the redesign needs in several
// places the views previously rolled by hand: export Format/Page-size/Theme options
// (.fopt) and the Search match-case/whole-word/regex toggles (.srtoggle). `tone`
// tints the SELECTED state (e.g. teal for the search toggles); default is accent.
import { type JSX, Show } from "solid-js";
import { Icon } from "../icons/Icon";
import "./ui.css";

export type ChipTone = "accent" | "teal" | "blue" | "violet" | "green" | "gold" | "rose";

export function Chip(props: {
  tone?: ChipTone;
  selected?: boolean;
  icon?: string;
  iconSize?: number;
  title?: string;
  onClick?: (e: MouseEvent) => void;
  children?: JSX.Element;
}) {
  return (
    <button
      type="button"
      class="chip-toggle"
      classList={{ selected: !!props.selected, [`tone-${props.tone ?? "accent"}`]: true }}
      title={props.title}
      onClick={(e) => props.onClick?.(e)}
    >
      <Show when={props.icon}>{(i) => <Icon value={i()} size={props.iconSize ?? 14} />}</Show>
      {props.children}
    </button>
  );
}
