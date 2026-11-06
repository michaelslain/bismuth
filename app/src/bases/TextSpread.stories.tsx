// Visual spec for <TextSpread> — the transcriptions set as a book. Pages are typeset here with the
// same pure typesetter BookView uses, so every story is deterministic.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fn, within } from 'storybook/test'
import { TEXT_FONT_FAMILY, TEXT_STYLE, paginateText, type TextPage } from './bookText'
import type { BookQuote } from './bookSelection'
import Text from '../ui/Text'
import TextSpread, { type TextSpreadProps, type TextSpreadReader } from './TextSpread'

const PAGE = { w: 360, h: 480 }

const meta = {
    title: 'Bases/TextSpread',
    component: TextSpread,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof TextSpread>

export default meta
type Story = StoryObj<typeof meta>

const FIRST = `I went to the woods because I wished to live deliberately, to front only the essential facts of life, and see if I could not learn what it had to teach, and not, when I came to die, discover that I had not lived. I did not wish to live what was not life, living is so dear; nor did I wish to practise resignation, unless it was quite necessary.

I wanted to live deep and ==suck out all the marrow of life==, to live so sturdily and Spartan-like as to put to rout all that was not life, to cut a broad swath and shave close, to drive life into a corner, and reduce it to its lowest terms.`

const SECOND = `Still we live meanly, like ants; though the fable tells us that we were long ago changed into men; like pygmies we fight with cranes; it is error upon error, and clout upon clout, and our best virtue has for its occasion a superfluous and evitable wretchedness. Our life is frittered away by detail.

Simplicity, simplicity, simplicity! I say, let your affairs be as two or three, and not a hundred or a thousand; instead of a million count half a dozen, and keep your accounts on your thumb-nail.`

/** Two notebook pages' transcripts typeset into text pages. */
function typeset(): TextPage[] {
    const g = document.createElement('canvas').getContext('2d')!
    g.font = `${TEXT_STYLE(PAGE).fontPx}px ${TEXT_FONT_FAMILY}`
    return paginateText(
        [
            { source: { file: 'pages/page-1.png', leaf: 0 }, text: FIRST },
            { source: { file: 'pages/page-2.png', leaf: 1 }, text: SECOND },
        ],
        PAGE,
        s => g.measureText(s).width,
    )
}

const MARK = 'rgba(245, 213, 71, 0.45)'
const noop = () => {}

/** The spread with its page number under it, as BookView draws it (also the in-scale text the invariants sweep needs to find). */
const WithFolio = (props: TextSpreadProps & { folio: string }) => (
    <div>
        <TextSpread {...props} />
        <Text as="div" size="micro" tone="faint">
            {props.folio}
        </Text>
    </div>
)

export const Spread: Story = {
    render: () => {
        const pages = typeset()
        return <WithFolio folio="2–3 of 4" layout="spread" pageSize={PAGE} markColor={MARK} pages={[pages[0], pages[1] ?? null]} onTurn={noop} />
    },
    play: async ({ canvasElement }) => {
        await expect(canvasElement.querySelectorAll('[data-text-page]').length).toBe(2)
        await expect(canvasElement.querySelectorAll('[data-text-line]').length).toBeGreaterThan(8)
        // the highlighted words are one tinted run
        const marks = Array.from(canvasElement.querySelectorAll<HTMLElement>('[data-text-mark]'))
        await expect(marks.map(m => m.textContent).join(' ')).toBe('suck out all the marrow of life')
        await expect(getComputedStyle(marks[0]).backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
    },
}

export const Cover: Story = {
    render: () => {
        const pages = typeset()
        return <WithFolio folio="1 of 4" layout="spread" pageSize={PAGE} markColor={MARK} pages={[null, pages[0]]} onTurn={noop} />
    },
    play: async ({ canvasElement }) => {
        const left = canvasElement.querySelector('[data-text-page="left"]')!
        await expect(left.querySelectorAll('[data-text-line]').length).toBe(0)
    },
}

export const Single: Story = {
    render: () => {
        const pages = typeset()
        return <WithFolio folio="1 of 4" layout="single" pageSize={PAGE} markColor={MARK} pages={[null, pages[0]]} onTurn={noop} />
    },
    play: async ({ canvasElement }) => {
        await expect(canvasElement.querySelector('[data-text-page="left"]')).toBeNull()
    },
}

/** A selection across two notebook pages reads as one quote per page; a click on a highlight reports the whole highlight. */
export const SelectionReadsQuotes: Story = {
    name: 'Selection reads quotes',
    render: () => {
        const pages = typeset()
        const onMarkClick = fn()
        ;(window as unknown as { __mark: typeof onMarkClick }).__mark = onMarkClick
        return (
            <WithFolio
                folio="2–3 of 4"
                layout="spread"
                pageSize={PAGE}
                markColor={MARK}
                pages={[pages[0], pages[1] ?? null]}
                onTurn={noop}
                onMarkClick={onMarkClick}
                readerRef={read => ((window as unknown as { __read: TextSpreadReader }).__read = read)}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const read = (window as unknown as { __read: TextSpreadReader }).__read
        await expect(read()).toEqual([])
        const lines = Array.from(canvasElement.querySelectorAll<HTMLElement>('[data-text-line]'))
        const byFile = (f: string) => lines.filter(l => l.dataset.file === f)
        const a = byFile('pages/page-1.png').at(-1)!
        const b = byFile('pages/page-2.png')[0]
        const range = document.createRange()
        range.setStart(a.firstChild!.firstChild!, 0)
        range.setEnd(b.firstChild!.firstChild!, 4)
        const sel = window.getSelection()!
        sel.removeAllRanges()
        sel.addRange(range)
        const quotes: BookQuote[] = read()
        await expect(quotes.map(q => q.file)).toEqual(['pages/page-1.png', 'pages/page-2.png'])
        await expect(quotes[0].quote.length).toBeGreaterThan(0)
        await expect(quotes[1].quote.length).toBeGreaterThan(0)
        sel.removeAllRanges()
        // clicking the highlighted run reports the whole highlight
        const mark = canvasElement.querySelector<HTMLElement>('[data-text-mark]')!
        mark.click()
        const onMarkClick = (window as unknown as { __mark: ReturnType<typeof fn> }).__mark
        await expect(onMarkClick).toHaveBeenCalled()
        const got = onMarkClick.mock.calls[0][0] as BookQuote
        await expect(got.quote).toBe('suck out all the marrow of life')
        await expect(within(canvasElement).getAllByText(/marrow/).length).toBeGreaterThan(0)
    },
}

/** A notebook page with no text yet sets one muted line, in the flow between its neighbours. */
export const PlaceholderPage: Story = {
    name: 'Placeholder page',
    render: () => {
        const g = document.createElement('canvas').getContext('2d')!
        g.font = `${TEXT_STYLE(PAGE).fontPx}px ${TEXT_FONT_FAMILY}`
        const pages = paginateText(
            [
                { source: { file: 'pages/page-1.png', leaf: 0 }, text: FIRST },
                { source: { file: 'pages/page-2.png', leaf: 1 }, text: "page 2 isn't transcribed yet", placeholder: true },
                { source: { file: 'pages/page-3.png', leaf: 2 }, text: SECOND },
            ],
            PAGE,
            s => g.measureText(s).width,
        )
        return <WithFolio folio="2–3 of 4" layout="spread" pageSize={PAGE} markColor={MARK} pages={[pages[0], pages[1] ?? null]} onTurn={noop} />
    },
    play: async ({ canvasElement }) => {
        const held = Array.from(canvasElement.querySelectorAll<HTMLElement>('[data-text-placeholder]'))
        await expect(held.map(l => l.textContent).join(' ')).toBe("page 2 isn't transcribed yet")
        const real = canvasElement.querySelector<HTMLElement>('[data-text-line]:not([data-text-placeholder])')!
        await expect(getComputedStyle(held[0]).color).not.toBe(getComputedStyle(real).color)
    },
}
