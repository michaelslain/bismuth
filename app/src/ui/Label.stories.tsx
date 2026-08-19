// Visual spec for <Label> — the truncating-label primitive that DaemonList.module.css's
// .daemon-row-label, PaneTree.module.css's .pane-header-label, shell/TabRail.module.css's
// .tab-rail-label, and ten other near-identical rules each hand-rolled separately. See
// Label.module.css for the full derivation and the flex-item ellipsis trap this primitive exists
// to get right once.
//
// Props: as ('span' default | 'div'), fill (flex: 1, for a primary value in a flex row), tone
// ('default' | 'muted' | 'faint' — omit to inherit ambient color), lines (1 default | 2, a
// -webkit-line-clamp variant), inline (display: inline-block, for a non-flex ancestor like a
// table <th>), class, children.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import Label from './Label'
import { Row } from './_storyKit'

const meta = {
    title: 'UI/Label',
    component: Label,
    parameters: { layout: 'centered' },
    argTypes: {
        as: { control: 'inline-radio', options: ['span', 'div'] },
        fill: { control: 'boolean' },
        tone: {
            control: 'inline-radio',
            options: [undefined, 'default', 'muted', 'faint'],
        },
        lines: { control: 'inline-radio', options: [1, 2] },
        inline: { control: 'boolean' },
        children: { control: 'text' },
    },
    args: {
        as: 'span',
        fill: false,
        tone: 'default',
        lines: 1,
        inline: false,
        children: 'A label that truncates when its row runs out of room',
    },
} satisfies Meta<typeof Label>

export default meta
type Story = StoryObj<typeof meta>

const LONG =
    'A genuinely-long value that will not fit in any reasonable column width no matter the theme or font — supercalifragilisticexpialidocious-and-then-some-more-characters-that-never-space-out-1234567890'

function FlexRow(props: { width?: string; children: unknown }) {
    return (
        <div
            style={{
                display: 'flex',
                'align-items': 'center',
                gap: '8px',
                width: props.width ?? '220px',
                border: '1px solid var(--border)',
                padding: '6px 10px',
                background: 'var(--panel)',
            }}
        >
            {props.children as never}
        </div>
    )
}

/** Fully controllable single label, inside a narrow flex row so truncation is visible. */
export const Playground: Story = {
    render: args => (
        <FlexRow>
            <Label {...args} fill />
        </FlexRow>
    ),
}

/** `fill` (flex: 1) is what most call sites want — the label grows to take the row's remaining
 *  space before it starts truncating. Without it, the label only shrinks to its own content. */
export const Fill: Story = {
    render: () => (
        <Row label="fill" column>
            <FlexRow>
                <span>icon</span>
                <Label fill>{LONG}</Label>
            </FlexRow>
            <FlexRow>
                <span>icon</span>
                <Label>{LONG}</Label>
                <span>trailing</span>
            </FlexRow>
        </Row>
    ),
}

/** The three tones. Omitting `tone` inherits the ambient color instead — several real call
 *  sites do this on purpose, so "no tone" is a legitimate fourth state, not an oversight. */
export const Tones: Story = {
    render: () => (
        <Row label="tone" column>
            <FlexRow>
                <Label fill tone="default">
                    Default — --fg
                </Label>
            </FlexRow>
            <FlexRow>
                <Label fill tone="muted">
                    Muted — --text-muted
                </Label>
            </FlexRow>
            <FlexRow>
                <Label fill tone="faint">
                    Faint — --faint
                </Label>
            </FlexRow>
            <FlexRow>
                <Label fill>Inherited — no tone prop, ambient color</Label>
            </FlexRow>
        </Row>
    ),
}

/** `lines={2}` clamps to two lines instead of ellipsizing on one (bases/CardsView's cover
 *  title) — normal wrapping up to the second line, then an ellipsis. */
export const TwoLineClamp: Story = {
    render: () => (
        <div
            style={{
                width: '180px',
                border: '1px solid var(--border)',
                padding: '10px',
                background: 'var(--panel)',
            }}
        >
            <Label as="div" lines={2}>
                {LONG}
            </Label>
        </div>
    ),
}

/** `inline` sets `display: inline-block` for a label inside a non-flex ancestor (a table
 *  `<th>`) — a bare `<span>` is inline and the ellipsis trio silently does nothing on it. */
export const InlineNonFlex: Story = {
    render: () => (
        <table style={{ 'border-collapse': 'collapse' }}>
            <thead>
                <tr>
                    <th
                        style={{
                            width: '140px',
                            'max-width': '140px',
                            border: '1px solid var(--border)',
                            padding: '4px 8px',
                            'text-align': 'left',
                        }}
                    >
                        <Label inline>{LONG}</Label>
                    </th>
                </tr>
            </thead>
        </table>
    ),
}

/** The exact trap this component exists to avoid: a bare text child of a flex container never
 *  truncates, no matter how narrow the row, because its automatic min-width is its full content
 *  width. `<Label>` (right) truncates at the same width a raw `<span>` (left) hard-clips at. */
export const TruncationProof: Story = {
    render: () => (
        <Row label="raw span vs Label, same 160px row" column>
            <FlexRow width="160px">
                <span
                    style={{
                        overflow: 'hidden',
                        'text-overflow': 'ellipsis',
                        'white-space': 'nowrap',
                    }}
                >
                    {LONG}
                </span>
            </FlexRow>
            <FlexRow width="160px">
                <Label fill>{LONG}</Label>
            </FlexRow>
        </Row>
    ),
}
