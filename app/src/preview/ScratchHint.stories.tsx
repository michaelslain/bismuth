// app/src/preview/ScratchHint.stories.tsx
// Visual spec for <ScratchHint> — the one-line "this takes typing" affordance on an empty scratch
// strip. Positioning + show/hide is ScratchTextLayer's job (ScratchTextLayer.stories.tsx's
// HintOnEmptyStrip); this pins the hint's own look, alone on the note-surface ground it sits on.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor } from 'storybook/test'
import ScratchHint from './ScratchHint'

const meta = {
    title: 'Preview/ScratchHint',
    component: ScratchHint,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof ScratchHint>

export default meta
type Story = StoryObj<typeof meta>

/** The strip: --editor ground against a --surface-2 desk, matching PageInk/ScratchTextLayer. */
function Strip() {
    return (
        <div
            style={{
                position: 'relative',
                width: '280px',
                height: '160px',
                background: 'var(--surface-2)',
                padding: '20px',
            }}
        >
            <div
                style={{
                    position: 'relative',
                    width: '240px',
                    height: '120px',
                    background: 'var(--editor)',
                    'border-left': 'var(--rule-soft)',
                }}
            >
                <ScratchHint left={0} top={0} />
            </div>
        </div>
    )
}

/** Quiet, legible, italic prose reading on the note surface. */
export const Default: Story = {
    render: () => <Strip />,
    play: async ({ canvasElement }) => {
        const hint = canvasElement.querySelector<HTMLElement>(
            '[data-testid="scratch-hint"]',
        )!
        await waitFor(() => expect(hint.textContent).toBe('click anywhere to write'))
        await expect(getComputedStyle(hint).pointerEvents).toBe('none')

        const label = hint.querySelector('span')!
        const cs = getComputedStyle(label)
        await expect(cs.fontStyle).toBe('italic')

        const proseProbe = document.createElement('div')
        proseProbe.style.fontFamily = 'var(--prose-font)'
        canvasElement.appendChild(proseProbe)
        await expect(cs.fontFamily).toBe(getComputedStyle(proseProbe).fontFamily)
        proseProbe.remove()

        const faintProbe = document.createElement('div')
        faintProbe.style.color = 'var(--faint)'
        canvasElement.appendChild(faintProbe)
        await expect(cs.color).toBe(getComputedStyle(faintProbe).color)
        faintProbe.remove()

        // The hint's OWN box sits flush at the strip's corner (left/top: 0, set by the layer) — the
        // inset from the corner is the text's padding, not a gap before the box starts.
        const strip = hint.parentElement!.getBoundingClientRect()
        const r = hint.getBoundingClientRect()
        await expect(Math.abs(r.left - strip.left)).toBeLessThanOrEqual(1)
        await expect(Math.abs(r.top - strip.top)).toBeLessThanOrEqual(1)

        // The rendered text itself IS inset by --sp-6 from that corner.
        const sp6 = parseFloat(
            resolveVarPx(canvasElement, 'padding-left', 'var(--sp-6)'),
        )
        const lr = label.getBoundingClientRect()
        await expect(lr.left - r.left).toBeGreaterThanOrEqual(sp6 - 1)
        await expect(lr.top - r.top).toBeGreaterThanOrEqual(sp6 - 1)
    },
}

/** Resolves a CSS custom property to its computed pixel value via a throwaway probe. */
function resolveVarPx(root: HTMLElement, prop: string, decl: string): string {
    const probe = document.createElement('div')
    probe.style.setProperty(prop, decl)
    root.appendChild(probe)
    const v = getComputedStyle(probe).getPropertyValue(prop)
    probe.remove()
    return v
}
