// The first-run intro takeover — one story per slide, rendered in the framed IntroWindow.
//
// `startAt` seeds the slide signal so each slide can be looked at on its own. The real
// first run still opens on 'welcome'.
//
// `layout: 'fullscreen'` is required: .vi-root is `position: fixed; inset: 0`, so a padded or
// centered canvas would clip it rather than show the takeover at its real size. The two sizing
// stories (`ShortWindow`, `Narrow`) wrap it in a transformed box, which becomes the containing block
// of that fixed root. The window fills the root's content box (the root pads itself by `--sp-7`) and
// the art box takes the height left over, so `ShortWindow` and `DefaultWindow` check that the frame
// fills the takeover and the footer stays on screen.
//
// Reduced motion (the glyph scenes and the typed-in copy switch to their resting frame under
// `prefers-reduced-motion`) cannot be emulated from inside a story, so it has no story.
import type { JSX } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import VaultIntro from './VaultIntro'
import { SLIDES } from './introSlides'
import { applyLevel } from './introPrivacy'

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

/** Slide 8 (daemon power-up on) — the daemon face idling over the empty name field. */
export const Name: Story = {
    args: { startAt: 'name', initialPowerups: ['daemon', 'cli'] },
}

/** Slide 9 (daemon power-up on) — the privacy slider over the seven switches, all off. */
export const Privacy: Story = {
    args: { startAt: 'privacy', initialPowerups: ['daemon', 'cli'] },
    play: async ({ canvasElement }) => {
        const slider = await within(canvasElement).findByRole('slider')
        slider.focus()
        await userEvent.keyboard('{ArrowRight}')
        await waitFor(() => expect(slider.getAttribute('aria-valuetext')).toBe('recall'))
        await expect(canvasElement.textContent).toContain('// privacy')
    },
}

/** The privacy slide with the `full` stop applied: every switch on, the slider at `full`. */
export const PrivacyFull: Story = {
    args: {
        startAt: 'privacy',
        initialPowerups: ['daemon', 'cli'],
        initialPrivacy: applyLevel('full'),
    },
}

/** The privacy slide in the short window: the art box scrolls, the footer stays put. */
export const PrivacyShortWindow: Story = {
    args: { startAt: 'privacy', initialPowerups: ['daemon', 'cli'] },
    decorators: [Box({ height: '640px' })],
}

/** Slide 9 (cli + mcp on), as it opens: `new vault` picked, no path field. */
export const Obsidian: Story = { args: { startAt: 'obsidian' } }

/** Slide 9 with `from obsidian` picked and a vault chosen: the line names the converted copy. */
export const ObsidianPicked: Story = {
    args: {
        startAt: 'obsidian',
        initialObsidianSource: '/Users/ada/Documents/Notes',
    },
    play: async ({ canvasElement }) => {
        await expect(canvasElement.textContent).toContain(
            'opens as /Users/ada/Documents/Notes-bismuth',
        )
    },
}

/** Slide 9 with a vault chosen, then `new vault` picked: the field goes and the conversion is off,
 *  so skipping to the last slide offers `[enter your vault]` again. */
export const ObsidianBackToNew: Story = {
    args: {
        startAt: 'obsidian',
        initialObsidianSource: '/Users/ada/Documents/Notes',
        morph: false,
    },
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await userEvent.click(c.getByRole('button', { name: /new vault/ }))
        await waitFor(() =>
            expect(canvasElement.querySelector('input')).toBeNull(),
        )
        // Escape is the intro's skip key: it jumps to the last slide.
        await userEvent.keyboard('{Escape}')
        await waitFor(() =>
            expect(
                c.getByRole('button', { name: /enter your vault/ }),
            ).toBeTruthy(),
        )
    },
}

/** The last slide after Rust refused a typed Obsidian path: the reason replaces the empty body
 *  and the button is live again for another try. */
