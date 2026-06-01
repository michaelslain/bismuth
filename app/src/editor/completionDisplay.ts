// app/src/editor/completionDisplay.ts
// PARENT 2 of the unified popover. CodeMirror owns the autocomplete LIST,
// filtering, and selection — we only restyle it to match the context menu:
//  - icons:false        → drop CM's default glyphs (the stray "∪"/"u" for enums)
//  - optionClass        → tag every <li> so popover.css / Editor theme can style it
//  - addToOptions       → prepend OUR Lucide icon (from the shared kind→icon map)
// Spread this object into each autocompletion({...}) call. It carries NO sources,
// so merging it alongside the real source configs does not conflict.
//
// NOTE: lucideIconMarkup is imported lazily inside the render function (not at the
// top level) so that importing this module in test environments — which have no DOM
// and no Solid client context — does not trigger lucide-solid's client-only APIs.
import type { Completion } from "@codemirror/autocomplete";
import { completionIcon } from "../ui/popover/iconMap";

export const completionDisplayConfig = {
  icons: false as const,
  optionClass: (_c: Completion) => "oa-cm-option",
  addToOptions: [
    {
      position: 20, // before the label (CM label block is at 50)
      render(completion: Completion): Node | null {
        const span = document.createElement("span");
        span.className = "oa-popover-icon oa-cm-icon";
        // Dynamic import keeps the lucide-solid dependency out of the module's static
        // evaluation path, so test environments (no DOM / no Solid client) stay clean.
        import("../icons/iconMarkup").then(({ lucideIconMarkup }) => {
          const markup = lucideIconMarkup(completionIcon(completion.type), 14);
          if (markup) span.innerHTML = markup;
        });
        // Return the span immediately; the icon fills in asynchronously once the
        // dynamic import resolves (first call) or from cache (subsequent calls).
        return span;
      },
    },
  ],
};
