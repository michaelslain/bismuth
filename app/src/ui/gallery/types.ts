// app/src/ui/gallery/types.ts
// The data contract shared by every gallery (icons, emoji, and any future symbol
// set). A SymbolGallery (the grid+search modal) is driven entirely by a GallerySource,
// so the modal code is written ONCE and each gallery is just a different source.
// Both icon names and emoji glyphs render through <Icon value=…/>, so an item only
// needs the string to insert — the modal renders it the same way regardless of kind.

/** One cell in the gallery grid. `value` is both what renders (<Icon value/>) and
 *  what's inserted on pick. `label` is the hover tooltip / accessible name. */
export type GalleryItem = { id: string; label: string; value: string };

/** A searchable symbol set. `search` returns the ranked, already-capped items for a
 *  query (""=a sensible default set) plus the pre-cap `total` for the "showing X of Y"
 *  hint. Keeping ranking inside the source is what lets the modal stay generic. */
export type GallerySource = {
  /** Search-box placeholder, e.g. "Search icons…". */
  placeholder: string;
  search: (query: string) => { items: GalleryItem[]; total: number };
};