export const BeginConvertRefused: Story = {
    args: {
        startAt: 'begin',
        initialObsidianSource: '/Users/ada/Nope',
        onEnter: async (_choice: unknown, onError: (message: string) => void) => {
            onError('no folder at /Users/ada/Nope')
            return 'failed'
        },
    },
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await userEvent.click(c.getByRole('button', { name: /convert and open/ }))
        await waitFor(() =>
            expect(canvasElement.textContent).toContain(
                "Couldn't open the vault: no folder at /Users/ada/Nope",
            ),
        )
    },
}

/** `from obsidian` with no vault picked: the primary waits (disabled) and the body says where to
 *  pick one, instead of the CTA opening a folder picker for a second pick. */
export const BeginConvertNoVault: Story = {
    args: { startAt: 'begin', initialVaultStart: 'obsidian' },
    play: async ({ canvasElement }) => {
        await expect(
            within(canvasElement).getByRole('button', { name: /convert and open/ }),
        ).toBeDisabled()
        await expect(canvasElement.textContent).toContain(
            'Pick the Obsidian vault to convert on the obsidian slide',
        )
    },
}

/** The last slide with a vault picked: the primary reads `[convert and open]`. */
export const BeginConvert: Story = {
    args: {
        startAt: 'begin',
        initialObsidianSource: '/Users/ada/Documents/Notes',
    },
    play: async ({ canvasElement }) => {
        await expect(
            within(canvasElement).getByRole('button', { name: /convert and open/ }),
        ).toBeTruthy()
    },
}

/** Slide 10 (cli + mcp on) — the agents glyph scene over the ask-chat copy. */
export const Chat: Story = { args: { startAt: 'chat' } }

/** Slide 11 — a `.settings` file and a note's frontmatter, side by side. */
export const Settings: Story = { args: { startAt: 'settings' } }

/** Power-ups both cleared: the name, obsidian and chat slides drop out, so next from power-ups
 *  lands on settings and the footer counts nine slides. */
export const PowerUpsNoneSkips: Story = {
    args: { startAt: 'powerups', initialPowerups: [], morph: false },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('7/9 // power-ups')).toBeTruthy()
        await userEvent.click(canvas.getByRole('button', { name: /next/ }))
        await waitFor(() =>
            expect(canvas.getByText('8/9 // settings')).toBeTruthy(),
        )
    },
}

/** Slide 12 — the hero wordmark over the copy; the footer's primary, `[enter your vault]`, is the
 *  slide's one call to action. */
export const Begin: Story = { args: { startAt: 'begin' } }

/** Slide 2 with the paper theme picked: the selection ring and the whole window in the light palette. */
export const ThemePaperPicked: Story = {
    args: { startAt: 'theme', initialTheme: 'paper' },
}

/** Slide 7 with the cli + mcp power-up switched off, then daemon toggled on from the keyboard. */
export const PowerUpOff: Story = {
    args: { startAt: 'powerups' },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const cli = canvas.getByRole('switch', { name: /cli \+ mcp/i })
        const daemon = canvas.getByRole('switch', { name: /daemon/i })
        await expect(cli.getAttribute('aria-checked')).toBe('true')
        await expect(daemon.getAttribute('aria-checked')).toBe('false')
        await userEvent.click(cli)
        await waitFor(() =>
            expect(cli.getAttribute('aria-checked')).toBe('false'),
        )
        daemon.focus()
        await userEvent.keyboard(' ')
        await waitFor(() =>
            expect(daemon.getAttribute('aria-checked')).toBe('true'),
        )
    },
}

/** The last slide while the native folder picker is open: the primary reads `[opening…]` and is
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

/** The window is the same size on every slide, and every slide's art and copy sit as one group at its optical centre, with no empty art box over the art. Walks every slide (both power-ups on, so all of them show) with the real next button (stopping before the last,
 *  which enters the vault). */
