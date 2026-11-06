// app/src/bases/_bookPages.ts
// Story fixture: book pages the way a reading app sets them — justified serif text inside book
// margins (a wider outer margin, a narrower one at the spine), no rules and no page furniture, on
// the book's own background so the pages read as part of the pane. The text runs on from page to
// page, so a spread reads as two halves of one book. Shared by the book stories only; the
// typesetting is text mode's own (`bookText`, `bookTextRaster`).
import { TEXT_FONT_FAMILY, TEXT_STYLE, paginateText, type TextPage } from './bookText'
import { rasterTextPage } from './bookTextRaster'

/** Walden, "Where I Lived, and What I Lived For" (public domain). */
const TEXT = `I went to the woods because I wished to live deliberately, to front only the essential facts of life, and see if I could not learn what it had to teach, and not, when I came to die, discover that I had not lived. I did not wish to live what was not life, living is so dear; nor did I wish to practise resignation, unless it was quite necessary. I wanted to live deep and suck out all the marrow of life, to live so sturdily and Spartan-like as to put to rout all that was not life, to cut a broad swath and shave close, to drive life into a corner, and reduce it to its lowest terms.

Still we live meanly, like ants; though the fable tells us that we were long ago changed into men; like pygmies we fight with cranes; it is error upon error, and clout upon clout, and our best virtue has for its occasion a superfluous and evitable wretchedness. Our life is frittered away by detail. An honest man has hardly need to count more than his ten fingers, or in extreme cases he may add his ten toes, and lump the rest. Simplicity, simplicity, simplicity! I say, let your affairs be as two or three, and not a hundred or a thousand; instead of a million count half a dozen, and keep your accounts on your thumb-nail.

Why should we live with such hurry and waste of life? We are determined to be starved before we are hungry. Men say that a stitch in time saves nine, and so they take a thousand stitches to-day to save nine to-morrow. As for work, we have not any of consequence. We have the Saint Vitus' dance, and cannot possibly keep our heads still.

Let us spend one day as deliberately as Nature, and not be thrown off the track by every nutshell and mosquito's wing that falls on the rails. Let us rise early and fast, or break fast, gently and without perturbation; let company come and let company go, let the bells ring and the children cry, determined to make a day of it. Why should we knock under and go with the stream?

Time is but the stream I go a-fishing in. I drink at it; but while I drink I see the sandy bottom and detect how shallow it is. Its thin current slides away, but eternity remains. I would drink deeper; fish in the sky, whose bottom is pebbly with stars. I cannot count one. I know not the first letter of the alphabet. I have always been regretting that I was not as wise as the day I was born.`

const FIXTURE_SOURCE = { file: 'walden.pdf', leaf: 1 }

function token(name: string, fallback: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

export type BookPageOptions = { w?: number; h?: number }

/** Page `n` (1-based) of the fixture book as a canvas at 2× density. Odd pages are right-hand
 *  pages (page 1 sits alone on the right), so their spine margin is on the left. The text cycles
 *  until there are `n` pages. */
export function bookPage(n: number, opts: BookPageOptions = {}): HTMLCanvasElement {
    const w = opts.w ?? 300
    const h = opts.h ?? 400
    const size = { w, h }
    const font = `${TEXT_STYLE(size).fontPx}px ${TEXT_FONT_FAMILY}`
    const g = document.createElement('canvas').getContext('2d')!
    g.font = font
    const measure = (s: string) => g.measureText(s).width
    let pages: TextPage[] = []
    for (let cycles = 1; pages.length < n; cycles *= 2) {
        const blocks = Array.from({ length: cycles }, () => ({ source: FIXTURE_SOURCE, text: TEXT }))
        pages = paginateText(blocks, size, measure)
    }
    const colors = { bg: token('--bg', '#15161A'), fg: token('--fg', '#E8E3D6'), mark: token('--highlight', '#F5D547') }
    return rasterTextPage(pages[n - 1], size, colors, font)
}

/** `bookPage` as a PNG data URL, for stories that serve pages through the asset seam. */
export function bookPageUrl(n: number, opts: BookPageOptions = {}): string {
    return bookPage(n, opts).toDataURL('image/png')
}
