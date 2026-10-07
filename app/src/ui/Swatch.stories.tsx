// Visual spec for <Swatch> — the colour square button CategoryPanel used to hand-roll twice
// (`.cat-chip` the 20px current-colour chip, `.cat-sw` the 22px picker option). See Swatch.tsx's
// header comment.
//
// Props: color (required, any CSS colour), selected, label (a11y name — required in practice
// for the interactive default), size ("md" default | "sm"), static (renders a non-focusable
// `<div>` instead of a `<button>`, no onClick — aria-hidden unless label is given), onClick,
// class.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { For, createSignal } from 'solid-js'
import { expect } from 'storybook/test'
import { Swatch } from './Swatch'
import Text from './Text'

const meta = {
    title: 'UI/Swatch',
    component: Swatch,
    parameters: { layout: 'centered' },
    args: {
        color: 'var(--accent)',
        label: 'Accent',
        onClick: () => {},
    },
} satisfies Meta<typeof Swatch>

export default meta
type Story = StoryObj<typeof meta>

const TOKENS = ['--accent', '--rose', '--gold', '--green', '--violet', '--faint']

/** A picker row (the default "md" size, 22px) plus the "sm" current-colour chip (20px) it sits
 *  beside in CategoryPanel's real composition — ColorChip (sm) opens Palette (md options).
 *  `play` asserts the row rendered exactly one swatch per token, that the selected one alone
 *  carries `aria-pressed`, AND that the two sizes carry the two DIFFERENT treatments the
 *  originals had (`Calendar.module.css:288-291`): "md" is borderless, "sm" carries the hairline
 *  border. A previous port swapped these — every 22px swatch rendered `.cat-chip`'s border — and
 *  neither story here asserted on `border` at all, so it passed unnoticed. */
