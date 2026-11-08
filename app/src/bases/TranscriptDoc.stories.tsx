// Visual spec for <TranscriptDoc> — text mode: every page's section in one scrolling column.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal, onMount } from 'solid-js'
import { expect, userEvent, waitFor } from 'storybook/test'
import TranscriptDoc, { type TranscriptDocPage } from './TranscriptDoc'
import Text from '../ui/Text'

const meta = {
    title: 'Bases/TranscriptDoc',
    component: TranscriptDoc,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof TranscriptDoc>

export default meta
type Story = StoryObj<typeof meta>

const status = (s: string) => <Text as="span" size="ui" tone="muted">{s}</Text>

const MIXED = [
    'Dear diary, the ==integral of $x^2$== is $x^3/3$ plus a constant.\n\nThe afternoon was long.',
    '## Notes\n\n- first point\n- second point with **bold**\n- third',
    'Euler wrote $e^{i\\pi} + 1 = 0$ and then\n\n$$\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}$$',
    '| item | count |\n|---|---|\n| apples | 3 |\n| pears | 5 |',
    '',
    'The ==last page== closes the chapter with a short paragraph that wraps over more than one line of the column.',
]

const six = (labelPrefix = ''): TranscriptDocPage[] =>
    MIXED.map((text, i) => ({ key: `p${i + 1}`, label: `${labelPrefix}page ${i + 1}`, text, status: status(i === 4 ? 'queued' : 'on-device') }))

let mountedAt = 0
let paintedMs = -1
// Placed after the doc, so its onMount runs once the doc's sections have mounted; two frames later
// the browser has painted them.
function Stamp() {
    onMount(() => requestAnimationFrame(() => requestAnimationFrame(() => (paintedMs = Math.round(performance.now() - mountedAt)))))
    return null
}

const SIX = six()

function Frame(props: { pages: TranscriptDocPage[]; at?: { key: string; frac?: number }; height?: string; counts?: boolean; onAt?: (key: string) => void }) {
    const [saves, setSaves] = createSignal<Record<string, number>>({})
    return (
        <div style={{ height: props.height ?? '640px', display: 'flex', 'flex-direction': 'column' }} data-saves={JSON.stringify(saves())}>
            <TranscriptDoc
                pages={props.pages}
                at={props.at}
                onAt={a => props.onAt?.(a.key)}
                onSave={(key) => setSaves(s => ({ ...s, [key]: (s[key] ?? 0) + 1 }))}
            />
            <Stamp />
        </div>
    )
}

export const SixPages: Story = {
    render: () => <Frame pages={SIX} />,
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(canvasElement.querySelectorAll('[data-page-key] .cm-content').length).toBeGreaterThanOrEqual(3))
    },
}

export const OneEmptyPage: Story = {
    render: () => <Frame pages={SIX} at={{ key: 'p5' }} />,
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(canvasElement.querySelector('[data-page-key="p5"] .cm-placeholder')?.textContent).toBe('no text yet'))
    },
}

export const BookAcrossTwoFiles: Story = {
    render: () => (
        <Frame
            pages={[
                { key: 'a1', label: 'lecture-1.pdf // page 1', text: MIXED[0], status: status('on-device') },
                { key: 'a2', label: 'lecture-1.pdf // page 2', text: MIXED[1], status: status('math reader') },
                { key: 'b1', label: 'lecture-2.pdf // page 1', text: MIXED[2], status: status('ai') },
                { key: 'b2', label: 'lecture-2.pdf // page 2', text: MIXED[5], status: status('on-device') },
            ]}
        />
    ),
}

export const ImageNoDivider: Story = {
    render: () => <Frame pages={[{ key: 'img', text: 'Text read from a photo.\n\nIt has two paragraphs and no divider above it.' }]} />,
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(canvasElement.querySelector('.cm-content')).not.toBeNull())
        expect(canvasElement.textContent).not.toContain('page 1')
    },
}

