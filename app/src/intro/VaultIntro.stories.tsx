// The first-run intro takeover — one story per slide, rendered in the framed IntroWindow.
//
// `startAt` seeds the slide signal so each of the eight slides can be looked at on its own. The real
// first run still opens on 'welcome'.
//
// `layout: 'fullscreen'` is required: .vi-root is `position: fixed; inset: 0`, so a padded or
// centered canvas would clip it rather than show the takeover at its real size. The two sizing
// stories (`ShortWindow`, `Narrow`) wrap it in a transformed box, which becomes the containing block
// of that fixed root. The `(max-height: 47rem)` media query that drops the art box to 16 rows reads
// the BROWSER viewport, which a story cannot change, so ShortWindow shows the fixed root squeezed into
// 640px rather than the 16-row art box itself.
//
// Reduced motion (the glyph scenes and the typed-in copy switch to their resting frame under
// `prefers-reduced-motion`) cannot be emulated from inside a story, so it has no story.
import type { JSX } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import VaultIntro from './VaultIntro'
import { SLIDES } from './introSlides'

const meta = {
    title: 'Intro/VaultIntro',
    component: VaultIntro,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof VaultIntro>

export default meta
type Story = StoryObj<typeof meta>

/** A box that becomes the containing block of the fixed root, so a story can size the takeover. */
const Box =
    (size: { width?: string; height?: string }) =>
    (Story: () => JSX.Element) => (
        <div
            style={{
                position: 'relative',
                transform: 'translateZ(0)',
                width: size.width ?? '100%',
                height: size.height ?? '100vh',
                overflow: 'hidden',
            }}
        >
            <Story />
        </div>
    )

/** Slide 1 — the hero wordmark (sheen sweeping across it) and the pitch. */
export const Welcome: Story = { args: { startAt: 'welcome' } }

/** Slide 2 — the four theme cards in one row; picking one re-themes the window live. */
export const Theme: Story = { args: { startAt: 'theme' } }

/** Slide 3 — "Three brains, one mind": the big graph cloud drawn inside the art box. */
export const Graph: Story = { args: { startAt: 'graph' } }

/** Slide 4 — the daemon as glyph art: a status prompt, three cron rows and a log. */
export const Daemon: Story = { args: { startAt: 'daemon' } }

/** Slide 5 — the agents glyph scene, above copy naming the supported agent backends (the longest
 *  body of the eight). */
export const Agents: Story = { args: { startAt: 'agents' } }

/** Slide 6 with no agent CLI found: the free agent alone, selected. */
export const PickAgentNone: Story = {
    args: { startAt: 'pickagent', detectedAgents: [] },
}

/** Slide 6 with Claude Code and Codex found: three cards, the first installed one selected. */
export const PickAgentSome: Story = {
    args: { startAt: 'pickagent', detectedAgents: ['claude', 'codex'] },
}

/** Slide 7 — the two power-up cards, both on by default. */
export const PowerUps: Story = { args: { startAt: 'powerups' } }

/** Slide 8 — the hero wordmark over an `> open vault_` prompt; the footer's primary reads
 *  `[enter your vault]`. */
export const Begin: Story = { args: { startAt: 'begin' } }

/** Slide 2 with the paper theme picked: the selection ring and the whole window in the light palette. */
export const ThemePaperPicked: Story = {
    args: { startAt: 'theme', initialTheme: 'paper' },
}

/** Slide 7 with the cli + mcp power-up switched off, then daemon toggled from the keyboard. */
export const PowerUpOff: Story = {
    args: { startAt: 'powerups' },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const cli = canvas.getByRole('switch', { name: /cli \+ mcp/i })
        const daemon = canvas.getByRole('switch', { name: /daemon/i })
        await expect(cli.getAttribute('aria-checked')).toBe('true')
        await userEvent.click(cli)
        await waitFor(() =>
            expect(cli.getAttribute('aria-checked')).toBe('false'),
        )
        daemon.focus()
        await userEvent.keyboard(' ')
        await waitFor(() =>
            expect(daemon.getAttribute('aria-checked')).toBe('false'),
        )
    },
}

/** Slide 8 while the native folder picker is open: the primary reads `[opening…]` and is
 *  disabled. The never-resolving `onEnter` holds that state. */
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

/** The headline sits at one y on every slide, and the art box is the same size. Walks all eight
 *  slides with the real next button (stopping before the last, which enters the vault) and compares
 *  each slide to slide 1. */
export const Geometry: Story = {
    args: { startAt: 'welcome' },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const h1 = () => canvasElement.querySelector('h1') as HTMLElement
        const slot = (name: string) =>
            canvasElement.querySelector(
                `[data-intro-slot="${name}"]`,
            ) as HTMLElement
        const measure = () => {
            const art = slot('art').getBoundingClientRect()
            return {
                artTop: art.top,
                artH: art.height,
                h1Top: h1().getBoundingClientRect().top,
                footerTop: slot('footer').getBoundingClientRect().top,
            }
        }
        // The headline's words without the typing cursor (an aria-hidden `_` that rides the title
        // while it types). The full title is in the DOM from the first frame.
        const words = () => {
            const copy = h1().cloneNode(true) as Element
            copy.querySelectorAll('[data-cursor]').forEach(c => c.remove())
            return copy.textContent
        }
        await waitFor(() => expect(words()).toBe(SLIDES[0].title))
        const first = measure()
        const rowH = parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue(
                '--row-h',
            ),
        )
        await expect(first.artH).toBeLessThanOrEqual(18 * rowH)
        for (let i = 1; i < SLIDES.length; i++) {
            await userEvent.click(canvas.getByRole('button', { name: /next/ }))
            await waitFor(() => expect(words()).toBe(SLIDES[i].title))
            const m = measure()
            for (const k of Object.keys(first) as (keyof typeof first)[])
                await expect(m[k], `slide ${i + 1} ${k}`).toBeCloseTo(
                    first[k],
                    0,
                )
        }
    },
}

/** The glyph heroes on the light themes (paper, riso): glyphs are dark on light, which the token
 *  mapping gives for free. These exist so a hero that vanishes on a light background is visible. */
export const WelcomePaper: Story = {
    args: { startAt: 'welcome', initialTheme: 'paper' },
}
export const DaemonPaper: Story = {
    args: { startAt: 'daemon', initialTheme: 'paper' },
}
export const AgentsPaper: Story = {
    args: { startAt: 'agents', initialTheme: 'paper' },
}
export const PickAgentSomePaper: Story = {
    args: {
        startAt: 'pickagent',
        detectedAgents: ['claude', 'codex'],
        initialTheme: 'paper',
    },
}
export const BeginPaper: Story = {
    args: { startAt: 'begin', initialTheme: 'paper' },
}
export const WelcomeRiso: Story = {
    args: { startAt: 'welcome', initialTheme: 'riso' },
}
export const DaemonRiso: Story = {
    args: { startAt: 'daemon', initialTheme: 'riso' },
}

/** A 640px-tall stage: the footer must stay on screen. */
export const ShortWindow: Story = {
    args: { startAt: 'agents' },
    decorators: [Box({ height: '640px' })],
}

/** An 860px-wide stage, agents slide: the window shrinks to `100% - 2 * --sp-7` and the longest
 *  body must fit the copy slot without clipping. */
export const Narrow: Story = {
    args: { startAt: 'agents' },
    decorators: [Box({ width: '860px' })],
}
