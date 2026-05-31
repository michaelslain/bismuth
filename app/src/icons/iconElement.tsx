// app/src/icons/iconElement.tsx
//
// Render a Lucide icon into a DOM node for IMPERATIVE call sites (e.g. CodeMirror
// widgets) that build DOM by hand rather than with JSX. Uses Solid's `render` so
// it shares the same registry/Icon as the rest of the app; the returned dispose()
// MUST be called when the host node is torn down to avoid leaking a reactive root.
import { render } from "solid-js/web";
import { Icon } from "./Icon";

export function lucideIconSpan(name: string, size = 14): { el: HTMLSpanElement; dispose: () => void } {
  const el = document.createElement("span");
  el.style.display = "inline-flex";
  el.style.flexShrink = "0";
  const dispose = render(() => <Icon value={name} size={size} />, el);
  return { el, dispose };
}
