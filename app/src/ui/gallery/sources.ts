// app/src/ui/gallery/sources.ts
// The concrete gallery sources. Each adapts an existing dataset (the Lucide icon
// registry, the emoji search) to the generic GallerySource contract — so the
// SymbolGallery modal renders both without knowing which it's showing.
import { allIcons } from "../../icons/registry";
import { searchEmoji } from "../../editor/emoji";
import type { GallerySource, GalleryItem } from "./types";

// Cap rendered cells: there are ~1700 icons; rendering all SVGs at once janks.
// Search narrows the set, so the cap only bites on the unfiltered view.
const MAX_CELLS = 300;

/** Every Lucide icon, prefix-matches first then substring — value = icon name. */
export const iconSource: GallerySource = {
  placeholder: "Search icons…",
  search(query: string) {
    const q = query.trim().toLowerCase();
    const all = allIcons();
    if (!q) {
      return { items: all.slice(0, MAX_CELLS).map(iconItem), total: all.length };
    }
    const starts: typeof all = [];
    const includes: typeof all = [];
    for (const e of all) {
      const n = e.name.toLowerCase();
      if (n.startsWith(q)) starts.push(e);
      else if (n.includes(q)) includes.push(e);
    }
    const ranked = starts.concat(includes);
    return { items: ranked.slice(0, MAX_CELLS).map(iconItem), total: ranked.length };
  },
};

const iconItem = (e: { name: string }): GalleryItem => ({ id: e.name, label: e.name, value: e.name });

/** Emoji + special characters, ranked by the shared emoji search — value = the glyph.
 *  searchEmoji already ranks (popularity + fuzzy) and dedupes by glyph, so total is
 *  just the returned count (no "showing X of Y" hint needed — it's all there is). */
export const emojiSource: GallerySource = {
  placeholder: "Search emoji…",
  search(query: string) {
    const list = searchEmoji(query, MAX_CELLS);
    const items: GalleryItem[] = list.map((e) => ({
      id: e.name,
      label: e.name.replace(/_/g, " "),
      value: e.char,
    }));
    return { items, total: items.length };
  },
};
