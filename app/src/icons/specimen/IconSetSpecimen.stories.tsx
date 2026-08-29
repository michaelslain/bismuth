// app/src/icons/specimen/IconSetSpecimen.stories.tsx
//
// The specimen story that recorded the icon-set decision — see IconSetSpecimen.tsx's header
// comment and .claude/plans/2026-08-27-visual-unification-audit.md §10.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import IconSetSpecimen from './IconSetSpecimen'

const meta = {
    title: 'icons/icon-set-specimen',
    component: IconSetSpecimen,
} satisfies Meta<typeof IconSetSpecimen>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
