import { splitProps, type JSX } from "solid-js";
import { Icon } from "../icons/Icon";
import { searchBarClass } from "./buttonClass";
import "./ui.css";

export type SearchBarProps = {
  value: string;
  onInput: (value: string) => void;
  placeholder?: string;
  onEnter?: () => void;
  leadingIcon?: string;
  autofocus?: boolean;
  inputRef?: (el: HTMLInputElement) => void;
  /** Trailing adornments (toggles, buttons) rendered after the input. */
  children?: JSX.Element;
  class?: string;
};

export function SearchBar(props: SearchBarProps) {
  const [local] = splitProps(props, [
    "value", "onInput", "placeholder", "onEnter", "leadingIcon", "autofocus", "inputRef", "children", "class",
  ]);
  return (
    <div class={searchBarClass(local.class)}>
      <Icon value={local.leadingIcon ?? "Search"} size={16} class="search-bar-lead" />
      <input
        ref={local.inputRef}
        class="search-bar-input"
        placeholder={local.placeholder}
        value={local.value}
        autofocus={local.autofocus}
        onInput={(e) => local.onInput(e.currentTarget.value)}
        onKeyDown={(e) => { if (e.key === "Enter") local.onEnter?.(); }}
      />
      {local.children}
    </div>
  );
}
