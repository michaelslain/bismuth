// The `--order` spec of `bismuth pdf pages`: comma-separated items, each one of
//   3            page 3 of this pdf
//   2-5          pages 2 to 5 of this pdf (5-2 runs them backwards)
//   blank        an empty page
//   @a/b.png     an image in the vault
//   @a/b.pdf     every page of another pdf in the vault
//   @a/b.pdf#4   page 4 of it (#2-4 for a range)
// Pure, so the grammar is unit-tested without a vault.
import type { PageSource } from '../../core/src/pdfPages'

const range = (a: number, b: number): number[] =>
    a <= b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : Array.from({ length: a - b + 1 }, (_, i) => a - i)

/** `3` or `2-5` as page numbers; null when the text is neither. */
function pagesOf(text: string): number[] | null {
    const m = text.match(/^(\d+)(?:-(\d+))?$/)
    if (!m) return null
    const a = Number(m[1])
    const b = m[2] === undefined ? a : Number(m[2])
    return a < 1 || b < 1 ? null : range(a, b)
}

/** The order a spec names, or an error message. */
export function parsePageOrder(spec: string): { order: PageSource[] } | { error: string } {
    const order: PageSource[] = []
    for (const raw of spec.split(',')) {
        const item = raw.trim()
        if (item === '') return { error: `--order has an empty item: ${spec}` }
        if (item === 'blank') {
            order.push({ blank: true })
        } else if (item.startsWith('@')) {
            const hash = item.indexOf('#')
            const file = (hash < 0 ? item.slice(1) : item.slice(1, hash)).replace(/^\.\//, '')
            if (file === '') return { error: `--order item needs a path after @: ${item}` }
            if (hash < 0) {
                order.push({ file })
                continue
            }
            if (!/\.pdf$/i.test(file)) return { error: `only a pdf takes a #page: ${item}` }
            const pages = pagesOf(item.slice(hash + 1))
            if (!pages) return { error: `#page must look like 4 or 2-4: ${item}` }
            for (const page of pages) order.push({ file, page })
        } else {
            const pages = pagesOf(item)
            if (!pages) return { error: `--order items are 3, 2-5, blank, @image or @file.pdf#4: ${item}` }
            for (const page of pages) order.push({ page })
        }
    }
    return { order }
}
