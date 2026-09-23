// app/src/ui/gallery/sources.ts
// The concrete gallery sources. Each adapts an existing dataset (the full Phosphor icon library —
// see icons/registry.ts + icons/iconLibrary.ts — and the emoji search) to the generic
// GallerySource contract — so the SymbolGallery modal renders both without knowing which it's
// showing.
import { libraryIconList, type LibraryIcon } from '../../icons/registry'
import { iconLibraryState, loadIconLibrary } from '../../icons/iconLibrary'
import { searchEmoji } from '../../editor/emoji'
import type { GallerySource, GalleryItem } from './types'

// Cap rendered cells so a large source can't jank the grid by painting every item at once. The
// icon library (~1,500) and emoji both reach it; the "showing X of Y" hint covers the rest.
const MAX_CELLS = 300

/** Every Phosphor icon (empty query: the app's own icons first), ranked: name prefix, then name substring, then a search-term hit (the
 *  set's own tags — "library" finds Books — and the app's canonical aliases — "bot" finds Robot).
 *  value = the library name, which is what gets written to `icon:`. Reads the library's load
 *  signal, so the gallery's memo re-runs when the lazily-loaded chunk lands. */
export const iconSource: GallerySource = {
    placeholder: 'Search icons…',
    search(query: string) {
        const state = iconLibraryState()
        if (state !== 'loaded') {
            void loadIconLibrary()
            return { items: [], total: 0, loading: state !== 'failed' }
        }
        const ranked = rankIcons(libraryIconList(), query)
        return {
            items: ranked.slice(0, MAX_CELLS).map(iconItem),
            total: ranked.length,
        }
    },
}

/** Pure ranking over library icons — exported for the unit test. */
export function rankIcons(all: LibraryIcon[], query: string): LibraryIcon[] {
    const q = query.trim().toLowerCase()
    // On open, the icons the app itself uses come first (a familiar screen, not a wall of
    // `ArrowBendDownLeft`…), then the rest of the library, each half alphabetical.
    if (!q) return all.filter(e => e.core).concat(all.filter(e => !e.core))
    const starts: LibraryIcon[] = []
    const includes: LibraryIcon[] = []
    const tagged: LibraryIcon[] = []
    const qWords = q.split(/\s+/)
    for (const e of all) {
        const n = e.name.toLowerCase()
        if (n.startsWith(q)) starts.push(e)
        else if (n.includes(q.replace(/[\s-]+/g, ''))) includes.push(e)
        else if (qWords.every(w => e.terms.includes(w))) tagged.push(e)
    }
    return starts.concat(includes, tagged)
}

const iconItem = (e: { name: string }): GalleryItem => ({
    id: e.name,
    label: e.name,
    value: e.name,
})

/** Emoji + special characters, ranked by the shared emoji search — value = the glyph.
 *  searchEmoji already ranks (popularity + fuzzy) and dedupes by glyph, so total is
 *  just the returned count (no "showing X of Y" hint needed — it's all there is). */
export const emojiSource: GallerySource = {
    placeholder: 'Search emoji…',
    search(query: string) {
        const list = searchEmoji(query, MAX_CELLS)
        const items: GalleryItem[] = list.map(e => ({
            id: e.name,
            label: e.name.replace(/_/g, ' '),
            value: e.char,
        }))
        return { items, total: items.length }
    },
}