export const Geometry: Story = {
    args: { startAt: 'welcome', initialPowerups: ['daemon', 'cli'], morph: false },
    // A 900px stage: the window fills it, whatever the browser viewport is.
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
            const content = slot('art').lastElementChild!.getBoundingClientRect()
            const text = slot('text').getBoundingClientRect()
            return {
                footerTop: slot('footer').getBoundingClientRect().top,
                bodyH: body.height,
                // The art and the copy are one group centred in the body above its bottom padding
                // (the lift to the optical centre).
                skew:
                    (art.top - body.top) -
                    (body.bottom -
                        parseFloat(getComputedStyle(slot('art').parentElement!).paddingBottom) -
                        text.bottom),
                // No empty art box over the art: the box is its content's height (the graph slides
                // hold it at the full art budget for the cloud).
                spare: art.height - content.height,
                // The art shows whole: nothing inside the art box scrolls (a scroller there clips
                // rows the slide means to show).
                scrolled: [...slot('art').querySelectorAll('*')].filter(
                    el =>
                        /auto|scroll/.test(getComputedStyle(el).overflowY) &&
                        el.scrollHeight > el.clientHeight + 1,
                ).length,
                // No empty band at the art's top: the topmost text or canvas sits on the box's top
                // edge, not a band of padding below it.
                band: inkTop(slot('art').lastElementChild!) - art.top,
            }
        }
        const inkTop = (el: Element) => {
            let top = Infinity
            for (const n of el.querySelectorAll('*')) {
                const ink =
                    n.tagName === 'CANVAS' ||
                    [...n.childNodes].some(
                        c => c.nodeType === Node.TEXT_NODE && !!c.textContent?.trim(),
                    )
                const r = n.getBoundingClientRect()
                if (ink && r.width > 0 && r.height > 0) top = Math.min(top, r.top)
            }
            return top
        }
        const rowH = parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue('--row-h'),
        )
        // The headline's words without the typing cursor (an aria-hidden `_` that rides the title
        // while it types). The full title is in the DOM from the first frame.
        const words = () => {
            const copy = h1().cloneNode(true) as Element
            copy.querySelectorAll('[data-cursor]').forEach(c => c.remove())
            return copy.textContent
        }
        const check = async (i: number, first: ReturnType<typeof measure>) => {
            const m = measure()
            await expect(m.footerTop, `slide ${i + 1} footerTop`).toBeCloseTo(first.footerTop, 0)
            await expect(m.bodyH, `slide ${i + 1} bodyH`).toBeCloseTo(first.bodyH, 0)
            await expect(Math.abs(m.skew), `slide ${i + 1} centred`).toBeLessThan(2)
            await expect(m.scrolled, `slide ${i + 1} art scrolls`).toBe(0)
            if (SLIDES[i].key !== 'theme' && SLIDES[i].key !== 'graph') {
                await expect(Math.abs(m.spare), `slide ${i + 1} art box spare`).toBeLessThan(1)
                await expect(m.band, `slide ${i + 1} art top band`).toBeLessThan(rowH)
            }
        }
        await waitFor(() => expect(words()).toBe(SLIDES[0].title))
        const first = measure()
        await check(0, first)
        for (let i = 1; i < SLIDES.length; i++) {
            await userEvent.click(canvas.getByRole('button', { name: /next/ }))
            await waitFor(() => expect(words()).toBe(SLIDES[i].title))
            await check(i, first)
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

/** The window fills the takeover's content box: the strip's top is one `--sp-7` gutter under the top
 *  edge and the footer's bottom one gutter over the bottom edge, with no empty band beyond it. */
const expectFilled = async (canvasElement: HTMLElement) => {
    const gutter = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--sp-7'),
    )
    const root = canvasElement.getBoundingClientRect()
    const win = canvasElement
        .querySelector('[data-intro-window]')!
        .getBoundingClientRect()
    await expect(win.top - root.top).toBeCloseTo(gutter, 0)
    await expect(root.bottom - win.bottom).toBeCloseTo(gutter, 0)
}

