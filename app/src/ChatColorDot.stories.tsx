// Visual spec for <ChatColorDot> — the swatch dot used in a chat tab's Color submenu (App.tsx's
// openTabContextMenu). See ChatColorDot.tsx for why this is its own component.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import ChatColorDot from './ChatColorDot'
import { Row } from './ui/_storyKit'
import { CHAT_COLOR_SWATCHES } from './chatColors'

const meta = {
    title: 'Chat/ChatColorDot',
    component: ChatColorDot,
    parameters: { layout: 'centered' },
    argTypes: {
        color: { control: 'color' },
        none: { control: 'boolean' },
    },
    args: {
        color: '#e0a030',
        none: false,
    },
} satisfies Meta<typeof ChatColorDot>

export default meta
type Story = StoryObj<typeof meta>

/** Fully controllable single dot. */
export const Playground: Story = {}

/** Every swatch the Color submenu actually offers, plus the "none"/Reset ring. */
export const AllSwatches: Story = {
    render: () => (
        <Row label="Color submenu swatches" gap="10px">
            {CHAT_COLOR_SWATCHES.map(sw => (
                <ChatColorDot color={sw.value} />
            ))}
            <ChatColorDot none />
        </Row>
    ),
}
