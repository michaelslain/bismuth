// Visual spec for <ErrorText> — inline error text: `Text` in the danger tone, always carrying
// role="alert" so the message is announced when it appears. Eight surfaces used to hand-roll this
// as a bare div/span with a local red, and only two of them set the role.
//
// Props: children, class.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import ErrorText from './ErrorText'
import Text from './Text'
import { Row } from './_storyKit'

const meta = {
    title: 'UI/ErrorText',
    component: ErrorText,
    parameters: { layout: 'centered' },
    argTypes: { children: { control: 'text' } },
    args: { children: 'Could not save — the vault is read-only.' },
} satisfies Meta<typeof ErrorText>

export default meta
type Story = StoryObj<typeof meta>

/** The whole reason the component exists: the node is an alert, and it reads in the danger ink. */
export const Default: Story = {
    play: async ({ canvasElement }) => {
        const el = canvasElement.querySelector<HTMLElement>('[role="alert"]')
        expect(el).not.toBeNull()
        expect(el!.textContent).toContain('Could not save')
        const probe = document.createElement('span')
        probe.style.color = 'var(--danger)'
        canvasElement.appendChild(probe)
        expect(getComputedStyle(el!).color).toBe(getComputedStyle(probe).color)
        probe.remove()
    },
}

/** In a field, under the input it describes — the shape every converted call site takes. */
export const BesideAField: Story = {
    render: () => (
        <div
            style={{
                display: 'flex',
                'flex-direction': 'column',
                gap: 'var(--sp-2)',
                width: '260px',
            }}
        >
            <Text size="ui" tone="muted">
                Output path
            </Text>
            <div
                style={{
                    border: '1px solid var(--border)',
                    padding: 'var(--sp-2) var(--sp-3)',
                    background: 'var(--panel)',
                }}
            >
                /Volumes/missing/export.pdf
            </div>
            <ErrorText>That folder does not exist.</ErrorText>
        </div>
    ),
    play: async ({ canvasElement }) => {
        expect(canvasElement.querySelectorAll('[role="alert"]').length).toBe(1)
    },
}

/** A long unbroken message (a path) wraps inside its box and shrinks inside a flex row instead of
 *  pushing the row's other items out — `Text`'s `overflow-wrap: anywhere` does that; the stylesheet
 *  ErrorText once carried for it (`min-width: 0`) had no effect and was deleted. */
export const LongMessageInARow: Story = {
    render: () => (
        <Row label="260px flex row" column>
            <div
                data-error-row
                style={{
                    display: 'flex',
                    gap: 'var(--sp-3)',
                    width: '260px',
                    border: '1px solid var(--border)',
                    padding: 'var(--sp-2) var(--sp-3)',
                    background: 'var(--panel)',
                }}
            >
                <ErrorText>
                    ENOENT: no such file or directory, open
                    /Users/someone/Documents/vault/exports/a-very-long-unbroken-name-1234567890.pdf
                </ErrorText>
            </div>
        </Row>
    ),
    play: async ({ canvasElement }) => {
        const row = canvasElement.querySelector<HTMLElement>('[data-error-row]')!
        const err = row.querySelector<HTMLElement>('[role="alert"]')!
        expect(err.getBoundingClientRect().right).toBeLessThanOrEqual(
            row.getBoundingClientRect().right,
        )
    },
}
