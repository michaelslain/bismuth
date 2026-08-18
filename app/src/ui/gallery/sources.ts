// app/src/ui/gallery/sources.ts
// The concrete gallery sources. Each adapts an existing dataset (the icon registry —
// Lucide-named but backed by hand-authored pixel art, see icons/registry.ts — and the
// emoji search) to the generic GallerySource contract — so the SymbolGallery modal
// renders both without knowing which it's showing.
import { allIcons } from '../../icons/registry'
import { searchEmoji } from '../../editor/emoji'
import type { GallerySource, GalleryItem } from './types'

// Cap rendered cells so a large source can't jank the grid by painting every item at once.
// The icon set is ~112 and so never reaches this; the emoji source does. (The cap was sized for
// the ~1,700-icon Lucide set this used to import — kept because emoji still needs it.)
const MAX_CELLS = 300

/** Every icon (Lucide-style name), prefix-matches first then substring — value = icon name. */
export const iconSource: GallerySource = {
    placeholder: 'Search icons…',
    search(query: string) {
        const q = query.trim().toLowerCase()
        const all = allIcons()
        if (!q) {
            return {
                items: all.slice(0, MAX_CELLS).map(iconItem),
                total: all.length,
            }
        }
        const starts: typeof all = []
        const includes: typeof all = []
        for (const e of all) {
            const n = e.name.toLowerCase()
            if (n.startsWith(q)) starts.push(e)
            else if (n.includes(q)) includes.push(e)
        }
        const ranked = starts.concat(includes)
        return {
            items: ranked.slice(0, MAX_CELLS).map(iconItem),
            total: ranked.length,
        }
    },
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
