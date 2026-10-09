// The first-run intro takeover — one story per slide, rendered in the framed IntroWindow.
//
// `startAt` seeds the slide signal so each of the eight slides can be looked at on its own. The real
// first run still opens on 'welcome'.
//
// `layout: 'fullscreen'` is required: .vi-root is `position: fixed; inset: 0`, so a padded or
// centered canvas would clip it rather than show the takeover at its real size. The two sizing
// stories (`ShortWindow`, `Narrow`) wrap it in a transformed box, which becomes the containing block
// of that fixed root. The short-window step that drops the art box to 16 rows is a CONTAINER query on
// that root (`@container (max-height: 44rem)`), so ShortWindow's 640px box really renders it. A
// container query measures the root's CONTENT box (its `--sp-7` padding comes off both ends), which
// is why `DefaultWindow`'s 800px app window must keep the full 24 rows.
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

/** Slide 2 — the theme names in one row; picking one re-themes the window live. */
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

/** Slide 8 — the hero wordmark over the copy; the footer's primary, `[enter your vault]`, is the
 *  slide's one call to action. */
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

/** The window is the same size on every slide, and each slide's art and copy sit centred in the
 *  body as one group. Walks all eight slides with the real next button (stopping before the last,
 *  which enters the vault). */
export const Geometry: Story = {
    args: { startAt: 'welcome' },
    // A 900px stage, over the 44rem short-window step: the art height is the full 24 rows whatever
    // the browser viewport is (the step reads this box, not the viewport).
    decorators: [Box({ height: '900px' })],
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const h1 = () => canvasElement.querySelector('h1') as HTMLElement
        const slot = (name: string) =>
            canvasElement.querySelector(
                `[data-intro-slot="${name}"]`,
            ) as HTMLElement
        const measure = () => {
            const body = slot('art').parentElement!.getBoundingClientRect()
            const art = slot('art').getBoundingClientRect()
            const text = slot('text').getBoundingClientRect()
            return {
                footerTop: slot('footer').getBoundingClientRect().top,
                bodyH: body.height,
                // Above-the-art minus below-the-copy: 0 when the group is centred.
                skew: art.top - body.top - (body.bottom - text.bottom),
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
        await expect(first.skew).toBeCloseTo(0, 0)
        for (let i = 1; i < SLIDES.length; i++) {
            await userEvent.click(canvas.getByRole('button', { name: /next/ }))
            await waitFor(() => expect(words()).toBe(SLIDES[i].title))
            const m = measure()
            await expect(m.footerTop, `slide ${i + 1} footerTop`).toBeCloseTo(first.footerTop, 0)
            await expect(m.bodyH, `slide ${i + 1} bodyH`).toBeCloseTo(first.bodyH, 0)
            await expect(Math.abs(m.skew), `slide ${i + 1} skew`).toBeLessThan(2)
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

/** A 640px-tall stage: the glyph art is the 16-row step and the footer stays on screen. */
export const ShortWindow: Story = {
    args: { startAt: 'agents' },
    decorators: [Box({ height: '640px' })],
    play: async ({ canvasElement }) => {
        const rowH = parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue(
                '--row-h',
            ),
        )
        const slot = (name: string) =>
            canvasElement.querySelector(
                `[data-intro-slot="${name}"]`,
            ) as HTMLElement
        await waitFor(() =>
            expect(slot('art').getBoundingClientRect().height).toBeCloseTo(
                16 * rowH,
                0,
            ),
        )
        await expect(
            slot('footer').getBoundingClientRect().bottom,
        ).toBeLessThanOrEqual(canvasElement.getBoundingClientRect().bottom)
    },
}

/** The app's DEFAULT 1200x800 window: the glyph art keeps the full 24 rows. The short-window step is a
 *  container query, which reads the root's CONTENT box (800px minus two `--sp-7` paddings = 752px),
 *  so a threshold written in viewport terms (47rem = 752px, inclusive) fires exactly here. Geometry
 *  (900px) and ShortWindow (640px) sit either side of that boundary and cannot see it. */
export const DefaultWindow: Story = {
    args: { startAt: 'daemon' },
    decorators: [Box({ height: '800px' })],
    play: async ({ canvasElement }) => {
        const rowH = parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue(
                '--row-h',
            ),
        )
        const art = canvasElement.querySelector(
            '[data-intro-slot="art"]',
        ) as HTMLElement
        await waitFor(() =>
            expect(art.getBoundingClientRect().height).toBeCloseTo(24 * rowH, 0),
        )
    },
}

/** An 860px-wide stage, agents slide: the window shrinks to `100% - 2 * --sp-7` and the longest
 *  body must fit the copy slot without clipping. */
export const Narrow: Story = {
    args: { startAt: 'agents' },
    decorators: [Box({ width: '860px' })],
}
