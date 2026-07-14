import { createSignal, Show, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";
import { PopoverList } from "./popover/PopoverList";
import { createMenuNav } from "./popover/createMenuNav";
import { Icon } from "../icons/Icon";
import "./ui.css";
import "./popover/popover.css";

/** `detail` renders as the muted right-side text on the option's row (MenuRow detail) — e.g. the
 *  chat model picker's Free/Paid badge. The closed trigger shows only the label. */
export type SelectOption = { value: string; label: string; detail?: string };

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
  /** Fired when the popover closes WITHOUT a choice — Escape or a backdrop click — as
   *  opposed to `close()` after `choose()`, which already reported the new value via
   *  `onChange`. Lets a caller that swaps in a Select as a transient editor (the kanban
   *  meta chip editor) restore its own read-only state on a plain dismiss, matching the
   *  Escape-to-cancel behavior of its sibling text/number/date inputs. Optional — callers
   *  that don't host a transient editor (e.g. a settings row) can ignore it. */
  onDismiss?: () => void;
}) {
  const [open, setOpen] = createSignal(false);
  const [pos, setPos] = createSignal({ x: 0, y: 0, w: 0 });
  let triggerRef: HTMLButtonElement | undefined;

  const current = () => props.options.find((o) => o.value === props.value);

  const nav = createMenuNav({
    count: () => props.options.length,
    onSelect: (i) => choose(i),
    onEscape: () => dismiss(),
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
  /** Close WITHOUT a selection — Escape or a backdrop click. */
  function dismiss() {
    close();
    props.onDismiss?.();
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
          <div class="ui-select-backdrop" onClick={() => dismiss()} />
          <PopoverList
            items={props.options.map((o) => ({ label: o.label, detail: o.detail, icon: o.value === props.value ? "Check" : undefined }))}
            active={nav.active()}
            onActivate={choose}
            onHover={nav.setActive}
            class="ui-select-list"
            style={{ top: `${pos().y}px`, left: `${pos().x}px`, "min-width": `${pos().w}px` }}
          />
        </Portal>
      </Show>
    </>
  );
}