export const Palette: Story = {
    render: () => {
        const [value, setValue] = createSignal('--rose')
        return (
            <div style={{ display: 'flex', 'align-items': 'center', gap: '10px' }}>
                <Swatch
                    size="sm"
                    color="var(--accent)"
                    label="Current colour"
                    onClick={() => {}}
                />
                <div style={{ display: 'flex', gap: '6px' }}>
                    <For each={TOKENS}>
                        {tok => (
                            <Swatch
                                color={`var(${tok})`}
                                label={tok}
                                selected={value() === tok}
                                onClick={() => setValue(tok)}
                            />
                        )}
                    </For>
                </div>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const swatches = [
            ...canvasElement.querySelectorAll('button[aria-label]'),
        ]
        // the "sm" chip plus one "md" swatch per token
        expect(swatches.length).toBe(1 + TOKENS.length)
        const pressed = swatches.filter(
            s => s.getAttribute('aria-pressed') === 'true',
        )
        expect(pressed.length).toBe(1)
        expect(pressed[0]!.getAttribute('aria-label')).toBe('--rose')

        const chip = canvasElement.querySelector(
            'button[aria-label="Current colour"]',
        ) as HTMLElement
        const option = canvasElement.querySelector(
            'button[aria-label="--accent"]',
        ) as HTMLElement
        expect(chip).not.toBeNull()
        expect(option).not.toBeNull()
        // "md" (default, the picker option) is borderless; "sm" (the current-colour chip) carries
        // the hairline border — the two must NOT read the same.
        expect(getComputedStyle(option).borderStyle).toBe('none')
        expect(getComputedStyle(chip).borderStyle).not.toBe('none')
        expect(getComputedStyle(chip).borderWidth).not.toBe('0px')
        // Every swatch must actually PAINT. One of these once named `--jade`, a token defined
        // nowhere: the swatch rendered invisible while the count above still passed.
        for (const s of swatches)
            expect(getComputedStyle(s).backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
        // and they are distinct hues, not six copies of one fallback
        const hues = new Set(
            swatches
                .filter(s => s !== chip)
                .map(s => getComputedStyle(s).backgroundColor),
        )
        expect(hues.size).toBe(TOKENS.length)
    },
}

/** No colour chosen (`color=""`): an empty dashed box, visibly NOT a swatch of some hue — it used
 *  to paint solid accent, identical to a chosen teal. Sat beside a real swatch for contrast. */
export const Empty: Story = {
    render: () => (
        <div style={{ display: 'flex', 'align-items': 'center', gap: '10px' }}>
            <Swatch color="" label="Empty" onClick={() => {}} />
            <Swatch color="" size="sm" label="Empty small" onClick={() => {}} />
            <Swatch color="var(--accent)" label="Chosen" onClick={() => {}} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const at = (l: string) =>
            canvasElement.querySelector(`button[aria-label="${l}"]`) as HTMLElement
        for (const l of ['Empty', 'Empty small']) {
            const cs = getComputedStyle(at(l))
            expect(cs.backgroundColor).toBe('rgba(0, 0, 0, 0)')
            expect(cs.borderStyle).toBe('dashed')
        }
        expect(getComputedStyle(at('Chosen')).backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
    },
}

/** The two sizes sit on the app's two control heights: md = --h-control (24px), sm = --row-h
 *  (18px). `play` measures them, so a return to the old 22/20 fails. */
export const Sizes: Story = {
    render: () => (
        <div style={{ display: 'flex', 'align-items': 'center', gap: '10px' }}>
            <Swatch color="var(--accent)" size="sm" label="Small" onClick={() => {}} />
            <Swatch color="var(--accent)" label="Medium" onClick={() => {}} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const box = (l: string) =>
            canvasElement
                .querySelector(`button[aria-label="${l}"]`)!
                .getBoundingClientRect()
        expect(Math.round(box('Small').width)).toBe(18)
        expect(Math.round(box('Medium').width)).toBe(24)
        expect(Math.round(box('Medium').height)).toBe(24)
    },
}

/** The empty-rule defect this component fixes: `.cat-chip.open` and `.cat-sw.on` were both blank
 *  CSS rules, so a selected swatch was indistinguishable from every other one. `play` proves the
 *  variant actually differs — the selected swatch's computed `box-shadow` is not `none` and not
 *  equal to an unselected swatch's. */
export const Selected: Story = {
    render: () => (
        <div style={{ display: 'flex', gap: '10px' }}>
            <Swatch
                color="var(--accent)"
                label="Unselected"
                onClick={() => {}}
            />
            <Swatch
                color="var(--accent)"
                label="Selected"
                selected
                onClick={() => {}}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const plain = canvasElement.querySelector(
            'button[aria-label="Unselected"]',
        ) as HTMLElement
        const sel = canvasElement.querySelector(
            'button[aria-label="Selected"]',
        ) as HTMLElement
        expect(plain).not.toBeNull()
        expect(sel).not.toBeNull()
        const plainShadow = getComputedStyle(plain).boxShadow
        const selShadow = getComputedStyle(sel).boxShadow
        expect(selShadow).not.toBe('none')
        expect(selShadow).not.toBe(plainShadow)
    },
}

/** The non-interactive variant (`static`, e.g. ExportView's theme dot) — a decorative colour
 *  square with no click affordance of its own: no `<button>`, no `onClick`, not keyboard-
 *  reachable — sat beside the ordinary interactive swatch so the two read as a deliberate pair,
 *  not an isolated fragment. Each row is captioned with a `Text` primitive naming which is which.
 *  `play` proves the static row's rendered elements are plain `<div>`s (`tabIndex` -1, i.e. not
 *  tab-reachable), that one is `aria-hidden` with no label and the other's label suppresses
 *  aria-hidden and becomes the accessible name instead — Swatch.tsx's `static` contract — while
 *  the interactive row renders real, clickable `<button>`s. */
export const Static: Story = {
    render: () => (
        <div style={{ display: 'flex', 'flex-direction': 'column', gap: '14px' }}>
            <div style={{ display: 'flex', 'align-items': 'center', gap: '10px' }}>
                <Swatch color="var(--accent)" static />
                <Swatch color="var(--rose)" label="Rose" static />
                <Text as="span" size="micro" tone="muted">
                    static
                </Text>
            </div>
            <div style={{ display: 'flex', 'align-items': 'center', gap: '10px' }}>
                <Swatch color="var(--accent)" label="Accent" onClick={() => {}} />
                <Swatch
                    color="var(--rose)"
                    label="Rose"
                    selected
                    onClick={() => {}}
                />
                <Text as="span" size="micro" tone="muted">
                    interactive
                </Text>
            </div>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const buttons = [
            ...canvasElement.querySelectorAll('button[aria-label]'),
        ]
        expect(buttons.length).toBe(2)

        const dots = [...canvasElement.querySelectorAll('div')].filter(
            d => !!d.style.background,
        )
        expect(dots.length).toBe(2)

        const [plain, labelled] = dots
        expect(plain!.tagName).toBe('DIV')
        expect(plain!.tabIndex).toBe(-1)
        expect(plain!.getAttribute('aria-hidden')).toBe('true')
        expect(plain!.hasAttribute('aria-label')).toBe(false)

        expect(labelled!.tabIndex).toBe(-1)
        expect(labelled!.getAttribute('aria-label')).toBe('Rose')
        expect(labelled!.hasAttribute('aria-hidden')).toBe(false)
    },
}
