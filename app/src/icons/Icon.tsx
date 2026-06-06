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
//
// Boot behaviour: only a small core of icons is bundled in the entry chunk; the
// full ~1,700-icon manifest loads lazily (see registry.ts). An icon-NAME that
// isn't in the core yet would otherwise flash its literal text ("ShareIcon")
// for a beat before the SVG appears. To avoid that we render a blank,
// correctly-sized placeholder while the name is still *pending* the full
// manifest, and kick that load immediately. Emojis / arbitrary glyphs are not
// icon names, so they render as text right away (their final state).
import { Show, createEffect, type Component } from "solid-js";
import { Dynamic } from "solid-js/web";
import { resolveIcon, fullRegistryLoaded, ensureFullRegistry } from "./registry";
import { looksLikeIconName } from "./registry-core";

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
  // An icon-name that hasn't resolved yet is pending the lazy full manifest:
  // show a blank box (no text flash) instead of the literal name. Once the full
  // set is loaded and it still doesn't resolve, it's genuinely not an icon —
  // fall through to rendering the raw glyph/text.
  const pending = () => !comp() && looksLikeIconName(spec()) && !fullRegistryLoaded();
  // Start the full-manifest load as soon as a pending icon is on screen, so the
  // blank window is as short as possible (don't wait for the idle scheduler).
  createEffect(() => {
    if (pending()) ensureFullRegistry();
  });
  return (
    <Show
      when={comp()}
      fallback={
        <Show
          when={pending()}
          fallback={
            <span class={props.class} aria-hidden="true">
              {spec()}
            </span>
          }
        >
          <span
            class={props.class}
            aria-hidden="true"
            style={{
              display: "inline-block",
              width: `${props.size ?? 16}px`,
              height: `${props.size ?? 16}px`,
            }}
          />
        </Show>
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
