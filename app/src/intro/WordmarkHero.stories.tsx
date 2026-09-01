// Visual spec for <WordmarkHero> — the first-run intro's hero treatment: the vault's chosen
// logo mark (settings.appearance.icon, /logos/<icon>.svg) over the wordmark's one sanctioned
// decorative flourish, `.asc-wordmark`'s gradient sheen on "bismuth".
//
// A colocated file, matching this repo's `<Component>.tsx` + `<Component>.stories.tsx`
// convention — `intro/IntroMarks.stories.tsx` already renders this component too (a combined
// spec for both WordmarkHero and its sibling Lockup, kept for the direct A/B between them). This
// file is the dedicated one so the component is discoverable by name, not only inside the pair.
//
// `.asc-wordmark` paints via `background-clip: text` + `color: transparent`, so it needs
// `--grad` live on :root. It gets the REAL one: `.storybook/preview.ts` already runs
// `setCssVars(settingsToCssVars(DEFAULTS))` at module scope, the same projection App.tsx
// performs at runtime — never a story-invented stand-in.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import WordmarkHero from './WordmarkHero'
import '../App.css'

const meta = {
    title: 'Intro/WordmarkHero',
    component: WordmarkHero,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof WordmarkHero>

export default meta
type Story = StoryObj<typeof meta>

/** The schema default logo mark (`hopper-crystal`) at the default size (96px, per the
 *  component's own `size ?? 96` fallback). */
export const Default: Story = {
    render: () => <WordmarkHero icon="hopper-crystal" />,
}

/** A different logo mark at an explicit larger size — proves `icon` actually swaps the art
 *  (not a cached/hardcoded asset) and that `size` scales both the mark and its layout. */
export const AlternateMarkLarger: Story = {
    render: () => <WordmarkHero icon="node-rings" size={160} />,
}
