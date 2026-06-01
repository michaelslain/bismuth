import { For, type JSX } from "solid-js";
import { Button, type ButtonSize } from "./Button";
import "./ui.css";

export type SegmentedOption<T> = { id: T; label: JSX.Element; title?: string };

export type SegmentedToggleProps<T> = {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (id: T) => void;
  size?: ButtonSize;
  class?: string;
  /** Per-segment extra class (e.g. an underline-tab look). */
  segmentClass?: string;
};

/**
 * A row of mutually-exclusive buttons: the active one is `selected`, the rest
 * `unselected`. This is THE canonical selected/unselected consumer — graph mode
 * + 2D/3D rows, the calendar view switcher, and BaseView's tabs.
 */
export function SegmentedToggle<T>(props: SegmentedToggleProps<T>) {
  return (
    <div class={`segmented ${props.class ?? ""}`}>
      <For each={props.options}>
        {(opt) => (
          <Button
            kind="text"
            state={opt.id === props.value ? "selected" : "unselected"}
            size={props.size}
            class={props.segmentClass}
            title={opt.title}
            onClick={() => props.onChange(opt.id)}
          >
            {opt.label}
          </Button>
        )}
      </For>
    </div>
  );
}
