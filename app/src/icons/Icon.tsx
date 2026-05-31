// app/src/icons/Icon.tsx
//
// The one component every call site uses to show an icon. Pass a `value` (a
// Lucide name, the legacy "Li"/"Lu" convention, or an emoji) and it renders a
// Lucide SVG when the value names one, otherwise the raw glyph as text. This is
// what lets a note's `icon: 🪶` keep showing the feather while `icon: House`
// becomes a line icon — no migration needed.
//
// SVGs inherit `currentColor`, so icons pick up the surrounding text color and
// theme automatically.
import { Show, type Component } from "solid-js";
import { Dynamic } from "solid-js/web";
import { resolveIcon } from "./registry";

export interface IconProps {
  /** Lucide name (any casing, optional Li/Lu prefix) OR an emoji / arbitrary string. */
  value: string | null | undefined;
  /** Pixel size of the SVG (default 16). Ignored when rendering raw text. */
  size?: number;
  /** Lucide stroke width (default 1.75 — a touch lighter than Lucide's 2). */
  strokeWidth?: number;
  /** Applied to both the SVG and the text-fallback span. */
  class?: string;
  /** Used when `value` is empty/null (resolved the same way as `value`). */
  fallback?: string;
}

export const Icon: Component<IconProps> = (props) => {
  const spec = () => {
    const v = props.value?.trim();
    return v ? v : props.fallback ?? "";
  };
  const comp = () => resolveIcon(spec());
  return (
    <Show
      when={comp()}
      fallback={
        <span class={props.class} aria-hidden="true">
          {spec()}
        </span>
      }
    >
      {(C) => (
        <Dynamic
          component={C()}
          size={props.size ?? 16}
          stroke-width={props.strokeWidth ?? 1.75}
          class={props.class}
        />
      )}
    </Show>
  );
};
