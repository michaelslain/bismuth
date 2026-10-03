// Visual spec for <Wordmark> — the word `bismuth` in `.asc-wordmark`'s gradient sheen, the app's
// one name mark: `body` size in the top strip (with its blinking caret), `hero` size on the
// intro splash.
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

/** With the trailing blinking caret, as the top strip renders it. */
export const BodyWithCaret: Story = {
    render: () => (
        <Panel>
            <Wordmark size="body" caret />
        </Panel>
    ),
    play: async ({ canvasElement }) => {
        await expect(canvasElement.querySelectorAll('.asc-caret').length).toBe(1)
    },
}

/** The intro splash size (`--fs-hero`). */
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
                        <Wordmark size="body" caret />
                        <Wordmark size="hero" />
                    </div>
                )
            })}
        </div>
    ),
}
