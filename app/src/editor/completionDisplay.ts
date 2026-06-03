// app/src/editor/completionDisplay.ts
// PARENT 2 of the unified popover. CodeMirror owns the autocomplete LIST,
// filtering, and selection — we only restyle it to match the context menu:
//  - icons:false        → drop CM's default glyphs (the stray "∪"/"u" for enums)
//  - addToOptions       → prepend OUR Lucide icon (from the shared kind→icon map)
// Spread this object into each autocompletion({...}) call. It carries NO sources,
// so merging it alongside the real source configs does not conflict.
//
// The icon span comes from the shared rowDom helper (createPopoverIcon), the same
// builder the yaml-fix hover uses, so the autocomplete's icon DOM matches the menu's.
import type { Completion } from "@codemirror/autocomplete";
import { completionIcon } from "../ui/popover/iconMap";
import { createPopoverIcon } from "../ui/popover/rowDom";

export const completionDisplayConfig = {
  icons: false as const,
  addToOptions: [
    {
      position: 20, // before the label (CM label block is at 50)
      render(completion: Completion): Node | null {
        // Resolve the icon NAME synchronously (pure, no DOM). A null name means the
        // kind gets no icon (e.g. enum) — return null so there's no empty slot/gap.
        const name = completionIcon(completion.type);
        if (!name) return null;
        // Returns immediately; the Lucide SVG fills in once the lazy chunk resolves.
        return createPopoverIcon(name);
      },
    },
  ],
};
