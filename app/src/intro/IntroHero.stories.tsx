// The per-slide hero box of the first-run intro, one story per kind. The `.vi-hero` box (620px,
// capped at 86vw / 42vh) and the slide-in animation live here now, so these are the frames a new
// user sees on the welcome/begin, daemon and agents slides.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import { DEFAULTS } from '../settings'
import IntroHero from './IntroHero'

const meta = {
    title: 'Intro/IntroHero',
    component: IntroHero,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof IntroHero>

export default meta
type Story = StoryObj<typeof meta>

/** The welcome/begin slides: the logo mark over the wordmark. */
export const Wordmark: Story = {
    args: { hero: 'wordmark', icon: DEFAULTS.appearance.icon },
    play: async ({ canvasElement }) => {
        expect(canvasElement.querySelector('img')).not.toBeNull()
    },
}

/** The daemon slide: the live-daemon terminal panel. */
export const Daemon: Story = {
    args: { hero: 'daemon', icon: DEFAULTS.appearance.icon },
    play: async ({ canvasElement }) => {
        expect(canvasElement.textContent).toContain('daemon // live')
    },
}

/** The agents slide: the chat transcript panel. */
export const Agents: Story = {
    args: { hero: 'agents', icon: DEFAULTS.appearance.icon },
    play: async ({ canvasElement }) => {
        expect(canvasElement.textContent).toContain('[ chat ]')
    },
}
