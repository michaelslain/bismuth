// Visual spec for <Wordmark> — the word `bismuth` in `.asc-wordmark`'s gradient sheen, the app's
// one name mark: `body` size in the top strip (with its blinking caret), `hero` size where it
// is the whole screen.
//
// The mark paints via `background-clip: text` with `color: transparent`, so it needs `--grad`. It
// takes the REAL one: `.storybook/preview.ts` already runs
// `setCssVars(settingsToCssVars(DEFAULTS))` at module scope — the same projection App.tsx performs
// at runtime — so every theme token is live on :root. `AcrossThemes` re-projects per theme the
// same way `BismuthWord.stories` does. Never stand in for a design token; take the real one.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import { Label } from './_storyKit'
import Wordmark from './Wordmark'
import { settingsToCssVars } from '../settingsCssVars'
import { THEME_NAMES, THEME_LABELS } from '../themes'
import { DEFAULTS } from '../../../core/src/schema/settingsSchema'
import type { Settings } from '../settings'

const meta = {
    title: 'UI/Wordmark',
    component: Wordmark,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof Wordmark>

export default meta
type Story = StoryObj<typeof meta>

const Panel = (props: { children: any }) => (
    <div
        style={{
            background: 'var(--bg)',
            padding: '14px 18px',
            display: 'flex',
            'align-items': 'center',
        }}
    >
        {props.children}
    </div>
)

/** The top-strip size (`--fs-body`) at the word's 0.04em tracking. */
export const Body: Story = {
    render: () => (
        <Panel>
            <Wordmark size="body" />
        </Panel>
    ),
    play: async ({ canvasElement }) => {
        const mark = canvasElement.querySelector('.asc-wordmark') as HTMLElement
        await expect(mark).not.toBeNull()
        const cs = getComputedStyle(mark)
        const px = parseFloat(cs.fontSize)
        await expect(px).toBeGreaterThan(0)
        await expect(parseFloat(cs.letterSpacing) / px).toBeCloseTo(0.04, 3)
    },
}

/** The default: the word with its trailing blinking caret, as every surface renders it. */
export const BodyWithCaret: Story = {
    render: () => (
        <Panel>
            <Wordmark size="body" />
        </Panel>
    ),
    play: async ({ canvasElement }) => {
        await expect(canvasElement.querySelectorAll('.asc-caret').length).toBe(1)
    },
}

/** `caret={false}`: the bare word, for a caller that genuinely wants no cursor. */
export const BodyBare: Story = {
    render: () => (
        <Panel>
            <Wordmark size="body" caret={false} />
        </Panel>
    ),
    play: async ({ canvasElement }) => {
        await expect(canvasElement.querySelectorAll('.asc-caret').length).toBe(0)
    },
}

/** The hero size (`--fs-wordmark-display`), its caret grown with the word. */
export const Hero: Story = {
    render: () => (
        <Panel>
            <Wordmark size="hero" />
        </Panel>
    ),
}

/** One row per theme, each re-projecting the real per-theme tokens as App.tsx does at runtime —
 *  `--grad` shifts with the theme, and this is where that gets looked at. */
export const AcrossThemes: Story = {
    render: () => (
        <div
            style={{ display: 'flex', 'flex-direction': 'column', gap: '2px' }}
        >
            {THEME_NAMES.map(name => {
                const vars = settingsToCssVars({
                    ...(DEFAULTS as unknown as Settings),
                    appearance: {
                        ...(DEFAULTS as unknown as Settings).appearance,
                        theme: name,
                    },
                })
                return (
                    <div
                        style={{
                            ...vars,
                            background: 'var(--bg)',
                            color: 'var(--fg)',
                            padding: '14px 18px',
                            display: 'flex',
                            'align-items': 'center',
                            gap: '18px',
                        }}
                    >
                        <span style={{ 'min-width': '90px' }}>
                            <Label>{THEME_LABELS[name] ?? name}</Label>
                        </span>
                        <Wordmark size="body" />
                        <Wordmark size="hero" />
                    </div>
                )
            })}
        </div>
    ),
}

/** Phases the old/new comparison freezes the sheen at, as fractions of one `--sheen` traverse. */
const PHASES = [0, 0.25, 0.5, 0.75]

/** Freezes the new sheen at a phase: `--sheen-play` pauses the slide, a negative `--sheen-delay` sets where. */
const frozen = (phase: number) => ({
    '--sheen-play': 'paused',
    '--sheen-delay': `calc(var(--sheen) * ${-phase})`,
})

/** The sheen as it was drawn before it moved to the compositor: `background-clip: text` over an
 *  oversized `--grad`, panned with `background-position` (keyframes `asc-sheen`, still global for
 *  `.bismuth-word`). Kept here only as the reference the new compositor sheen is judged against. */
const OldMark = (props: { phase: number; size: 'body' | 'hero' }) => (
    <span
        style={{
            'font-size': props.size === 'hero' ? 'var(--fs-wordmark-display)' : 'var(--fs-body)',
            'line-height': '1',
            'font-weight': 'var(--fw-bold)',
            'letter-spacing': '0.04em',
            background: 'var(--grad)',
            'background-size': '200% 100%',
            '-webkit-background-clip': 'text',
            'background-clip': 'text',
            color: 'transparent',
            animation: 'asc-sheen var(--sheen) linear infinite paused',
            'animation-delay': `calc(var(--sheen) * ${-props.phase})`,
            'text-box': props.size === 'body' ? 'trim-both cap alphabetic' : undefined,
        }}
    >
        bismuth
    </span>
)

/** Old (left) vs new (right) at four frozen phases, in the light (paper) and dark (ink) themes,
 *  at the top-strip and hero sizes: same gradient colours, same glyph edges, no band or tint
 *  outside the letters. The new column is the real <Wordmark> with its slide frozen by
 *  `--sheen-play` + `--sheen-delay`. */
export const CompositorSheenVsOld: Story = {
    render: () => (
        <div style={{ display: 'flex', 'flex-direction': 'column', gap: '2px' }}>
            {['ink', 'paper'].map(name => {
                const vars = settingsToCssVars({
                    ...(DEFAULTS as unknown as Settings),
                    appearance: {
                        ...(DEFAULTS as unknown as Settings).appearance,
                        theme: name,
                    },
                })
                return (
                    <div
                        data-theme-row={name}
                        style={{
                            ...vars,
                            background: 'var(--bg)',
                            color: 'var(--fg)',
                            padding: '14px 18px',
                            display: 'grid',
                            'grid-template-columns': 'repeat(2, auto)',
                            gap: '14px 28px',
                            'align-items': 'center',
                        }}
                    >
                        {PHASES.map(p => (
                            <div style={{ display: 'flex', 'flex-direction': 'column', gap: '10px' }}>
                                <div style={{ display: 'flex', gap: '24px', 'align-items': 'baseline' }}>
                                    <OldMark phase={p} size="body" />
                                    <span style={frozen(p)}>
                                        <Wordmark size="body" caret={false} />
                                    </span>
                                </div>
                                <div style={{ display: 'flex', 'flex-direction': 'column', gap: '8px', 'align-items': 'flex-start' }}>
                                    <OldMark phase={p} size="hero" />
                                    <span style={frozen(p)}>
                                        <Wordmark size="hero" caret={false} />
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                )
            })}
        </div>
    ),
    play: async ({ canvasElement }) => {
        // Every new mark must actually paint: its sheen layer is wider than the glyph box and
        // its mask resolves to a real SVG <mask>, not a dangling url().
        const marks = canvasElement.querySelectorAll('.asc-wordmark')
        await expect(marks.length).toBe(16)
        for (const m of marks) {
            const sheen = m.querySelector('span[aria-hidden]') as HTMLElement
            const maskId = getComputedStyle(sheen).maskImage.match(/#([^")]+)/)?.[1]
            await expect(maskId).toBeTruthy()
            await expect(m.querySelector(`mask[id="${maskId}"]`)).not.toBeNull()
            const layer = sheen.firstElementChild as HTMLElement
            await expect(
                parseFloat(getComputedStyle(layer, '::before').width),
            ).toBeGreaterThan(sheen.getBoundingClientRect().width * 2.9)
        }
    },
}
