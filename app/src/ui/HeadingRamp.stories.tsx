// Visual spec for THE content heading ramp — the one shared by every surface that renders
// markdown: both note editors, chat, the Bases card editor, and flashcards.
//
// WHY THIS STORY EXISTS. The app carried FOUR incompatible heading ramps, and one of them was
// upside-down: note prose renders at --editor-font-size (== --fs-lead, 15px) while the editor
// sized h3/h4/h5/h6 at 13.5/13/11.5/10.5 — so FOUR OF THE SIX LEVELS RENDERED SMALLER THAN THE
// BODY TEXT THEY HEAD. That is broken typography, not a style preference, and nothing in the repo
// could see it: every ramp was internally consistent, each lived in a different file, and two of
// them were expressed as `em` multipliers off whatever size they happened to inherit.
//
// The ramp is now ONE definition (--fs-h1..h6 / --fw-h1..h6 in global.css's `styles/tokens.css`
// section) that all five
// surfaces read. This story is where the INVARIANT is checked by eye, and headingRamp.test.ts is
// where it is checked mechanically:
//
//     a heading is never smaller than the prose it heads.
//
// h3 and h4 sit AT body size and separate themselves by weight. h5 and h6 are the only levels
// below body size, and they earn it by changing register — h6 goes muted and tracked, h5 keeps full
// ink — so they read as labels rather than as stunted headings. NEITHER is uppercase: nothing in
// the design system shouts (DESIGN.md). If a future change makes any level smaller than the body
// row beneath it, this story shows it immediately.
//
// The levels are the REAL <Heading> primitive, not hand-built styles that imitate it — a story that
// restyled its own h5/h6 (it used to put caps on h5 and muted on h6, the opposite of the primitive)
// could disagree with the component and stay green.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import Heading, { type HeadingLevel } from './Heading'
import { Label } from './_storyKit'

const LEVELS = [1, 2, 3, 4, 5, 6] as const satisfies readonly HeadingLevel[]

const BODY = {
    'font-size': 'var(--editor-font-size)',
    'font-family': 'var(--ui-font-stack)',
    'line-height': '1.6',
    color: 'var(--fg)',
    margin: '0',
}

const Panel = (props: { children: any }) => (
    <div
        style={{
            background: 'var(--bg)',
            color: 'var(--fg)',
            padding: '20px 24px',
            'max-width': '60ch',
            display: 'flex',
            'flex-direction': 'column',
            gap: '4px',
        }}
    >
        {props.children}
    </div>
)

const meta = {
    title: 'App Shell/Heading Ramp',
    parameters: { layout: 'centered' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/**
 * Every level, each followed by a line of the body text it would head. Read it as six pairs: in
 * no pair may the heading look smaller or weaker than the prose under it. h5 and h6 are smaller
 * by design and must still read as headings, via ink, weight and tracking rather than size or case.
 */
export const AgainstBody: Story = {
    render: () => (
        <Panel>
            {LEVELS.map(n => (
                <div style={{ 'margin-bottom': '14px' }}>
                    <Heading level={n}>{`h${n} — a heading at level ${n}`}</Heading>
                    <p style={BODY}>
                        Body text at the prose size, immediately beneath it. This
                        line is the comparison that matters.
                    </p>
                </div>
            ))}
        </Panel>
    ),
}

/** The bare ladder, with each level named beside it — for reading the scale itself. */
export const Ladder: Story = {
    render: () => (
        <Panel>
            {LEVELS.map(n => (
                <div
                    style={{
                        display: 'flex',
                        'align-items': 'baseline',
                        gap: '16px',
                    }}
                >
                    <span style={{ 'min-width': '96px' }}>
                        <Label>{`Heading level ${n}`}</Label>
                    </span>
                    <Heading level={n}>The quick brown fox</Heading>
                </div>
            ))}
            <div
                style={{
                    display: 'flex',
                    'align-items': 'baseline',
                    gap: '16px',
                    'margin-top': '8px',
                    'border-top': 'var(--rule)',
                    'padding-top': '8px',
                }}
            >
                <span style={{ 'min-width': '96px' }}>
                    <Label>body</Label>
                </span>
                <span style={{ ...BODY, 'font-size': 'var(--editor-font-size)' }}>
                    The quick brown fox
                </span>
            </div>
        </Panel>
    ),
}
