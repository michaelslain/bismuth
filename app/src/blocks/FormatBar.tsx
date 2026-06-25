// app/src/blocks/FormatBar.tsx
// A small selection-anchored formatting toolbar for the Milkdown rich-text blocks. It shows on a
// non-empty text selection inside a `.block-rich` ProseMirror surface and offers:
//   • inline MARKS — Bold / Italic / Code / Link — routed to the bridge's exec() (the same path
//     as the Mod+B/I/E/K keymap), so the selection toggles strong/em/inlineCode/link;
//   • block-TYPE changes — H1 / H2 / H3 / Bullet list — routed to the store (NOT Milkdown):
//     the per-block architecture keeps the block PREFIX (#, -, >) in blockModel, so a heading /
//     list toolbar action changes the BLOCK's type, never wraps a node inside the inline surface.
//
// It's a thin presentational strip: the host (BlockEditor) owns selection tracking + positioning
// and passes the live bridge handle for the focused block plus the block-type callbacks. Pure
// theme-aware styling (BlockEditor.css), built from the shared IconButton so the chrome matches.
import { For } from "solid-js";
import { IconButton } from "../ui/IconButton";
import type { BlockEditorHandle } from "./milkdownEditor";

/** A heading-or-list block-type target the bar can switch the active block to. */
export type FormatBlockKind = "h1" | "h2" | "h3" | "bullet";

export interface FormatBarState {
  /** Screen coords (the selection's top-center) where the bar floats. */
  x: number;
  y: number;
  /** The bridge handle of the block holding the selection — marks route through its exec(). */
  handle: BlockEditorHandle;
  /** Change the active block's TYPE (heading level / bullet list) via the store. */
  onBlockKind: (kind: FormatBlockKind) => void;
}

const MARK_BUTTONS: { cmd: "bold" | "italic" | "code" | "link"; icon: string; label: string }[] = [
  { cmd: "bold", icon: "Bold", label: "Bold (⌘B)" },
  { cmd: "italic", icon: "Italic", label: "Italic (⌘I)" },
  { cmd: "code", icon: "Code", label: "Inline code (⌘E)" },
  { cmd: "link", icon: "Link", label: "Link (⌘K)" },
];

const BLOCK_BUTTONS: { kind: FormatBlockKind; icon: string; label: string }[] = [
  { kind: "h1", icon: "Heading1", label: "Heading 1" },
  { kind: "h2", icon: "Heading2", label: "Heading 2" },
  { kind: "h3", icon: "Heading3", label: "Heading 3" },
  { kind: "bullet", icon: "List", label: "Bullet list" },
];

export function FormatBar(props: { state: FormatBarState }) {
  return (
    <div
      class="block-format-bar"
      style={{ position: "fixed", left: `${props.state.x}px`, top: `${props.state.y}px`, "z-index": 60 }}
      // Keep the editor selection while clicking a button (don't steal focus / collapse it).
      onMouseDown={(e) => e.preventDefault()}
    >
      <For each={MARK_BUTTONS}>
        {(b) => (
          <IconButton
            icon={b.icon}
            label={b.label}
            size="sm"
            onClick={() => props.state.handle.exec(b.cmd)}
          />
        )}
      </For>
      <div class="block-format-sep" />
      <For each={BLOCK_BUTTONS}>
        {(b) => (
          <IconButton
            icon={b.icon}
            label={b.label}
            size="sm"
            onClick={() => props.state.onBlockKind(b.kind)}
          />
        )}
      </For>
    </div>
  );
}