// Only the edited page saves.
export const EditSavesOnlyThatPage: Story = {
    render: () => <Frame pages={SIX} />,
    play: async ({ canvasElement }) => {
        const root = canvasElement.querySelector<HTMLElement>('[data-saves]')!
        const content = await waitFor(() => {
            const c = canvasElement.querySelector<HTMLElement>('[data-page-key="p2"] .cm-content')
            if (!c) throw new Error('page 2 not mounted')
            return c
        })
        await userEvent.click(content)
        await userEvent.keyboard('{End} more')
        await waitFor(() => expect(JSON.parse(root.dataset.saves!)).toEqual({ p2: 1 }), { timeout: 2500 })
        await new Promise(r => setTimeout(r, 900))
        expect(JSON.parse(root.dataset.saves!)).toEqual({ p2: 1 })
    },
}

const N = 300
const many = (): TranscriptDocPage[] =>
    Array.from({ length: N }, (_, i) => ({
        key: `p${i + 1}`,
        label: `page ${i + 1}`,
        text: `Text of page ${i + 1}. ${MIXED[i % MIXED.length]}`,
        status: status('on-device'),
    }))

// 300 pages: the first section paints at once; the last paints once scrolled to.
export const ThreeHundredPages: Story = {
    render: () => {
        mountedAt = performance.now()
        paintedMs = -1
        const pages = many()
        return <Frame {...{ pages }} />
    },
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(paintedMs).toBeGreaterThanOrEqual(0), { timeout: 5000, interval: 5 })
        const ms = paintedMs
        const first = canvasElement.querySelector<HTMLElement>('[data-page-key="p1"] .cm-content')
        canvasElement.dataset.firstPaintMs = String(ms)
        console.info(`transcript-doc first section painted ${ms} ms after mount`)
        expect(first?.textContent).toContain('Text of page 1.')
        expect(ms).toBeLessThan(1000)
        expect(canvasElement.querySelectorAll('[data-page-key] .cm-content').length).toBeLessThan(30)
        const scroller = canvasElement.querySelector<HTMLElement>('[data-page-key]')!.closest('div[class*="doc"]') as HTMLElement
        scroller.scrollTop = scroller.scrollHeight
        // the last page and the ones above it (a tall viewport shows several) are all painted
        for (const n of [N, N - 8]) {
            await waitFor(
                () => {
                    const c = canvasElement.querySelector<HTMLElement>(`[data-page-key="p${n}"] .cm-content`)
                    if (!c || !c.textContent?.includes(`Text of page ${n}.`)) throw new Error(`p${n} not painted`)
                },
                { timeout: 5000, interval: 20 },
            )
        }
    },
}

// Pages above the view fill in while the reader sits on page 280: the view stays on page 280.
let fill: (() => void) | undefined
export const FillInAboveKeepsPlace: Story = {
    render: () => {
        const [texts, setTexts] = createSignal<Record<number, string>>({})
        fill = () => setTexts(Object.fromEntries(Array.from({ length: 9 }, (_, k) => [271 + k, Array.from({ length: 12 }, (_, l) => `line ${l + 1} of the page just read in`).join('\n\n')])))
        const pages = () => many().map((p, i) => ({ ...p, text: i >= 270 && i <= 278 ? (texts()[i + 1] ?? '') : p.text }))
        return (
            <div style={{ height: '640px', display: 'flex', 'flex-direction': 'column' }}>
                <TranscriptDoc pages={pages()} at={{ key: 'p280' }} onSave={() => {}} />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const scroller = await waitFor(() => {
            const s = canvasElement.querySelector<HTMLElement>('[data-page-key]')?.closest('div[class*="doc"]') as HTMLElement | null
            if (!s) throw new Error('no scroller')
            return s
        })
        const top = () => canvasElement.querySelector<HTMLElement>('[data-page-key="p280"]')!.getBoundingClientRect().top - scroller.getBoundingClientRect().top
        await waitFor(() => expect(Math.abs(top())).toBeLessThan(2), { timeout: 5000 })
        await new Promise(r => setTimeout(r, 400))
        const before = scroller.scrollHeight
        fill?.()
        await waitFor(() => expect(scroller.scrollHeight).toBeGreaterThan(before + 500), { timeout: 5000 })
        await new Promise(r => setTimeout(r, 1500))
        expect(Math.abs(top())).toBeLessThan(2)
    },
}
