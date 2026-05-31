import { For, type JSX } from "solid-js";
import { Button, type ButtonSize, type ButtonVariant } from "./Button";
import "./ui.css";

export type SegmentedOption<T> = { id: T; label: JSX.Element; title?: string };

export type SegmentedToggleProps<T> = {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Button variant for each segment (default "ghost"). */
  variant?: ButtonVariant;
  size?: ButtonSize;
  class?: string;
  /** Per-segment extra class (e.g. an underline-tab look). */
  segmentClass?: string;
};

/**
 * A row of mutually-exclusive buttons where the selected one is highlighted.
 * Replaces the three separate reimplementations: GraphView's inline
 * getBtnStyle mode/2D-3D rows, the calendar view switcher, and BaseView's tabs.
 */
export function SegmentedToggle<T>(props: SegmentedToggleProps<T>) {
  return (
    <div class={`segmented ${props.class ?? ""}`}>
      <For each={props.options}>
        {(opt) => (
          <Button
            variant={props.variant ?? "ghost"}
            size={props.size}
            active={opt.id === props.value}
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
