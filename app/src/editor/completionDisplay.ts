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
import { EditorView } from "@codemirror/view";
import { completionIcon } from "../ui/popover/iconMap";
import { createPopoverIcon } from "../ui/popover/rowDom";

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
        // Returns immediately; the Lucide SVG fills in once the lazy chunk resolves.
        return createPopoverIcon(name);
      },
    },
  ],
};

// The autocomplete popup's look — popover container, list rows, selected row, label/detail,
// and the info tooltip — keyed off the same `--popover-*` tokens the context menu uses. This
// is the SINGLE source of truth for completion styling: both the note editor (Editor.tsx) and
// the card editor (CardEditor.tsx) include it, so any editor that wires up `autocompletion()`
// gets the identical, themed popup rather than CodeMirror's bare default.
export const completionTheme = EditorView.theme({
  // Match .bismuth-popover exactly: same radius, padding, shadow, and UI font tokens —
  // CodeMirror owns this <ul><li> DOM, so we can't share the component, only the tokens.
  ".cm-tooltip.cm-tooltip-autocomplete": {
    border: "1px solid var(--border)",
    borderRadius: "var(--popover-radius)",
    backgroundColor: "var(--bg)",
    boxShadow: "var(--popover-shadow)",
    fontFamily: "var(--popover-font)",
    minWidth: "var(--popover-min-width)",
    overflow: "hidden",
    padding: "var(--popover-pad)",
  },
  // NOTE: two classes (.cm-tooltip.cm-tooltip-autocomplete) so these match CM's
  // own default li rule specificity and win — a single-class selector loses to it.
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
    display: "flex",
    alignItems: "center",
    gap: "var(--popover-row-gap)",
    padding: "var(--popover-row-pad-y) var(--popover-row-pad-x)",
    borderRadius: "var(--popover-row-radius)",
    fontSize: "var(--popover-font-size)",
    lineHeight: "1.5",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--popover-selected-bg)",
    color: "var(--fg)",
  },
  ".cm-completionLabel": { flex: "1 1 auto" },
  ".cm-completionDetail": { marginLeft: "auto", paddingLeft: "12px", opacity: "var(--popover-detail-opacity)", fontStyle: "normal" },
  ".cm-tooltip.cm-completionInfo": {
    border: "1px solid var(--border)",
    borderRadius: "var(--popover-radius)",
    backgroundColor: "var(--bg)",
    color: "var(--fg)",
    boxShadow: "var(--popover-shadow)",
    padding: "8px 10px",
    maxWidth: "320px",
    fontSize: "12px",
    lineHeight: "1.5",
  },
});
