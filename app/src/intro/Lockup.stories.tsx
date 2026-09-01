// Visual spec for <Lockup> — the first-run intro's small PERSISTENT brand mark: the vault's
// chosen logo (settings.appearance.icon, /logos/<icon>.svg) with no wordmark beside it. Sits
// through the whole intro flow as the one constant element while the surrounding steps change.
//
// A colocated file, matching this repo's `<Component>.tsx` + `<Component>.stories.tsx`
// convention — `intro/IntroMarks.stories.tsx` already renders this component too (a combined
// spec for both Lockup and its sibling WordmarkHero, kept for the direct A/B between them). This
// file is the dedicated one so the component is discoverable by name, not only inside the pair.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import Lockup from './Lockup'
import '../App.css'

const meta = {
    title: 'Intro/Lockup',
    component: Lockup,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof Lockup>

export default meta
type Story = StoryObj<typeof meta>

/** The schema default logo mark (`hopper-crystal`) — the everyday state, mark only. */
export const Default: Story = {
    render: () => <Lockup icon="hopper-crystal" />,
}

/** A different logo mark — proves `icon` (the component's one prop) actually swaps the
 *  rendered art rather than a cached/hardcoded asset. */
export const AlternateMark: Story = {
    render: () => <Lockup icon="pinwheel" />,
}
