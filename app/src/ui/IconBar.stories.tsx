import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import IconBar from './IconBar'
import IconButton from './IconButton'

const meta: Meta<typeof IconBar> = {
    title: 'ui/IconBar',
    component: IconBar,
}
export default meta

type Story = StoryObj<typeof IconBar>

export const Default: Story = {
    render: () => (
        <IconBar label="Example toolbar">
            <IconButton icon="Search" label="Search" />
            <IconButton icon="Inbox" label="Inbox" />
            <IconButton icon="Settings" label="Settings" />
        </IconBar>
    ),
}

/** A chrome band — the sidebar row / tab-rail action row shape: min-height var(--h-band), side
 *  padding var(--sp-5), a bottom hairline. */
export const Band: Story = {
    render: () => (
        <IconBar label="Band toolbar" band>
            <IconButton icon="Search" label="Search" />
            <IconButton icon="Inbox" label="Inbox" />
            <IconButton icon="Settings" label="Settings" />
        </IconBar>
    ),
}

/** The collapsed tab rail's shape: icons stack one per line, centred, in a narrow container. */
export const Wrapped: Story = {
    render: () => (
        <div style={{ width: '36px' }}>
            <IconBar label="Wrapped toolbar" layout="wrap">
                <IconButton icon="Search" label="Search" />
                <IconButton icon="Inbox" label="Inbox" />
                <IconButton icon="Settings" label="Settings" />
                <IconButton icon="Star" label="Star" />
            </IconBar>
        </div>
    ),
}

/** A toggle/series member (selected) beside two unselected members — no half-opacity dim inside a
 *  bar (Acceptance 5). */
export const WithSelected: Story = {
    render: () => (
        <IconBar label="Toolbar with a selected member">
            <IconButton icon="Search" label="Search" variant="unselected" />
            <IconButton icon="Inbox" label="Inbox" variant="selected" />
            <IconButton icon="Settings" label="Settings" variant="unselected" />
        </IconBar>
    ),
}

/** A disabled member alongside two enabled ones. */
export const Disabled: Story = {
    render: () => (
        <IconBar label="Toolbar with a disabled member">
            <IconButton icon="Search" label="Search" />
            <IconButton icon="Inbox" label="Inbox" disabled />
            <IconButton icon="Settings" label="Settings" />
        </IconBar>
    ),
}
