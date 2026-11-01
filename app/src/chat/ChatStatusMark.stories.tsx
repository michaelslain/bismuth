// Visual spec for <ChatStatusMark> — the tool row's pending / ok / error mark.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import ChatStatusMark from './ChatStatusMark'

const meta = {
    title: 'Chat/ChatStatusMark',
    component: ChatStatusMark,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof ChatStatusMark>

export default meta
type Story = StoryObj<typeof meta>

export const Pending: Story = { args: { status: 'pending' } }
export const Ok: Story = { args: { status: 'ok' } }
export const Error: Story = { args: { status: 'error' } }
