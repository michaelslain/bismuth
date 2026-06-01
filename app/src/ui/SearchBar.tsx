import { splitProps, type JSX } from "solid-js";
import { Icon } from "../icons/Icon";
import { searchBarClass } from "./buttonClass";
import "./ui.css";

export type SearchBarProps = {
  value: string;
  onInput: (value: string) => void;
  placeholder?: string;
  /** Convenience: called on Enter. Ignored if `onKeyDown` is provided (use that for full key handling). */
  onEnter?: () => void;
  /** Full keydown passthrough on the input — for list-navigation search boxes (arrows/escape/enter). Takes precedence over `onEnter`. */
  onKeyDown?: (e: KeyboardEvent) => void;
  leadingIcon?: string;
  autofocus?: boolean;
  inputRef?: (el: HTMLInputElement) => void;
  /** Trailing adornments (toggles, buttons) rendered after the input. */
  children?: JSX.Element;
  /** Class on the outer `.search-bar` wrapper. */
  class?: string;
  /** Extra class on the inner `<input>` (for call-site-specific input styling). */
  inputClass?: string;
  /** Inline style on the inner `<input>`. */
  inputStyle?: JSX.CSSProperties | string;
};

export function SearchBar(props: SearchBarProps) {
  const [local] = splitProps(props, [
    "value", "onInput", "placeholder", "onEnter", "onKeyDown", "leadingIcon",
    "autofocus", "inputRef", "children", "class", "inputClass", "inputStyle",
  ]);
  return (
    <div class={searchBarClass(local.class)}>
      <Icon value={local.leadingIcon ?? "Search"} size={16} class="search-bar-lead" />
      <input
        ref={local.inputRef}
        class={local.inputClass ? `search-bar-input ${local.inputClass}` : "search-bar-input"}
        style={local.inputStyle}
        placeholder={local.placeholder}
        value={local.value}
        autofocus={local.autofocus}
        onInput={(e) => local.onInput(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (local.onKeyDown) local.onKeyDown(e);
          else if (e.key === "Enter") local.onEnter?.();
        }}
      />
      {local.children}
    </div>
  );
}
