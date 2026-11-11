// app/src/preview/ScratchBlock.stories.tsx
// Visual spec for <ScratchBlock> — one scratch note, alone on a patch of the note surface (the strip
// ground ScratchTextLayer places it on). Positioning, placement and persistence are the layer's job
// and are specified in ScratchTextLayer.stories.tsx; these stories pin the block's own look: text at
// rest reads as plain prose on paper, and only a focused (or hovered) block shows its move handle
// and delete X.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor } from 'storybook/test'
import ScratchBlock from './ScratchBlock'

const meta = {
    title: 'Preview/ScratchBlock',
    component: ScratchBlock,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof ScratchBlock>

export default meta
type Story = StoryObj<typeof meta>

const BLOCK = {
    id: 'k3f9',
    page: 0,
    x: 846,
    y: 120,
    w: 280,
    text: '**why?** see [[Lecture 7]]\n\n- check eq (3)\n- compare with p. 12',
}

const noop = () => {}

function Patch(props: { autofocus: boolean }) {
    return (
        <div
            style={{
                position: 'relative',
                width: '260px',
                height: '220px',
                background: 'var(--surface-1)',
                'border-left': 'var(--rule-soft)',
            }}
        >
            <ScratchBlock
                block={BLOCK}
                rect={{ left: 20, top: 36, w: 210 }}
                autofocus={props.autofocus}
                interactive
                onText={noop}
                onLeave={noop}
                onDelete={noop}
                onDragMove={noop}
                onDragEnd={noop}
            />
        </div>
    )
}

const chromeOf = (root: HTMLElement) => ({
    block: root.querySelector<HTMLElement>('[data-scratch-block]')!,
    chrome: root.querySelector<HTMLElement>('[data-testid="scratch-chrome"]')!,
    handle: root.querySelector<HTMLElement>('[aria-label="Move note"]')!,
    del: root.querySelector<HTMLElement>('[data-testid="scratch-delete"]')!,
})

/** Point at the centre of an element's bounding rect, in viewport (client) coordinates — what
 *  `document.elementFromPoint` expects. */
const centreOf = (r: DOMRect) => ({
    x: r.left + r.width / 2,
    y: r.top + r.height / 2,
})

/** At rest: rendered markdown on the note surface, no handle, no X. */
export const Default: Story = {
    render: () => <Patch autofocus={false} />,
    play: async ({ canvasElement }) => {
        const { block, chrome } = chromeOf(canvasElement)
        await expect(block.dataset.scratchBlock).toBe('k3f9')
        await waitFor(() =>
            expect(block.querySelector('.cm-strong')).not.toBeNull(),
        )
        await expect(getComputedStyle(chrome).opacity).toBe('0')
        // At rest, the chrome row (which sits above the block's own box) takes no pointer events,
        // so a click at the very top of the text reaches the editor, not a hidden handle.
        await expect(getComputedStyle(chrome).pointerEvents).toBe('none')
        const r = block.getBoundingClientRect()
        await expect(Math.round(r.width)).toBe(210)
    },
}

/** Focused: caret in the text, move handle + delete X visible, sitting above the block as the two
 *  ends of a title row on the focus outline's top edge — and, unlike the old corner-overlap
 *  markup, actually reachable by a real click (Diagnosis 2c: CodeMirror's positioned `.cm-editor`
 *  used to paint over both controls). */
export const Focused: Story = {
    render: () => <Patch autofocus />,
    play: async ({ canvasElement }) => {
        const { block, chrome, handle, del } = chromeOf(canvasElement)
        await waitFor(() =>
            expect(block.contains(document.activeElement)).toBe(true),
        )
        await waitFor(() => expect(getComputedStyle(chrome).opacity).toBe('1'))
        await expect(getComputedStyle(chrome).pointerEvents).toBe('auto')

        // The outline sits `outline-offset` outside the block's own box.
        const b = block.getBoundingClientRect()
        const offset = parseFloat(getComputedStyle(block).outlineOffset)
        await expect(offset).toBeGreaterThan(0)

        // The chrome row spans the block's own width and sits entirely above it, with the grip at
        // the left end and the X at the right end — the two ends of a title row.
        const c = chrome.getBoundingClientRect()
        const h = handle.getBoundingClientRect()
        const x = del.getBoundingClientRect()
        await expect(Math.abs(c.left - b.left)).toBeLessThanOrEqual(1)
        await expect(Math.abs(c.right - b.right)).toBeLessThanOrEqual(1)
        await expect(c.bottom).toBeLessThanOrEqual(b.top + 1)
        await expect(h.right).toBeLessThanOrEqual(x.left)

        // The chrome row does not overlap the editor's text: its bottom sits at or above
        // .cm-content's top.
        const content = block.querySelector('.cm-content')!
        const contentTop = content.getBoundingClientRect().top
        await expect(c.bottom).toBeLessThanOrEqual(contentTop)

        // Hit-testing, not just handler wiring: a real click at the centre of each control must
        // land on that control, not on CodeMirror underneath it (the defect `fireEvent.click`
        // hid — Diagnosis 2c).
        const hCentre = centreOf(h)
        const moveHit = document.elementFromPoint(hCentre.x, hCentre.y)
        await expect(
            moveHit?.closest('[data-testid="scratch-move"]'),
        ).not.toBeNull()
        await expect(moveHit?.closest('.cm-content')).toBeNull()

        const xCentre = centreOf(x)
        const delHit = document.elementFromPoint(xCentre.x, xCentre.y)
        await expect(
            delHit?.closest('[data-testid="scratch-delete"]'),
        ).not.toBeNull()
        await expect(delHit?.closest('.cm-content')).toBeNull()
    },
}

/** A note beside the page is written at a note body's size, `--prose-font-size`, whatever the
 *  block's width (which follows the page's zoom): a narrow block and a wide one read the same size. */
function SizePatch(props: { w: number; testid: string }) {
    return (
        <div
            data-testid={props.testid}
            style={{ position: 'relative', width: '420px', height: '80px' }}
        >
            <ScratchBlock
                block={{ ...BLOCK, id: props.testid }}
                rect={{ left: 8, top: 24, w: props.w }}
                autofocus={false}
                interactive
                onText={noop}
                onLeave={noop}
                onDelete={noop}
                onDragMove={noop}
                onDragEnd={noop}
            />
        </div>
    )
}

export const SizeIsProse: Story = {
    render: () => (
        <div style={{ display: 'flex', 'flex-direction': 'column', gap: '24px' }}>
            <SizePatch w={140} testid="narrow" />
            <SizePatch w={400} testid="wide" />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const scrollerFor = (testid: string) =>
            canvasElement.querySelector<HTMLElement>(`[data-testid="${testid}"] .cm-scroller`)
        await waitFor(() => expect(scrollerFor('narrow')).not.toBeNull())
        await waitFor(() => expect(scrollerFor('wide')).not.toBeNull())
        const probe = document.createElement('span')
        probe.style.fontSize = 'var(--prose-font-size)'
        canvasElement.appendChild(probe)
        const prose = parseFloat(getComputedStyle(probe).fontSize)
        probe.remove()
        for (const id of ['narrow', 'wide']) {
            const size = parseFloat(getComputedStyle(scrollerFor(id)!).fontSize)
            await expect(Math.abs(size - prose)).toBeLessThanOrEqual(0.5)
        }
    },
}
