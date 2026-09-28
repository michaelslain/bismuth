// Visual spec for <Band> — the chrome band every header strip shares: --h-band tall, --sp-5 side
// padding, a --rule-soft bottom hairline. ViewBar and a `band` IconBar both render through it.
//
// Props: class (the composer's own layout), children, plus any div attribute.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import Band from './Band'
import IconBar from './IconBar'
import IconButton from './IconButton'
import ViewBar, { Crumb } from './ViewBar'
import Text from './Text'

const meta = {
    title: 'UI/Band',
    component: Band,
} satisfies Meta<typeof Band>

export default meta
type Story = StoryObj<typeof meta>

/** A bare band with one line of text — the box alone. */
export const Default: Story = {
    render: () => (
        <div style={{ width: '280px' }}>
            <Band>
                <Text as="span" size="ui" tone="muted">
                    a band
                </Text>
            </Band>
        </div>
    ),
}

/** Its two composers stacked in one column: the first bracket of each starts on the same x. */
export const Composers: Story = {
    render: () => (
        <div style={{ width: '280px' }}>
            <IconBar label="Toolbar band" band>
                <IconButton icon="FilePlus" label="New note" />
                <IconButton icon="Inbox" label="Inbox" />
                <IconButton icon="Settings" label="Settings" />
            </IconBar>
            <ViewBar identity={<Crumb icon="Share2">Knowledge Graph</Crumb>} />
        </div>
    ),
}
