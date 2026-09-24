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
