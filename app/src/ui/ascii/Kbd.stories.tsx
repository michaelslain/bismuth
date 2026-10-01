// Visual spec for <Kbd> — the typed keybinding hint used by the command palette, the switcher,
// menu rows and the flashcard grades.
//
// Props: combo? (the app's keybinding syntax, "Mod+Shift+D", or comma-separated alternatives),
// children? (literal content), muted?, mac? (force the platform), class?.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import Kbd from './Kbd'
import Text from '../Text'
import { Row } from '../_storyKit'

const meta = {
    title: 'UI/Ascii/Kbd',
    component: Kbd,
    parameters: { layout: 'centered' },
    argTypes: {
        combo: { control: 'text' },
        muted: { control: 'boolean' },
        mac: { control: 'boolean' },
    },
    args: { combo: 'Mod+K', mac: true },
} satisfies Meta<typeof Kbd>

export default meta
type Story = StoryObj<typeof meta>

/** Fully controllable single keybinding. */
export const Playground: Story = {}

/** Glyphs glue into one run (`⌘K`, `⌘⌥K`); a word key takes a space each side (`⌘ shift D`);
 *  alternatives join with a faint "or". */
export const ChordsAndAlternatives: Story = {
    render: () => (
        <Row gap="24px">
            <Kbd combo="Mod+K" mac />
            <Kbd combo="Mod+Alt+K" mac />
            <Kbd combo="Mod+Shift+D" mac />
            <Kbd combo="Mod+`, Mod+J" mac />
        </Row>
    ),
}

/** Single keys: a digit, the sanctioned glyphs (↵ ↑ ↓) and the lowercase word keys. */
export const KeyVariety: Story = {
    render: () => (
        <Row gap="24px">
            <Kbd combo="1" />
            <Kbd combo="Enter" />
            <Kbd combo="Up" />
            <Kbd combo="Down" />
            <Kbd combo="Escape" />
            <Kbd combo="Tab" />
            <Kbd combo="Space" />
        </Row>
    ),
}

/** The recede treatment (--faint) used inside menu/palette rows and under the flashcard grades,
 *  beside the default (--text-muted). */
export const Muted: Story = {
    render: () => (
        <Row gap="24px">
            <Kbd combo="Mod+Shift+D" mac />
            <Kbd combo="Mod+Shift+D" mac muted />
            <Kbd combo="Mod+`, Mod+J" mac muted />
        </Row>
    ),
}

/** Off macOS, Mod/Alt type as the words `ctrl`/`alt`, never as glyphs. */
export const NonMac: Story = {
    render: () => (
        <Row gap="24px">
            <Kbd combo="Mod+K" mac={false} />
            <Kbd combo="Mod+Shift+D" mac={false} />
            <Kbd combo="Alt+Up" mac={false} />
        </Row>
    ),
}

/** Inline in a line of chrome text at --fs-ui: the chord's baseline sits on the text's baseline
 *  and ⌘ reads at the letters' size. */
export const InlineInText: Story = {
    render: () => (
        <Row column gap="10px">
            <Text size="ui">
                Open Terminal <Kbd combo="Mod+`" mac />
            </Text>
            <Text size="ui">
                Toggle Sidebar <Kbd combo={'Mod+Shift+\\'} mac muted />
            </Text>
            <Text size="ui">
                Confirm <Kbd combo="Enter" /> or move <Kbd combo="Up, Down" />
            </Text>
        </Row>
    ),
}
