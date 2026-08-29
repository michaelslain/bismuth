// Visual spec for <Badge> — the count/indicator primitive that bases/Flashcards.module.css's
// .cards-count/.cards-num, DaemonList.module.css's .daemon-section-count,
// FileTree.module.css's .ft-visibility-badge, InboxView.css's .inbox-section-count,
// SearchResultRows.module.css's .sresult-count, and shell/CommandButton.module.css's .toolbar-badge each
// hand-rolled separately. See Badge.module.css for the full derivation.
//
// Props: as ('span' default | 'div'), variant ('inline' default — a plain de-emphasized run |
// 'solid' — a filled pill chip), tone ('muted' | 'faint' | 'danger' — omit to inherit ambient
// color; ignored by 'solid'), class, children.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import Badge from './Badge'
import { Row } from './_storyKit'

const meta = {
    title: 'UI/Badge',
    component: Badge,
    parameters: { layout: 'centered' },
    argTypes: {
        as: { control: 'inline-radio', options: ['span', 'div'] },
        variant: { control: 'inline-radio', options: ['inline', 'solid'] },
        tone: {
            control: 'inline-radio',
            options: [undefined, 'muted', 'faint', 'danger'],
        },
        children: { control: 'text' },
    },
    args: {
        as: 'span',
        variant: 'inline',
        tone: 'muted',
        children: '3',
    },
} satisfies Meta<typeof Badge>

export default meta
type Story = StoryObj<typeof meta>

/** Fully controllable single badge. */
export const Playground: Story = {}

/** The 'inline' variant's three tones. Omitting `tone` inherits the ambient color — the daemon
 *  and inbox section-head counts do this on purpose, riding the eyebrow's own color and only
 *  adding their own opacity dimming (kept in each caller's module, not this component). */
export const Tones: Story = {
    render: () => (
        <Row label="tone">
            <Badge tone="muted">Muted — --text-muted</Badge>
            <Badge tone="faint">Faint — --faint</Badge>
            <Badge tone="danger">Danger — --danger</Badge>
            <Badge>Inherited — no tone prop</Badge>
        </Row>
    ),
}

/** A count riding inline inside a label, the way DaemonList's section heads and SearchResultRows'
 *  match count actually render it. */
export const InlineWithLabel: Story = {
    render: () => (
        <Row label="label + count">
            <span style={{ 'font-size': 'var(--fs-micro)', color: 'var(--faint)' }}>
                Crons <Badge tone="muted">4</Badge>
            </span>
        </Row>
    ),
}

/** The 'solid' variant — a filled pill chip (the toolbar's live-count badge). Its real anchor
 *  positioning (`position: absolute` against a button) is the caller's layout; here it just
 *  sits inline to show the chip's own appearance. */
export const Solid: Story = {
    args: { variant: 'solid', children: '5' },
}

/** The full matrix at a glance. */
export const AllVariants: Story = {
    render: () => (
        <Row label="variant" column>
            <Row label="inline">
                <Badge tone="muted">muted</Badge>
                <Badge tone="faint">faint</Badge>
                <Badge tone="danger">danger</Badge>
            </Row>
            <Row label="solid">
                <Badge variant="solid">9</Badge>
            </Row>
        </Row>
    ),
}
