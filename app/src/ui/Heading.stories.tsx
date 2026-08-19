// Visual spec for <Heading> — the section-title primitive every raw <h1>..<h6> outside ui/ is
// meant to become. Its size/weight ramp is NOT invented for this component: it is the app's one
// canonical heading scale, already rendered identically by BlockEditor.module.css's
// .block-rich--h1..h6 (Milkdown) and editor/livePreview.ts's .cm-h1..h6 (CodeMirror) — see
// Heading.module.css. <Heading level={3}> now matches what `###` looks like in either editor.
//
// Props: level (1-6, picks the tag AND the ramp step; 2 is the default), class, children.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import type { JSX } from 'solid-js'
import Heading from './Heading'
import { Row } from './_storyKit'

const meta = {
    title: 'UI/Heading',
    component: Heading,
    parameters: { layout: 'centered' },
    argTypes: {
        level: { control: 'inline-radio', options: [1, 2, 3, 4, 5, 6] },
        children: { control: 'text' },
    },
    args: {
        level: 2,
        children: 'Section title',
    },
} satisfies Meta<typeof Heading>

export default meta
type Story = StoryObj<typeof meta>

function Stack(props: { children: JSX.Element }) {
    return (
        <div
            style={{ display: 'flex', 'flex-direction': 'column', gap: '10px' }}
        >
            {props.children}
        </div>
    )
}

/** Fully controllable single heading. */
export const Playground: Story = {}

/** Every level, largest to smallest — the full ramp at a glance. h6 also picks up the muted,
 *  uppercase "label" treatment (--text-muted + --ls-label), same as the editors' own h6. */
export const AllLevels: Story = {
    render: () => (
        <Stack>
            <Heading level={1}>Heading level 1 — --fs-title</Heading>
            <Heading level={2}>Heading level 2 — --fs-lead</Heading>
            <Heading level={3}>Heading level 3 — --fs-body-lg</Heading>
            <Heading level={4}>Heading level 4 — --fs-body</Heading>
            <Heading level={5}>Heading level 5 — --fs-ui</Heading>
            <Heading level={6}>Heading level 6 — --fs-micro</Heading>
        </Stack>
    ),
}

/** Each level renders its own tag — matters for accessibility (screen-reader heading
 *  navigation) and for the editors' parity claim above. */
export const RenderedTags: Story = {
    render: () => (
        <Row label="rendered element" column>
            <Heading level={1}>h1</Heading>
            <Heading level={2}>h2</Heading>
            <Heading level={3}>h3</Heading>
            <Heading level={4}>h4</Heading>
            <Heading level={5}>h5</Heading>
            <Heading level={6}>h6</Heading>
        </Row>
    ),
}

/** A long unbroken title (a note name, an id) must not blow out its container — the same
 *  overflow-wrap rule NoteTitle.css already relies on for the note-title heading. */
export const LongWordWrapping: Story = {
    render: () => (
        <div
            style={{
                width: '220px',
                border: '1px solid var(--border)',
                padding: '10px',
            }}
        >
            <Heading level={1}>
                Supercalifragilisticexpialidocious-and-then-some-more-characters-that-never-space-out-1234567890
            </Heading>
        </div>
    ),
}
