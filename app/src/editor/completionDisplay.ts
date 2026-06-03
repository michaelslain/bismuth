// app/src/editor/completionDisplay.ts
// PARENT 2 of the unified popover. CodeMirror owns the autocomplete LIST,
// filtering, and selection — we only restyle it to match the context menu:
//  - icons:false        → drop CM's default glyphs (the stray "∪"/"u" for enums)
//  - addToOptions       → prepend OUR Lucide icon (from the shared kind→icon map)
// Spread this object into each autocompletion({...}) call. It carries NO sources,
// so merging it alongside the real source configs does not conflict.
//
// NOTE: lucideIconMarkup is imported lazily inside the render function (not at the
// top level) so that importing this module in test environments — which have no DOM
// and no Solid client context — does not trigger lucide-solid's client-only APIs.
import type { Completion } from "@codemirror/autocomplete";
import { completionIcon } from "../ui/popover/iconMap";

/** A completion that overrides its row glyph with a specific Lucide icon NAME
 *  (instead of deriving it from `type`). Used for icon-name suggestions (each row
 *  shows its own icon) and path suggestions (Folder vs File). `lucideIcon` is read
 *  by the render hook below; CM ignores unknown fields. */
export type IconedCompletion = Completion & { lucideIcon?: string };

export const completionDisplayConfig = {
  icons: false as const,
  addToOptions: [
    {
      position: 20, // before the label (CM label block is at 50)
      render(completion: Completion): Node | null {
        // A per-row icon override (lucideIcon) wins over the kind→icon map — that's
        // how an icon-name row shows its OWN icon and a path row shows Folder/File.
        // Resolve the icon NAME synchronously (pure, no DOM). A null name means the
        // kind gets no icon (e.g. enum) — return null so there's no empty slot/gap.
        const name = (completion as IconedCompletion).lucideIcon ?? completionIcon(completion.type);
        if (!name) return null;
        const span = document.createElement("span");
        span.className = "oa-popover-icon";
        // Dynamic import keeps the lucide-solid dependency out of the module's static
        // evaluation path, so test environments (no DOM / no Solid client) stay clean.
        import("../icons/iconMarkup")
          .then(({ lucideIconMarkup }) => {
            const markup = lucideIconMarkup(name, 14);
            if (markup) span.innerHTML = markup;
          })
          .catch(() => {}); // chunk-load failure → degrade to an icon-less row
        // Return the span immediately; the icon fills in asynchronously once the
        // dynamic import resolves (first call) or from cache (subsequent calls).
        return span;
      },
    },
  ],
};
