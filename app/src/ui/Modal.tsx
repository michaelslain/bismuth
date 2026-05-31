import { onCleanup, onMount, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import "./ui.css";

export type ModalProps = {
  onClose: () => void;
  /** Class for the inner panel (e.g. "event-modal", "recurrence-dialog"). */
  class?: string;
  /** Close when the backdrop (outside the panel) is clicked. Default true. */
  closeOnBackdrop?: boolean;
  children: JSX.Element;
};

/**
 * Shared overlay shell: a Portal-mounted backdrop that closes on Escape and
 * (optionally) on backdrop click, with the inner panel stopping propagation.
 * Replaces the hand-rolled `.modal-overlay > panel` + Escape-keydown blocks that
 * EventModal / RecurrenceDialog / CategoryPanel / PaletteModal each reimplemented.
 */
export function Modal(props: ModalProps) {
  const handleKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      props.onClose();
    }
  };
  onMount(() => window.addEventListener("keydown", handleKey));
  onCleanup(() => window.removeEventListener("keydown", handleKey));

  return (
    <Portal>
      <div
        class="ui-overlay"
        onClick={() => {
          if (props.closeOnBackdrop !== false) props.onClose();
        }}
      >
        <div class={props.class} onClick={(e) => e.stopPropagation()}>
          {props.children}
        </div>
      </div>
    </Portal>
  );
}
