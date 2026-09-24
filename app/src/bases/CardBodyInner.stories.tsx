import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import CardBodyInner from './CardBodyInner'

const meta = {
    title: 'Bases/CardBodyInner',
    component: CardBodyInner,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof CardBodyInner>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
    args: { children: <div>Title</div> },
}
