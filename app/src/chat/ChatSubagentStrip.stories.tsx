// Visual spec for <ChatSubagentStrip> — the agents strip above the composer.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, within } from 'storybook/test'
import ChatSubagentStrip from './ChatSubagentStrip'
import type { ChatSubagent } from '../../../core/src/chatSubagentTypes'

const meta = {
    title: 'Chat/ChatSubagentStrip',
    component: ChatSubagentStrip,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof ChatSubagentStrip>

export default meta
type Story = StoryObj<typeof meta>

const agent = (
    id: string,
    agentType: string,
    description: string,
    status: ChatSubagent['status'],
): ChatSubagent => ({ id, agentType, description, status })

export const Running: Story = {
    args: {
        agents: [
            agent('1', 'Explore', 'map the chat transcript pipeline', 'running'),
            agent('2', 'general-purpose', 'find every caller of deliver', 'running'),
        ],
    },
}

export const Mixed: Story = {
    args: {
        agents: [
            agent('1', 'Explore', 'map the chat transcript pipeline', 'running'),
            agent('2', 'general-purpose', 'find every caller of deliver', 'done'),
            agent('3', 'Plan', 'draft the migration', 'failed'),
        ],
    },
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await expect(c.getByText('draft the migration')).toBeTruthy()
    },
}

export const AllDone: Story = {
    args: {
        agents: [
            agent('1', 'Explore', 'map the chat transcript pipeline', 'done'),
            agent('2', 'general-purpose', 'find every caller of deliver', 'done'),
            agent('3', 'Plan', 'draft the migration', 'done'),
        ],
    },
}

export const LongDescription: Story = {
    render: args => (
        <div style={{ width: '360px' }}>
            <ChatSubagentStrip {...args} />
        </div>
    ),
    args: {
        agents: [
            agent(
                '1',
                'general-purpose',
                'investigate why the daemon page chat drops the second queued message after a stop and restore',
                'running',
            ),
            agent('2', 'Explore', 'short one', 'failed'),
        ],
    },
}

export const Overflow: Story = {
    args: {
        agents: Array.from({ length: 8 }, (_, i) =>
            agent(
                String(i),
                'Explore',
                `survey area ${i + 1}`,
                i < 5 ? 'done' : 'running',
            ),
        ),
    },
}

export const LongType: Story = {
    render: args => (
        <div style={{ width: '360px' }}>
            <ChatSubagentStrip {...args} />
        </div>
    ),
    args: {
        agents: [
            agent(
                '1',
                'Agentic Identity & Trust Architect',
                'audit the agent signing flow',
                'running',
            ),
            agent('2', 'Explore', 'short one', 'done'),
        ],
    },
}

export const Empty: Story = { args: { agents: [] } }
