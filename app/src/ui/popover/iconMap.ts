// app/src/ui/popover/iconMap.ts
// Maps a CodeMirror completion `type` (or a menu kind) to a Lucide icon NAME.
// Both popover surfaces (context menu + autocomplete) resolve their icon through
// this one table so a "tag" looks identical whether right-clicked or typed.
const ICONS: Record<string, string> = {
  property: "Tag",     // a settings/frontmatter key
  keyword: "Hash",     // icon names, reserved words
  note: "File",        // wikilink target
  tag: "Hash",         // #tag
  emoji: "Smile",
  modifier: "Command", // a keybind modifier (Mod/Alt/Shift) in the shortcut autocomplete
  key: "Keyboard",     // a keybind key (A, Enter, ArrowLeft…)
  record: "Circle",    // the "record shortcut" action in the keybind autocomplete
};

// Kinds that get NO icon. Enum values (2d | 3d, dark | light) are a plain choice
// from a fixed set — an icon there is meaningless and the "list" glyph reads like
// a stray hamburger-menu, so we render the row icon-less.
const NO_ICON = new Set(["enum"]);

/** Lucide name for a completion/menu kind, or null when the kind gets no icon. */
export function completionIcon(type: string | null | undefined): string | null {
  if (type && NO_ICON.has(type)) return null;
  return (type && ICONS[type]) || "ChevronRight";
}
