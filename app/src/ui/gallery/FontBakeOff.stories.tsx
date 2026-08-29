// The prose-face bake-off. Every candidate raised while deciding what note prose should be set in,
// rendered from the same sentence at the app's real shipping size.
//
// WHY THIS EXISTS AND FontSpecimen.tsx DID NOT SUFFICE: FontSpecimen shows exactly ONE face, labelled
// "Newsreader Variable (prose — proposed)". It was built to judge a single proposal, not to choose
// between candidates — and a face picked against nothing is how the app ended up setting prose in a
// newsprint face on top of a monospace character grid. This page is the comparison that should have
// happened first.
//
// It is TEMPORARY. When a face is picked: move that one import from FontBakeOff.tsx's header into
// src/index.tsx, point --prose-font at it in styles/tokens.css, then delete this file, the component
// and its stylesheet, and `bun remove` the fourteen packages that lost.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import FontBakeOff from './FontBakeOff'

const meta = {
    title: 'UI/Gallery/FontBakeOff',
    component: FontBakeOff,
    parameters: { layout: 'fullscreen' },
    argTypes: {
        size: {
            control: { type: 'range', min: 12, max: 24, step: 0.125 },
            description: 'Sample size in px (app default: 16.875 = 13.5 x --prose-scale 1.25)',
        },
        leading: {
            control: { type: 'range', min: 16, max: 40, step: 1 },
            description: 'Sample line-height in px (app default: 27 = --row-h 18 x 1.5)',
        },
    },
} satisfies Meta<typeof FontBakeOff>

export default meta
type Story = StoryObj<typeof meta>

/** At the app's real shipping values — judge here and it transfers straight to the editor.
 *  No args: the component reads --prose-font-size and the prose leading from the live tokens, so
 *  this story cannot drift out of sync with what the app actually ships. */
export const AtShippingSize: Story = {}

/** The size prose was at BEFORE the serif switch, for reference on how much the change moved. */
export const AtTheOldMonoSize: Story = {
    args: { size: 13.5, leading: 18 },
}

/** Larger, for judging a face's character rather than its body-size legibility — the differences
 *  between these candidates are much easier to see here, then confirm at shipping size above. */
export const Large: Story = {
    args: { size: 22, leading: 34 },
}
