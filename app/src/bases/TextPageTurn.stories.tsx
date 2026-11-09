// Visual spec for <TextPageTurn>: a page of real text drawn to a picture and curled over.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { Show, createSignal } from 'solid-js'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import TextButton from '../ui/TextButton'
import { drawTextFace } from './textFace'
import TextPageTurn from './TextPageTurn'

const meta = {
    title: 'Bases/TextPageTurn',
    component: TextPageTurn,
} satisfies Meta<typeof TextPageTurn>

export default meta
type Story = StoryObj<typeof meta>

const PAGES = [
    ['First page', 'A paragraph of text that wraps over a line or two, with a word struck through here.'],
    ['Second page', 'What the leaf uncovers as it turns: the next page, drawn from the laid-out text.'],
]

const Live = () => {
    const [at, setAt] = createSignal(0)
    const [turn, setTurn] = createSignal<{ id: number; from: HTMLCanvasElement; to?: HTMLCanvasElement; direction: 'forward' | 'back' }>()
    let page!: HTMLDivElement
    let id = 0
    const go = () => {
        const from = drawTextFace(page)
        const direction = at() === 0 ? 'forward' : 'back'
        setAt(n => 1 - n)
        const next = { id: ++id, from, direction } as const
        setTurn(next)
        requestAnimationFrame(() => setTurn({ ...next, to: drawTextFace(page) }))
    }
    return (
        <div style={{ position: 'relative', width: '420px', height: '260px' }}>
            <div ref={page} data-page style={{ height: '220px', padding: '16px', 'box-sizing': 'border-box', background: 'var(--bg)' }}>
                <h3 style={{ margin: 0 }}>{PAGES[at()][0]}</h3>
                <p>
                    {PAGES[at()][1]} <s>struck</s>
                </p>
            </div>
            <Show when={turn()}>
                {t => <TextPageTurn box={{ left: 0, top: 0, w: 420, h: 220 }} from={t().from} to={t().to} direction={t().direction} turnKey={t().id} onSettled={() => setTurn(undefined)} />}
            </Show>
            <TextButton onClick={go}>turn</TextButton>
        </div>
    )
}

/** Press `turn`: the text curls over to the other page and the layer goes away. */
export const Default: Story = {
    render: () => <Live />,
    play: async ({ canvasElement }) => {
        const page = canvasElement.querySelector<HTMLElement>('[data-page]')!
        const face = drawTextFace(page)
        const data = face.getContext('2d')!.getImageData(0, 0, face.width, face.height).data
        const paper = [data[0], data[1], data[2]]
        let ink = 0
        for (let i = 0; i < data.length; i += 4) if (Math.abs(data[i] - paper[0]) + Math.abs(data[i + 1] - paper[1]) + Math.abs(data[i + 2] - paper[2]) > 60) ink++
        await expect(ink).toBeGreaterThan(50)
        // KaTeX's screen-reader copy of a formula is not drawn over the formula
        const math = document.createElement('div')
        math.style.cssText = 'width:200px;height:60px;background:#000;color:#fff'
        math.innerHTML = '<span class="katex-mathml">hidden copy</span>'
        canvasElement.append(math)
        const blank = drawTextFace(math).getContext('2d')!.getImageData(0, 0, 200, 60).data
        math.remove()
        await expect(blank.every((v, i) => i % 4 === 3 || v === 0)).toBe(true)
        let curled = false
        new MutationObserver(() => (curled ||= !!canvasElement.querySelector('[data-text-turn] [data-turn-state]'))).observe(canvasElement, { subtree: true, childList: true })
        await userEvent.click(within(canvasElement).getByRole('button', { name: 'turn' }))
        await waitFor(() => expect(curled).toBe(true))
        await waitFor(() => expect(canvasElement.querySelector('[data-text-turn]')).toBeNull(), { timeout: 4000 })
        await expect(page.textContent).toContain('Second page')
    },
}
