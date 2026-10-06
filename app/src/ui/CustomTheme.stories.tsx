// A representative panel for judging a custom colour theme: heading, prose + muted text, both
// button kinds, one badge per category hue, the five accentPalette swatches and a field. Composed
// ONLY of ui/ primitives. `globals.theme: 'dusk'` selects the example custom theme that
// preview.ts registers from _themeFixtures.ts (parsed by the real validator), so what renders here
// is what a vault's .themes/dusk.yaml renders in the app. play() asserts the :root projection
// equals the fixture's own tokens.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import CustomThemePanel from './CustomThemePanel'
import { EXAMPLE_THEMES_FEED } from './_themeFixtures'
import { KanbanCard } from '../bases/KanbanCard'
import { sampleBaseConfig, SAMPLE_ROWS } from './_baseFixtures'
import Badge from './Badge'
import ChipToggle from './ChipToggle'
import { setCssVars, settingsToCssVars } from '../settingsCssVars'
import { DEFAULTS } from '../settings'
import type { Settings } from '../settings'

const dusk = EXAMPLE_THEMES_FEED.themes[0].colors

const meta = {
    title: 'Theming/Custom theme',
    component: CustomThemePanel,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof CustomThemePanel>

export default meta
type Story = StoryObj<typeof meta>

/** Every themeable surface in dusk. `play` compares :root's projected tokens to the fixture. */
export const Dusk: Story = {
    args: { theme: EXAMPLE_THEMES_FEED.themes[0] },
    globals: { theme: 'dusk' },
    play: async () => {
        const root = getComputedStyle(document.documentElement)
        expect(root.getPropertyValue('--bg').trim().toLowerCase()).toBe(
            dusk.background.toLowerCase(),
        )
        expect(root.getPropertyValue('--fg').trim().toLowerCase()).toBe(
            dusk.foreground.toLowerCase(),
        )
        expect(root.getPropertyValue('--accent').trim().toLowerCase()).toBe(
            dusk.accent.toLowerCase(),
        )
        expect(root.getPropertyValue('--surface-1').trim().toLowerCase()).toBe(
            dusk.surface.toLowerCase(),
        )
        expect(root.getPropertyValue('--border').trim().toLowerCase()).toBe(
            dusk.border.toLowerCase(),
        )
    },
}

const OVERRIDES = { 'r-card': '0', 'sp-3': '10px', accent: '#ff6b6b' }
const noop = () => {}
const rootVar = (name: string) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim()

/** `appearance.tokens` projected over the default theme: square card corners, wider inner padding,
 *  a red accent. The preview's `parameters.tokens` seam feeds the same settingsToCssVars the app uses. */
export const TokenOverride: StoryObj = {
    parameters: { tokens: OVERRIDES },
    render: () => (
        <div style={{ width: '260px', display: 'grid', gap: '12px' }}>
            {/* the card face carries no chrome of its own standalone: this frame reads the two
                overridden tokens so their effect (corner radius, inner padding) is visible */}
            <div
                style={{
                    border: '1px solid var(--border)',
                    'border-radius': 'var(--r-card)',
                    padding: 'var(--sp-3)',
                    background: 'var(--surface-1)',
                }}
            >
            {/* a selected chip is accent-filled in the product: the red override shows on the card itself */}
            <ChipToggle selected>override</ChipToggle>
            <KanbanCard
                row={SAMPLE_ROWS[1]}
                titleCol="file.name"
                metaCols={['due', 'status', 'priority']}
                config={sampleBaseConfig()}
                editable={false}
                onEditingChange={noop}
                onRename={async () => undefined}
                onSetMeta={noop}
                onDelete={noop}
                siblingValues={() => []}
            />
            </div>
            <Badge variant="solid">override</Badge>
        </div>
    ),
    play: async () => {
        expect(rootVar('--sp-3')).toBe('10px')
        expect(rootVar('--accent').toLowerCase()).toBe('#ff6b6b')
        expect(rootVar('--r-card')).toBe('0')
    },
}

/** The removal path: project the overrides, then the defaults, and the overrides are gone. */
export const TokenOverrideRemoved: StoryObj = {
    render: () => <Badge variant="solid">removed</Badge>,
    play: async () => {
        const project = (tokens: Record<string, string>) =>
            setCssVars(
                settingsToCssVars({
                    ...DEFAULTS,
                    appearance: { ...DEFAULTS.appearance, tokens },
                } as unknown as Settings),
            )
        const before = rootVar('--accent')
        project(OVERRIDES)
        expect(rootVar('--sp-3')).toBe('10px')
        project({})
        expect(rootVar('--sp-3')).not.toBe('10px')
        expect(rootVar('--accent')).toBe(before)
    },
}
