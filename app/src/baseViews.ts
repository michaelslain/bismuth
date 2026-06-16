// app/src/baseViews.ts
// The base "views" a user can create from the "New Base ▸" menu — surfaced in both
// the folder context menu (FileTree) and the toolbar "+" chooser (App). A base is a
// `type: base` markdown file whose frontmatter picks a view; FileView routes it to
// BaseView. Listing every view kind here keeps the two menus in sync and is the one
// place the labels/icons/templates live (mirrors core's VIEW_TYPES, docs/bases).

export interface BaseViewKind {
  /** The Bases `view:` value (a core ViewType). */
  view: string;
  /** Menu label; also the default file-name stem ("Untitled <label>"). */
  label: string;
  /** Lucide icon name (resolved lazily from the full icon registry). */
  icon: string;
}

// Order mirrors the docs' 12 view types: note-family first, then the full-pane
// views (calendar/flashcards), then map + the chart family.
export const BASE_VIEW_KINDS: BaseViewKind[] = [
  { view: "table", label: "Table", icon: "Table" },
  { view: "cards", label: "Cards", icon: "LayoutGrid" },
  { view: "list", label: "List", icon: "List" },
  { view: "bullets", label: "Bullets", icon: "TextQuote" },
  { view: "kanban", label: "Kanban", icon: "SquareKanban" },
  { view: "calendar", label: "Calendar", icon: "Calendar" },
  { view: "flashcards", label: "Flashcards", icon: "Layers" },
  { view: "map", label: "Map", icon: "Map" },
  { view: "bar", label: "Bar chart", icon: "ChartColumn" },
  { view: "line", label: "Line chart", icon: "ChartLine" },
  { view: "stat", label: "Stat", icon: "Sigma" },
  { view: "heatmap", label: "Heatmap", icon: "Grid3x3" },
];

/** Default filename for a freshly-created base of the given view label. */
export const baseFileName = (label: string): string => `Untitled ${label}.md`;

/** Starter frontmatter for a new base of `view`. The `type: base` key is what routes
 *  the file to BaseView (a blank .md would open as a plain note). Calendar stores its
 *  own events in the body, so it gets no `source:`; every other view reads the vault
 *  (`source: notes`) so it renders something immediately, ready for the user to scope. */
export function baseTemplate(view: string): string {
  if (view === "calendar") return `---\ntype: base\nview: calendar\n---\n`;
  return `---\ntype: base\nsource: notes\nview: ${view}\n---\n`;
}
