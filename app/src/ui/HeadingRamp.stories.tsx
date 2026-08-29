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
// The ramp is now ONE definition (--fs-h1..h6 / --fw-h1..h6 in styles/tokens.css) that all five
// surfaces read. This story is where the INVARIANT is checked by eye, and headingRamp.test.ts is
// where it is checked mechanically:
//
//     a heading is never smaller than the prose it heads.
//
// h3 and h4 sit AT body size and separate themselves by weight. h5 and h6 are the only levels
// below body size, and they earn it by changing register — caps, tracking, muted — so they read as
// labels rather than as stunted headings. If a future change makes any level smaller than the body
// row beneath it, this story shows it immediately.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { Label } from './_storyKit'
import '../App.css'

const LEVELS = [1, 2, 3, 4, 5, 6] as const

/** Reads the real tokens — never a hardcoded copy of the numbers. A story that inlined the scale
 *  would keep passing after the tokens drifted, which is the exact failure it exists to catch. */
const headingStyle = (n: number) => ({
    'font-size': `var(--fs-h${n})`,
    'font-weight': `var(--fw-h${n})`,
    'line-height': 'var(--lh-tight)',
    ...(n === 5
        ? {
              'text-transform': 'uppercase' as const,
              'letter-spacing': 'var(--ls-label)',
          }
        : {}),
    ...(n === 6 ? { color: 'var(--text-muted)' } : {}),
})

const BODY = {
    'font-size': 'var(--editor-font-size)',
    'font-family': 'var(--editor-font)',
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
 * by design and must still read as MORE prominent, via case and tracking rather than size.
 */
export const AgainstBody: Story = {
    render: () => (
        <Panel>
            {LEVELS.map(n => (
                <div style={{ 'margin-bottom': '14px' }}>
                    <div style={{ ...headingStyle(n), 'font-family': 'var(--editor-font)' }}>
                        {`h${n} — a heading at level ${n}`}
                    </div>
                    <p style={BODY}>
                        Body text at the prose size, immediately beneath it. This
                        line is the comparison that matters.
                    </p>
                </div>
            ))}
        </Panel>
    ),
}

/** The bare ladder, with each level's resolved token beside it — for reading the scale itself. */
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
                        <Label>{`--fs-h${n}`}</Label>
                    </span>
                    <span style={{ ...headingStyle(n), 'font-family': 'var(--editor-font)' }}>
                        The quick brown fox
                    </span>
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
