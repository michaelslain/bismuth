// The first-run intro takeover — one story per slide.
//
// THE WHOLE SEVEN-SLIDE FLOW RENDERED IN NO STORY AT ALL until now. VaultIntro took no props
// and kept the current slide in a private signal, so only slide 0 was ever reachable and the
// other six — including the two that mount a live 3D graph — were invisible to visual
// verification. `startAt` (added with these stories) seeds that signal so each slide can be
// looked at on its own. The real first run still opens on 'welcome'.
//
// `layout: 'fullscreen'` is required: .vi-root is `position: fixed; inset: 0`, so a padded
// or centered canvas would clip it rather than show the takeover at its real size.
//
// Reduced motion (the slide-in enter animations switch off under `prefers-reduced-motion`) cannot
// be emulated from inside a story — it is a browser-level media feature — so it has no story.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import VaultIntro from './VaultIntro'

const meta = {
    title: 'Intro/VaultIntro',
    component: VaultIntro,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof VaultIntro>

export default meta
type Story = StoryObj<typeof meta>

/** Slide 1 — the wordmark hero and the pitch. What a new user sees first. */
export const Welcome: Story = { args: { startAt: 'welcome' } }

/** Slide 2 — the four-swatch theme picker over a full-bleed 3D graph that recolors live. */
export const Theme: Story = { args: { startAt: 'theme' } }

/** Slide 3 — "Three brains, one mind": the same graph, condensed into a foreground hero. */
export const Graph: Story = { args: { startAt: 'graph' } }

/** Slide 4 — the daemon terminal panel. */
export const Daemon: Story = { args: { startAt: 'daemon' } }

/** Slide 5 — the chat/MCP terminal panel, over copy naming the supported agent backends. */
export const Agents: Story = { args: { startAt: 'agents' } }

/** Slide 6 — the optional power-up rows, both toggled on by default. */
export const PowerUps: Story = { args: { startAt: 'powerups' } }

/** Slide 7 — the terminal slide carrying the one bracket-primary CTA. */
export const Begin: Story = { args: { startAt: 'begin' } }

/** Slide 2 with the paper theme picked: the picker's selection ring, the swatch preview and the
 *  whole takeover (graph included) in the light palette. */
export const ThemePaperPicked: Story = {
    args: { startAt: 'theme', initialTheme: 'paper' },
}

/** Slide 6 with the CLI + MCP power-up switched off, then DAEMON toggled from the keyboard. */
export const PowerUpOff: Story = {
    args: { startAt: 'powerups' },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const cli = canvas.getByRole('switch', { name: /CLI \+ MCP/ })
        const daemon = canvas.getByRole('switch', { name: /DAEMON/ })
        await expect(cli.getAttribute('aria-checked')).toBe('true')
        await userEvent.click(cli)
        await waitFor(() => expect(cli.getAttribute('aria-checked')).toBe('false'))
        daemon.focus()
        await userEvent.keyboard(' ')
        await waitFor(() =>
            expect(daemon.getAttribute('aria-checked')).toBe('false'),
        )
    },
}

/** Slide 7 while the native folder picker is open: the CTA reads `opening…` and is disabled.
 *  The never-resolving `onEnter` holds that state. */
export const BeginBusy: Story = {
    args: { startAt: 'begin', onEnter: () => new Promise(() => {}) },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await userEvent.click(
            canvas.getByRole('button', { name: /enter your vault/ }),
        )
        const cta = await canvas.findByRole('button', { name: /opening…/ })
        await expect((cta as HTMLButtonElement).disabled).toBe(true)
    },
}

/** Slide 1 at a phone width: the headline steps down from 48px (`--fs-hero-xl`) to 40px
 *  (`--fs-hero`) below 980px. */
export const NarrowTitle: Story = {
    args: { startAt: 'welcome' },
    globals: { viewport: { value: 'mobile2', isRotated: false } },
    play: async ({ canvasElement }) => {
        const h1 = canvasElement.querySelector('h1') as HTMLElement
        await expect(getComputedStyle(h1).fontSize).toBe('40px')
    },
}
