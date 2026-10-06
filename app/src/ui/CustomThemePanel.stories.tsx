// Visual spec for <CustomThemePanel> — the swatch board for judging a custom theme.
// Props: theme (a themes-feed entry; the panel paints that theme's own tokens, whatever the app
// theme is), className. The stories install the fixture feed so the theme name resolves.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import CustomThemePanel from './CustomThemePanel'
import { EXAMPLE_THEMES_FEED, PARTIAL_FEED_ENTRY } from './_themeFixtures'
import { setCustomThemesFeed } from '../customThemes'

setCustomThemesFeed({
    ...EXAMPLE_THEMES_FEED,
    themes: [...EXAMPLE_THEMES_FEED.themes, PARTIAL_FEED_ENTRY],
})

const meta = {
    title: 'UI/CustomThemePanel',
    component: CustomThemePanel,
    parameters: { layout: 'centered' },
    args: { theme: EXAMPLE_THEMES_FEED.themes[0] },
} satisfies Meta<typeof CustomThemePanel>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** A partial theme: extends paper, with one colour + two non-colour overrides. */
export const Partial: Story = { args: { theme: PARTIAL_FEED_ENTRY } }

/** Dusk in a 480px-wide host. */
export const Narrow: Story = {
    render: args => (
        <div style={{ width: '480px' }}>
            <CustomThemePanel {...args} />
        </div>
    ),
}
