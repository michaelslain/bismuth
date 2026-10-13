// Visual spec for the Lora prose face the app ships (visual-unification audit §9.1). This is
// NOT a component gallery story in the usual sense — FontSpecimen has no call site in app/; it
// exists purely so the loaded font can be judged here before any wave wires `--prose-font` to a
// real surface (editor note body, chat message bodies). See ./FontSpecimen.tsx for what each
// section demonstrates.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import FontSpecimen from './FontSpecimen'
import Text from '../Text'

const meta = {
    title: 'UI/Gallery/FontSpecimen',
    component: FontSpecimen,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof FontSpecimen>

export default meta
type Story = StoryObj<typeof meta>

/** The full specimen: prose at --fs-read and --fs-body, the 400–700 weight ramp, italic,
 *  lining vs oldstyle numerals, and a side-by-side against Monaspace Xenon. */
export const Lora: Story = {
    render: () => <FontSpecimen />,
}

const ROW = {
    display: 'flex',
    'align-items': 'baseline',
    gap: 'var(--sp-5)',
    padding: 'var(--sp-3) 0',
    'border-bottom': '1px solid var(--border-soft)',
}
const TAG = { width: '26em', 'flex-shrink': '0', 'white-space': 'nowrap' }

/** The three type registers side by side, each at its own token: chrome (mono, --fs-ui), a
 *  user-written title inside chrome (prose face, --fs-ui-prose, x-height matched to the mono row),
 *  and a prose sentence with an inline code run (--prose-font-size / --code-font-size). */
export const Registers: Story = {
    parameters: { layout: 'padded' },
    render: () => (
        <div data-registers>
            <div style={ROW}>
                <Text as="span" size="micro" tone="faint" style={TAG}>
                    chrome // mono // --fs-ui
                </Text>
                <Text as="span" size="inherit" style={{ 'font-size': 'var(--fs-ui)' }}>
                    rail, tabs, menus, readouts and every [text button]
                </Text>
            </div>
            <div style={ROW}>
                <Text as="span" size="micro" tone="faint" style={TAG}>
                    chip title // prose // --fs-ui-prose
                </Text>
                <Text
                    as="span"
                    size="inherit"
                    register="prose"
                    style={{ 'font-size': 'var(--fs-ui-prose)' }}
                >
                    rail, tabs, menus, readouts and every text button
                </Text>
            </div>
            <div style={ROW}>
                <Text as="span" size="micro" tone="faint" style={TAG}>
                    prose // --prose-font-size
                </Text>
                <Text
                    as="span"
                    size="inherit"
                    register="prose"
                    style={{ 'font-size': 'var(--prose-font-size)' }}
                >
                    A wikilink resolves by file name, so run{' '}
                    <Text
                        as="span"
                        size="inherit"
                        style={{
                            'font-size': 'var(--code-font-size)',
                            'font-family': 'var(--ui-font-stack)',
                        }}
                    >
                        bismuth link check
                    </Text>{' '}
                    before you rename a note.
                </Text>
            </div>
        </div>
    ),
}
