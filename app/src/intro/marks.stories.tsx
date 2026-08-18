// Visual spec for <Lockup> and <WordmarkHero> — the first-run intro's persistent brand
// mark and its hero treatment (marks.tsx). Both take one prop: `icon`, the vault's chosen
// logo mark name (app/public/logos/<icon>.svg — settings.appearance.icon, 14 options).
// `.vi-lockup`/`.vi-wordmark-hero`/`.vi-wordmark-text` are VaultIntro.css's; `.asc-wordmark`
// (the sheen flourish) is already global via App.css (loaded by .storybook/preview.ts).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { Lockup, WordmarkHero } from './marks'
import './VaultIntro.css'

const meta = {
    title: 'Intro/Marks',
    component: Lockup,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof Lockup>

export default meta
type Story = StoryObj<typeof meta>

/** The small persistent lockup — logo mark only, no wordmark. Uses the schema default
 *  (settings.appearance.icon = "hopper-crystal"). */
export const Default: Story = {
    render: () => <Lockup icon="hopper-crystal" />,
}

/** The wordmark hero: the logo mark + the one sanctioned decorative flourish (the
 *  `.asc-wordmark` gradient sheen on "bismuth"), shown with a different logo mark
 *  (`node-rings`) to demonstrate the icon prop actually swaps the art. */
export const Hero: Story = {
    render: () => <WordmarkHero icon="node-rings" size={96} />,
}
