// app/src/ui/popover/iconMap.ts
// Maps a CodeMirror completion `type` (or a menu kind) to a Lucide icon NAME.
// Both popover surfaces (context menu + autocomplete) resolve their icon through
// this one table so a "tag" looks identical whether right-clicked or typed.
const ICONS: Record<string, string> = {
  enum: "List",        // a fixed set of values (e.g. 2d | 3d)
  property: "Tag",     // a settings/frontmatter key
  keyword: "Hash",     // icon names, reserved words
  note: "File",        // wikilink target
  tag: "Hash",         // #tag
  emoji: "Smile",
};

/** Lucide name for a completion/menu kind; ChevronRight for anything unknown. */
export function completionIcon(type: string | null | undefined): string {
  return (type && ICONS[type]) || "ChevronRight";
}
