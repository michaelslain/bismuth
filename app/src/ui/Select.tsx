import { createSignal, Show, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";
import { PopoverList } from "./popover/PopoverList";
import { createMenuNav } from "./popover/createMenuNav";
import { Icon } from "../icons/Icon";
import "./ui.css";
import "./popover/popover.css";

export type SelectOption = { value: string; label: string };

/**
 * A custom dropdown that replaces the native `<select>`. The trigger reuses the
 * `.ui-input` chrome (so it matches TextInput); the open list is the shared
 * `<PopoverList>` surface (same chrome as the context menu + autocomplete) with
 * `createMenuNav` for keyboard. Portaled to <body> so it escapes the modal's
 * overflow and layers above the modal overlay.
 */
export function Select(props: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  class?: string;
}) {
  const [open, setOpen] = createSignal(false);
  const [pos, setPos] = createSignal({ x: 0, y: 0, w: 0 });
  let triggerRef: HTMLButtonElement | undefined;

  const current = () => props.options.find((o) => o.value === props.value);

  const nav = createMenuNav({
    count: () => props.options.length,
    onSelect: (i) => choose(i),
    onEscape: () => close(),
    wrap: true,
  });

  function openMenu() {
    if (!triggerRef) return;
    const r = triggerRef.getBoundingClientRect();
    setPos({ x: r.left, y: r.bottom + 4, w: r.width });
    const idx = props.options.findIndex((o) => o.value === props.value);
    nav.setActive(idx >= 0 ? idx : 0);
    setOpen(true);
  }
  function close() {
    setOpen(false);
    triggerRef?.focus();
  }
  function choose(i: number) {
    const opt = props.options[i];
    if (opt) props.onChange(opt.value);
    close();
  }

  // Reposition on scroll/resize while open (the trigger lives in a scrollable modal).
  const reposition = () => {
    if (!open() || !triggerRef) return;
    const r = triggerRef.getBoundingClientRect();
    setPos({ x: r.left, y: r.bottom + 4, w: r.width });
  };
  window.addEventListener("resize", reposition);
  window.addEventListener("scroll", reposition, true);
  onCleanup(() => {
    window.removeEventListener("resize", reposition);
    window.removeEventListener("scroll", reposition, true);
  });

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        class={`ui-input ui-select-trigger ${props.class ?? ""}`}
        onClick={() => (open() ? close() : openMenu())}
        onKeyDown={(e) => {
          if (open()) {
            // Keep Enter/Escape/arrows from reaching the modal's own handlers.
            e.stopPropagation();
            nav.onKeyDown(e);
          } else if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            openMenu();
          }
        }}
      >
        <span class="ui-select-value" classList={{ "ui-select-placeholder": !current() }}>
          {current()?.label ?? props.placeholder ?? "Select…"}
        </span>
        <Icon value="ChevronDown" size={14} class="ui-select-caret" />
      </button>
      <Show when={open()}>
        <Portal>
          <div class="ui-select-backdrop" onClick={() => close()} />
          <PopoverList
            items={props.options.map((o) => ({ label: o.label, icon: o.value === props.value ? "Check" : undefined }))}
            active={nav.active()}
            onActivate={choose}
            onHover={nav.setActive}
            style={{ position: "fixed", top: `${pos().y}px`, left: `${pos().x}px`, "min-width": `${pos().w}px`, "z-index": 1100 }}
          />
        </Portal>
      </Show>
    </>
  );
}
