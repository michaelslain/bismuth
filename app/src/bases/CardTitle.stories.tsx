import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import CardTitle from './CardTitle'

const meta = {
    title: 'Bases/CardTitle',
    component: CardTitle,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof CardTitle>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
    args: { children: 'The Left Hand of Darkness' },
}
