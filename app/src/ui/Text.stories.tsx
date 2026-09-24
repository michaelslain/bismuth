// Visual spec for <Text> — the body/prose primitive every raw <p>/<span> outside ui/ is meant
// to become (see code-style-and-project-structure: "even text is a component"). This is the
// FIRST typography primitive in ui/; it and <Heading> exist so a later pass can move the ~351
// raw typography tags in app/src onto them, so getting the variant set right here matters more
// than usual — every future call site inherits it.
//
// Props: as ('p' default | 'span' | 'div'), size ('micro' | 'ui' | 'body' default | 'body-lg' |
// 'lead' — ui/ui.css's fixed --fs-* scale), tone ('default' | 'muted' | 'faint'), weight
// ('regular' default | 'medium' | 'bold'), eyebrow (the uppercase/tracked section-label
// register), class, children.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import type { JSX } from 'solid-js'
import Text from './Text'
import { Row } from './_storyKit'

const meta = {
    title: 'UI/Text',
    component: Text,
    parameters: { layout: 'centered' },
    argTypes: {
        as: { control: 'inline-radio', options: ['p', 'span', 'div'] },
        size: {
            control: 'inline-radio',
            options: ['micro', 'ui', 'body', 'body-lg', 'lead'],
        },
        tone: {
            control: 'inline-radio',
            options: ['default', 'muted', 'faint'],
        },
        weight: {
            control: 'inline-radio',
            options: ['regular', 'medium', 'bold'],
        },
        eyebrow: { control: 'boolean' },
        children: { control: 'text' },
    },
    args: {
        as: 'p',
        size: 'body',
        tone: 'default',
        weight: 'regular',
        eyebrow: false,
        children:
            'The quick brown fox jumps over the lazy dog — note prose in a panel.',
    },
} satisfies Meta<typeof Text>

export default meta
type Story = StoryObj<typeof meta>

function Stack(props: { children: JSX.Element }) {
    return (
        <div
            style={{ display: 'flex', 'flex-direction': 'column', gap: '14px' }}
        >
            {props.children}
        </div>
    )
}

/** Fully controllable single block. */
export const Playground: Story = {}

/** Every size step on the fixed type scale, at default tone/weight. */
export const Sizes: Story = {
    render: () => (
        <Stack>
            <Text size="micro">
                micro — eyebrows, meta, legends, status bar
            </Text>
            <Text size="ui">ui — rail, tabs, tables, chrome</Text>
            <Text size="body">body — note prose in panels (the default)</Text>
            <Text size="body-lg">
                body-lg — note prose in the full editor column
            </Text>
            <Text size="lead">lead — section heads inside prose</Text>
        </Stack>
    ),
}

/** The three tones at body size. */
export const Tones: Story = {
    render: () => (
        <Row label="tone">
            <Text tone="default">Default — --fg</Text>
            <Text tone="muted">Muted — --text-muted</Text>
            <Text tone="faint">Faint — --faint</Text>
        </Row>
    ),
}

/** The three weights at body size. */
export const Weights: Story = {
    render: () => (
        <Row label="weight">
            <Text weight="regular">Regular</Text>
            <Text weight="medium">Medium</Text>
            <Text weight="bold">Bold</Text>
        </Row>
    ),
}

/** The uppercase/tracked "section label" register — the pattern already hand-rolled as
 *  DaemonList.module.css's .daemon-section-head (micro + faint + regular) and ui.css's own
 *  .ui-empty-block h2 (ui + bold). eyebrow only adds the transform/tracking; tone and weight
 *  stay explicit props. */
export const Eyebrow: Story = {
    render: () => (
        <Stack>
            <Text eyebrow size="micro" tone="faint">
                Section label
            </Text>
            <Text eyebrow size="ui" tone="default" weight="bold">
                Panel title, bold
            </Text>
        </Stack>
    ),
}

/** `as` swaps the rendered tag without changing appearance — span for an inline run, div for a
 *  block with no paragraph semantics. */
export const Tags: Story = {
    render: () => (
        <Stack>
            <Text as="p">This is a paragraph (default).</Text>
            <div>
                Inline: <Text as="span">a span run</Text> inside a sentence.
            </div>
            <Text as="div">
                This is a div — same look, no paragraph margin.
            </Text>
        </Stack>
    ),
}

/** A long unbroken token (a url, an id, a filename) must not blow out its container — the same
 *  overflow-wrap rule NoteTitle.module.css and bases/BaseView.module.css's .cardTitle already rely on. */
export const LongWordWrapping: Story = {
    render: () => (
        <div
            style={{
                width: '220px',
                border: '1px solid var(--border)',
                padding: '10px',
            }}
        >
            <Text>
                A normal sentence, then one unbroken run:
                supercalifragilisticexpialidocious-and-then-some-more-characters-that-never-space-out-1234567890
            </Text>
        </div>
    ),
}

/** `size="inherit"` / `tone="inherit"` emit no font-size+line-height / color at all, leaving
 *  both to whatever ancestor rule already set them — the seam a caller needs when it already
 *  controls typography (a heading's inline run, a button's label) and only wants Text's other
 *  behavior (overflow-wrap, margin reset). */
export const Inherit: Story = {
    render: () => (
        <Stack>
            <div style={{ 'font-size': '22px', color: 'var(--accent)' }}>
                <Text size="inherit" tone="inherit">
                    Inherits the ambient 22px size and accent color from its parent.
                </Text>
            </div>
            <div style={{ 'font-weight': 'var(--fw-bold)' }}>
                <Text as="span" inherit>inherits bold</Text>
            </div>
        </Stack>
    ),
}

/** Every other HTML attribute and `ref` pass through untouched onto the rendered element —
 *  `title`, `data-testid`, `onClick` here, but this covers the whole set (style, classList,
 *  aria-*, data-*, id, role, ref). */
export const PassThrough: Story = {
    render: () => (
        <Text
            title="a native tooltip"
            data-testid="text-passthrough"
            onClick={() => window.alert('Text onClick fired')}
        >
            Hover for the title attribute, click to fire onClick — inspect data-testid in the DOM.
        </Text>
    ),
}

/** The full matrix at a glance. */
export const AllVariants: Story = {
    render: () => (
        <Stack>
            <Row label="size">
                <Text size="micro">micro</Text>
                <Text size="ui">ui</Text>
                <Text size="body">body</Text>
                <Text size="body-lg">body-lg</Text>
                <Text size="lead">lead</Text>
            </Row>
            <Row label="tone">
                <Text tone="default">default</Text>
                <Text tone="muted">muted</Text>
                <Text tone="faint">faint</Text>
            </Row>
            <Row label="weight">
                <Text weight="regular">regular</Text>
                <Text weight="medium">medium</Text>
                <Text weight="bold">bold</Text>
            </Row>
            <Row label="eyebrow">
                <Text eyebrow size="micro" tone="faint">
                    eyebrow
                </Text>
            </Row>
        </Stack>
    ),
}
