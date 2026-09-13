// Visual spec for <ToggleRow> — one on/off row in a settings form (was `.evm-modal .set-col` +
// modifiers). A real switch: focusable, Enter/Space toggle it, `role="switch"` + `aria-checked`
// carry the semantics BracketToggle (its presentational child) does not.
//
// Props: label, checked, onToggle, muted?, locked?, wrap?, class.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import { createSignal } from 'solid-js'
import ToggleRow from './ToggleRow'
import ToggleList from './ToggleList'

const meta = {
    title: 'UI/ToggleRow',
    component: ToggleRow,
    parameters: { layout: 'centered' },
    args: { label: 'Show completed', checked: false },
} satisfies Meta<typeof ToggleRow>

export default meta
type Story = StoryObj<typeof meta>

/** A single row, fully controllable via the panel. */
export const Playground: Story = {}

/** `muted`: the thing this row names is off, so its label fades. */
export const Muted: Story = {
    args: { label: 'Weekends', checked: false, muted: true },
}

/** `locked`: shown but not changeable — no hover, default cursor, click/keyboard do nothing. */
export const Locked: Story = {
    args: { label: 'Title (always visible)', checked: true, locked: true },
}

/** `wrap`: a sentence-length label wraps instead of truncating with an ellipsis. */
export const Wrap: Story = {
    args: {
        label:
            'Bidirectional — also generate the reverse card, front and back swapped',
        checked: true,
        wrap: true,
    },
}

const WRAP_LABEL =
    'This is a fairly long settings label describing a boolean option that should wrap across multiple lines instead of truncating'

/** The real composition: a ToggleList holding three rows — plain, locked, and a wrapping
 *  sentence-length label — each driven by its own signal. `play` proves the three behaviors
 *  that make this a real switch rather than a styled `div`: keyboard (Space) toggles it, the
 *  glyph the CSS paints actually flips, a locked row ignores a click, and the wrap row is
 *  visibly taller than the single-line row (see per-assertion notes below). */
export const Interactive: Story = {
    render: () => {
        const [a, setA] = createSignal(false)
        const [b] = createSignal(true)
        const [c, setC] = createSignal(false)
        return (
            <div style={{ width: '280px' }}>
                <ToggleList>
                    <ToggleRow
                        label="Show completed"
                        checked={a()}
                        onToggle={() => setA(v => !v)}
                    />
                    <ToggleRow
                        label="Title (always visible)"
                        checked={b()}
                        locked
                    />
                    <ToggleRow
                        label={WRAP_LABEL}
                        checked={c()}
                        onToggle={() => setC(v => !v)}
                        wrap
                    />
                </ToggleList>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const rows = [
            ...canvasElement.querySelectorAll<HTMLElement>(
                '[data-testid="toggle-row"]',
            ),
        ]
        expect(rows[0]!.getAttribute('aria-checked')).toBe('false')
        rows[0]!.focus()
        rows[0]!.dispatchEvent(
            new KeyboardEvent('keydown', { key: ' ', bubbles: true }),
        )
        await new Promise(r => setTimeout(r, 0))
        // keyboard toggles: a regression that drops the onKeyDown handler, or that stops calling
        // preventDefault + onToggle on Space/Enter, leaves this stuck at 'false'
        expect(rows[0]!.getAttribute('aria-checked')).toBe('true')
        // the glyph is a CSS ::before, invisible to textContent — read the pseudo-element instead;
        // a CSS regression that stops painting the 'x' on .on fails here even though aria-checked
        // (a11y state) already passed
        expect(
            getComputedStyle(rows[0]!.querySelector('i')!, '::before')
                .content,
        ).toBe('"x"')
        rows[1]!.click()
        await new Promise(r => setTimeout(r, 0))
        // locked does not change: a regression that lets `toggle()` fire regardless of
        // props.locked would flip this to 'true'
        expect(rows[1]!.getAttribute('aria-checked')).toBe('false')
        // wrap wraps: a regression that drops `.row.wrap { align-items: flex-start }` or the
        // white-space:normal override would keep this row single-line height, equal to rows[0]'s
        expect(
            rows[2]!.getBoundingClientRect().height,
        ).toBeGreaterThan(rows[0]!.getBoundingClientRect().height)
    },
}
