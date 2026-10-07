// Visual spec for <InlineCode> — a short run of inline code inside prose (a property path, a
// setting key, a snippet quoted in a hint). See InlineCode.module.css for where its tokens come
// from — mono chrome font, sized relative to the surrounding text, as a chip on --surface-3 in
// --fg ink, so it reads against a Callout's --surface-1 and its quieter text.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import InlineCode from './InlineCode'
import Text from './Text'
import Callout from './Callout'
import { Row } from './_storyKit'

const meta = {
    title: 'UI/InlineCode',
    component: InlineCode,
    parameters: { layout: 'centered' },
    args: {
        children: 'groupBy: note.status',
    },
} satisfies Meta<typeof InlineCode>

export default meta
type Story = StoryObj<typeof meta>

/** A single code run on its own, at rest. */
export const Playground: Story = {}

/** The actual call site — quoted inside a sentence of prose, matching Kanban's "needs a
 *  groupBy" hint. */
export const InSentence: Story = {
    render: () => (
        <Row label="in a sentence">
            <Text as="span" inherit>
                Add e.g. <InlineCode>groupBy: note.status</InlineCode> to the
                view.
            </Text>
        </Row>
    ),
}

/** Inside a Callout — the surface it actually sits on in the Kanban "no groupBy" hint, showing
 *  the two backgrounds (--surface-1 for the callout, --surface-2 for the code) stay distinct. */
export const InCallout: Story = {
    render: () => (
        <Callout>
            This kanban view needs a "groupBy" property. Add e.g.{' '}
            <InlineCode>groupBy: note.status</InlineCode> to the view.
        </Callout>
    ),
    // "Visibly distinct": the chip's fill and ink both differ from the callout it sits in. The fill
    // used to be one barely-visible step off the callout's own.
    play: async ({ canvasElement }) => {
        const code = canvasElement.querySelector('code') as HTMLElement
        expect(code).not.toBeNull()
        const callout = code.closest('div') as HTMLElement
        const chip = getComputedStyle(code)
        const host = getComputedStyle(callout)
        expect(chip.backgroundColor).not.toBe(host.backgroundColor)
        expect(chip.color).not.toBe(host.color)
    },
}
