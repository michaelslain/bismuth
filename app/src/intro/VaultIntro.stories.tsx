// The first-run intro takeover — one story per slide.
//
// THE WHOLE EIGHT-SLIDE FLOW RENDERED IN NO STORY AT ALL until now. VaultIntro took no props
// and kept the current slide in a private signal, so only slide 0 was ever reachable and the
// other six — including the two that mount a live 3D graph — were invisible to visual
// verification. `startAt` (added with these stories) seeds that signal so each slide can be
// looked at on its own. The real first run still opens on 'welcome'.
//
// `layout: 'fullscreen'` is required: .vi-root is `position: fixed; inset: 0`, so a padded
// or centered canvas would clip it rather than show the takeover at its real size.
//
// Reduced motion (the glyph scenes and the typed-in copy switch to their resting frame under `prefers-reduced-motion`) cannot
// be emulated from inside a story — it is a browser-level media feature — so it has no story.
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

/** Slide 1 — the `bismuth` block-letter wordmark (glyph art, sheen sweeping across it) and the
 *  pitch. What a new user sees first. */
export const Welcome: Story = { args: { startAt: 'welcome' } }

/** Slide 2 — the four-swatch theme picker over a full-bleed 3D graph that recolors live. */
export const Theme: Story = { args: { startAt: 'theme' } }

/** Slide 3 — "Three brains, one mind": the same graph, condensed into a foreground hero. */
export const Graph: Story = { args: { startAt: 'graph' } }

/** Slide 4 — the daemon as glyph art: a status prompt, three cron rows and a log. */
export const Daemon: Story = { args: { startAt: 'daemon' } }

/** Slide 5 — the agents glyph scene: agent names converging on MCP over the vault, above copy
 *  naming the supported agent backends. */
export const Agents: Story = { args: { startAt: 'agents' } }

/** Slide 6 with no agent CLI found: the free agent alone, centred, selected. */
export const PickAgentNone: Story = {
    args: { startAt: 'pickagent', detectedAgents: [] },
}

/** Slide 6 with Claude Code and Codex found: three cards, the first installed one selected. */
export const PickAgentSome: Story = {
    args: { startAt: 'pickagent', detectedAgents: ['claude', 'codex'] },
}

/** Slide 7 — the optional power-up rows, both toggled on by default. */
export const PowerUps: Story = { args: { startAt: 'powerups' } }

/** Slide 8 — the formed wordmark over an `> open vault_` prompt, with the one bracket-primary CTA
 *  under the copy. */
export const Begin: Story = { args: { startAt: 'begin' } }

/** Slide 2 with the paper theme picked: the picker's selection ring, the swatch preview and the
 *  whole takeover (graph included) in the light palette. */
export const ThemePaperPicked: Story = {
    args: { startAt: 'theme', initialTheme: 'paper' },
}

/** Slide 7 with the cli + mcp power-up switched off, then daemon toggled from the keyboard. */
export const PowerUpOff: Story = {
    args: { startAt: 'powerups' },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const cli = canvas.getByRole('switch', { name: /cli \+ mcp/ })
        const daemon = canvas.getByRole('switch', { name: /daemon/ })
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
 *  (`--fs-hero`) below 980px. The `viewport` global only resizes the preview inside Storybook's
 *  own manager; the bare iframe the sweeps drive keeps the browser's width, so the assertion
 *  follows whichever side of 980px the frame actually landed on — 40px at `mobile2` in the
 *  manager, 48px in a full-width sweep. */
export const NarrowTitle: Story = {
    args: { startAt: 'welcome' },
    globals: { viewport: { value: 'mobile2', isRotated: false } },
    play: async ({ canvasElement }) => {
        const h1 = canvasElement.querySelector('h1') as HTMLElement
        const narrow = window.matchMedia('(max-width: 980px)').matches
        await expect(getComputedStyle(h1).fontSize).toBe(narrow ? '40px' : '48px')
    },
}

const SLIDE_COUNT = SLIDES.length

/** Every slide's hero box, headline and nav sit at the same y, and the hero box is the same size.
 *  Walks all eight slides with the real Next button (stopping before the last Next, which enters
 *  the vault) and compares each slide's numbers to slide 1's. It also pins the box to its spec
 *  (16 rows x 1.5 glyph scale, so a frame that is uniformly wrong cannot pass) and checks each
 *  slide's copy ends above the nav. */
export const Geometry: Story = {
    args: { startAt: 'welcome' },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const h1 = () => canvasElement.querySelector('h1') as HTMLElement
        const slot = (name: string) =>
            canvasElement.querySelector(`[data-intro-slot="${name}"]`) as HTMLElement
        const measure = () => {
            const hero = slot('hero').getBoundingClientRect()
            return {
                heroTop: hero.top,
                h1Top: h1().getBoundingClientRect().top,
                textTop: slot('text').getBoundingClientRect().top,
                navTop: slot('nav').getBoundingClientRect().top,
                heroW: hero.width,
                heroH: hero.height,
            }
        }
        // The copy's last element must end above the nav: a 3-line body must not run into it.
        const expectClearOfNav = async (i: number, navTop: number) => {
            const last = slot('text').lastElementChild as HTMLElement
            await expect(
                last.getBoundingClientRect().bottom,
                `slide ${i + 1} copy bottom vs nav top`,
            ).toBeLessThanOrEqual(navTop)
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
            getComputedStyle(document.documentElement).getPropertyValue('--row-h'),
        )
        await expect(first.heroH).toBeCloseTo(16 * rowH * 1.5, 0)
        await expectClearOfNav(0, first.navTop)
        for (let i = 1; i < SLIDE_COUNT; i++) {
            await userEvent.click(canvas.getByRole('button', { name: 'Next' }))
            // The keyed hero + copy remount: wait for this slide's headline, then measure.
            await waitFor(() => expect(words()).toBe(SLIDES[i].title))
            const m = measure()
            for (const k of Object.keys(first) as (keyof typeof first)[])
                await expect(m[k], `slide ${i + 1} ${k}`).toBeCloseTo(first[k], 0)
            await expectClearOfNav(i, m.navTop)
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
