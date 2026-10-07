// Visual spec for <Disclosure> — a summary button (chevron LEADING, `aria-expanded`) over a
// height-animating body. Replaces five hand-built disclosures that put the chevron on opposite
// sides, set no `aria-expanded`, and indented the body by a hardcoded 20px or 22px.
//
// Props: open (required), onToggle (required), summary (required), children (required), class.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor } from 'storybook/test'
import { createSignal } from 'solid-js'
import Disclosure from './Disclosure'
import IconButton from './IconButton'
import Text from './Text'

const meta = {
    title: 'UI/Disclosure',
    component: Disclosure,
    parameters: { layout: 'padded' },
    args: {
        open: false,
        onToggle: () => {},
        summary: 'thinking',
        children: 'body',
    },
} satisfies Meta<typeof Disclosure>

export default meta
type Story = StoryObj<typeof meta>

const shell = { width: '320px' }
const BODY = 'the model weighed three approaches and picked the one that kept the diff small.'

/** Closed: the chevron points right and LEADS the summary; `aria-expanded="false"`. */
export const Closed: Story = {
    render: () => (
        <div style={shell}>
            <Disclosure open={false} onToggle={() => {}} summary={<Text as="span" inherit>thinking</Text>}>
                <Text as="p" size="micro" tone="muted">{BODY}</Text>
            </Disclosure>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const btn = canvasElement.querySelector('button') as HTMLElement
        expect(btn.getAttribute('aria-expanded')).toBe('false')
        const chev = btn.firstElementChild as HTMLElement
        const sum = btn.lastElementChild as HTMLElement
        // the chevron is to the LEFT of the summary text
        expect(chev.getBoundingClientRect().right).toBeLessThanOrEqual(sum.getBoundingClientRect().left)
        expect(getComputedStyle(chev).transform).toBe('none')
        expect(canvasElement.textContent).not.toContain('three approaches')
    },
}

/** Open: the chevron has turned a quarter turn down and the body hangs under the summary text,
 *  indented by `--disclosure-indent` (chevron width + gap). */
export const Open: Story = {
    render: () => (
        <div style={shell}>
            <Disclosure open onToggle={() => {}} summary={<Text as="span" inherit>thinking</Text>}>
                <Text as="p" size="micro" tone="muted">{BODY}</Text>
            </Disclosure>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const btn = canvasElement.querySelector('button') as HTMLElement
        expect(btn.getAttribute('aria-expanded')).toBe('true')
        const chev = btn.firstElementChild as HTMLElement
        expect(getComputedStyle(chev).transform).not.toBe('none')
        await waitFor(() => expect(canvasElement.textContent).toContain('three approaches'))
        const body = canvasElement.querySelector('p') as HTMLElement
        const sum = btn.lastElementChild as HTMLElement
        // the summary's own text node starts after the chevron; its left edge is the summary box's
        // the body starts under the summary text, not under the chevron
        await waitFor(() =>
            expect(Math.abs(body.getBoundingClientRect().left - sum.getBoundingClientRect().left)).toBeLessThan(1),
        )
    },
}

/** The real composition: click toggles, `aria-expanded` follows. */
export const Interactive: Story = {
    render: () => {
        const [open, setOpen] = createSignal(false)
        return (
            <div style={shell}>
                <Disclosure
                    open={open()}
                    onToggle={() => setOpen(o => !o)}
                    summary={<Text as="span" inherit>bash // ls -la</Text>}
                >
                    <Text as="p" size="micro" tone="muted">{BODY}</Text>
                </Disclosure>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const btn = canvasElement.querySelector('button') as HTMLElement
        await userEvent.click(btn)
        expect(btn.getAttribute('aria-expanded')).toBe('true')
        await waitFor(() => expect(canvasElement.textContent).toContain('three approaches'))
        await userEvent.click(btn)
        expect(btn.getAttribute('aria-expanded')).toBe('false')
        await waitFor(() => expect(canvasElement.textContent).not.toContain('three approaches'), { timeout: 2000 })
    },
}

/** `trailing`: a control at the END of the head line, BESIDE the toggle button — never inside it. A
 *  button nested in a button put the eye into the disclosure's accessible name; here the toggle's
 *  name is only its summary, and a click on the trailing control does not toggle. */
export const TrailingControl: Story = {
    render: () => {
        const [open, setOpen] = createSignal(false)
        const [clicks, setClicks] = createSignal(0)
        return (
            <div style={shell}>
                <Disclosure
                    open={open()}
                    onToggle={() => setOpen(o => !o)}
                    summary={
                        <Text as="span" inherit>
                            price
                        </Text>
                    }
                    trailing={
                        <IconButton
                            icon="Eye"
                            label="hide price"
                            onClick={() => setClicks(c => c + 1)}
                        />
                    }
                >
                    <Text as="p" size="micro" tone="muted">
                        {BODY}
                    </Text>
                </Disclosure>
                <span hidden data-testid="clicks">
                    {clicks()}
                </span>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const toggle = canvasElement.querySelector(
            '[aria-expanded]',
        ) as HTMLElement
        expect(toggle.querySelector('button')).toBeNull()
        expect(toggle.textContent).not.toContain('hide price')
        await userEvent.click(
            canvasElement.querySelector(
                '[aria-label="hide price"]',
            ) as HTMLElement,
        )
        expect(toggle.getAttribute('aria-expanded')).toBe('false')
        expect(
            canvasElement.querySelector('[data-testid="clicks"]')!.textContent,
        ).toBe('1')
        await userEvent.click(toggle)
        expect(toggle.getAttribute('aria-expanded')).toBe('true')
    },
}