/** A 640px-tall stage: the frame fills it and the footer stays on screen. */
export const ShortWindow: Story = {
    args: { startAt: 'agents' },
    decorators: [Box({ height: '640px' })],
    play: async ({ canvasElement }) => {
        const slot = (name: string) =>
            canvasElement.querySelector(
                `[data-intro-slot="${name}"]`,
            ) as HTMLElement
        await waitFor(() => expectFilled(canvasElement))
        await expect(
            slot('footer').getBoundingClientRect().bottom,
        ).toBeLessThanOrEqual(canvasElement.getBoundingClientRect().bottom)
    },
}

/** The app's DEFAULT 1200x800 window: the frame fills the takeover minus the gutter, and the daemon
 *  scene draws at `--intro-glyph-scale`, so the art box is exactly that many times its 10 rows. */
export const DefaultWindow: Story = {
    args: { startAt: 'daemon' },
    decorators: [Box({ height: '800px' })],
    play: async ({ canvasElement }) => {
        await waitFor(() => expectFilled(canvasElement))
        const rootCs = getComputedStyle(document.documentElement)
        const cellH = parseFloat(rootCs.getPropertyValue('--cell-h'))
        const scale = parseFloat(rootCs.getPropertyValue('--intro-glyph-scale'))
        const art = canvasElement.querySelector(
            '[data-intro-slot="art"]',
        ) as HTMLElement
        await expect(
            Math.abs(art.getBoundingClientRect().height - scale * 10 * cellH),
        ).toBeLessThan(1)
    },
}

/** An 860px-wide stage, agents slide: the window shrinks to `100% - 2 * --sp-7` and the longest
 *  body must fit the copy slot without clipping. */
export const Narrow: Story = {
    args: { startAt: 'agents' },
    decorators: [Box({ width: '860px' })],
}

const overlayOf = (el: HTMLElement) =>
    el.querySelector('canvas[data-morph-overlay]') as HTMLCanvasElement | null

/** Fraction of the overlay's pixels that carry ink. */
const overlayInk = (c: HTMLCanvasElement): number => {
    const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
    let n = 0
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++
    return n / (c.width * c.height)
}

/** Opens on welcome; pressing [next] runs the real morph into the theme slide: the overlay flies the
 *  welcome characters onto the theme slide's cells for about a second, then the slide fades in. */
export const MorphLive: Story = {
    args: { startAt: 'welcome' },
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await userEvent.click(c.getByRole('button', { name: /next/ }))
        await waitFor(() => expect(overlayOf(canvasElement)).toBeTruthy())
        await waitFor(() => expect(overlayOf(canvasElement)).toBeNull(), {
            timeout: 4000,
        })
        await expect(canvasElement.querySelector('h1')!.textContent).toContain(
            SLIDES[1].title,
        )
    },
}

/** The welcome -> theme morph frozen at p = 0.5 (`morph={0.5}` holds it there once the incoming
 *  slide is measured): a cloud of characters mid-flight in token colours. The slide body is hidden
 *  under it; the wordmark, [skip] and [back] [next] stay on screen. */
export const MorphMidFrame: Story = {
    args: { startAt: 'welcome', morph: 0.5 },
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await userEvent.click(c.getByRole('button', { name: /next/ }))
        await waitFor(() => {
            const o = overlayOf(canvasElement)
            expect(o).toBeTruthy()
            expect(overlayInk(o!)).toBeGreaterThan(0.002)
        })
        const opacity = (el: Element) => getComputedStyle(el).opacity
        const slot = (name: string) => canvasElement.querySelector(`[data-intro-slot="${name}"]`)!
        await expect(opacity(slot('text'))).toBe('0')
        await expect(opacity(canvasElement.querySelector('[data-intro-window]')!)).toBe('1')
        await expect(opacity(c.getByRole('button', { name: /skip/i }))).toBe('1')
    },
}
