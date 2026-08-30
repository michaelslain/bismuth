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
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
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

/** Slide 5 — the Claude Code / MCP terminal panel. */
export const Claude: Story = { args: { startAt: 'claude' } }

/** Slide 6 — the optional power-up rows, both toggled on by default. */
export const PowerUps: Story = { args: { startAt: 'powerups' } }

/** Slide 7 — the terminal slide carrying the one bracket-primary CTA. */
export const Begin: Story = { args: { startAt: 'begin' } }
