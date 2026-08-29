// Visual spec for the CMU Serif prose face the app ships (visual-unification audit §9.1). This is
// NOT a component gallery story in the usual sense — FontSpecimen has no call site in app/; it
// exists purely so the loaded font can be judged here before any wave wires `--prose-font` to a
// real surface (editor note body, BlockEditor, chat message bodies). See ./FontSpecimen.tsx for
// what each section demonstrates.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import FontSpecimen from './FontSpecimen'

const meta = {
    title: 'UI/Gallery/FontSpecimen',
    component: FontSpecimen,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof FontSpecimen>

export default meta
type Story = StoryObj<typeof meta>

/** The full specimen: prose at --fs-read and --fs-body, the 200–800 weight ramp, italic,
 *  lining vs oldstyle numerals, and a side-by-side against Monaspace Xenon. */
export const CmuSerif: Story = {
    render: () => <FontSpecimen />,
}
