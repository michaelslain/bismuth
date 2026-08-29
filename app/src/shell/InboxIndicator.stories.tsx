// Visual spec for <InboxIndicator> — the daemon-inbox notification readout that lives in the
// status bar's field-log line beside `daemon: …` (shell/StatusBar.tsx).
//
// WHY THIS FILE EXISTS SEPARATELY FROM StatusBar.stories.tsx. StatusBar's stories mount this
// component too, but always inside a full bar where it is one item among six at --fs-micro — fine
// for proving it does not break the row, useless for judging the thing itself. These stories put
// it alone so the resting/alert difference, the dot, and the focus ring are actually legible.
//
// THE WRAPPER IS NOT DECORATION. This component sets `font: inherit` and `color: var(--faint)`,
// i.e. it deliberately owns almost none of its own typography — it inherits the status bar's. Left
// on Storybook's default page font it would render at ~14px in the body colour and every story
// here would be blessing an appearance that never ships. `frame()` reproduces exactly the three
// properties `.status-bar` contributes (--fs-micro, --faint, and the 18px row height that
// `line-height: 1` is there to protect), so what these stories record is what the bar shows.
//
// COVERAGE MAP: `Empty` is the resting state — no dot, --faint, still present and still pressable,
// which is the whole point of "a place in the toolbar" rather than a control that appears only
// when it has something to say. `Pending`/`Single`/`Many` are the alert state
// (`.status-inbox--pending` + `.status-inbox-dot`). `InRow` places it against a real
// `daemon: working` neighbour at the bar's real size — the only story that can show whether
// the gold dot reads as a signal or as noise next to the text it sits beside.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import type { JSX } from 'solid-js'
import { InboxIndicator } from './InboxIndicator'

const noop = () => {}

// The three properties `.status-bar` contributes to its children — see the file header.
const frame = (children: JSX.Element) => (
    <div
        style={{
            display: 'flex',
            'align-items': 'center',
            gap: 'var(--sp-6)',
            height: 'var(--row-h, 18px)',
            'font-size': 'var(--fs-micro)',
            color: 'var(--faint)',
            background: 'var(--rail)',
            padding: '0 var(--sp-6)',
        }}
    >
        {children}
    </div>
)

const meta = {
    title: 'Shell/InboxIndicator',
    component: InboxIndicator,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof InboxIndicator>

export default meta
type Story = StoryObj<typeof meta>

/** Nothing awaiting review: no dot, --faint, but PRESENT and pressable. A notification indicator
 *  that vanishes at zero can never be found or learned, so the resting state is quiet, not absent. */
export const Empty: Story = {
    render: () => frame(<InboxIndicator count={0} onOpen={noop} />),
}

/** The alert state — a --gold dot (the inbox's own `pending` colour, from daemonInboxLogic.ts's
 *  STATUS_COLOR) plus the count promoted to --fg. */
export const Pending: Story = {
    render: () => frame(<InboxIndicator count={3} onOpen={noop} />),
}

/** Singular: the accessible label reads "1 page awaiting review", not "1 pages". The plural is
 *  computed, so this is the only story where an off-by-one in that expression is visible. */
export const Single: Story = {
    render: () => frame(<InboxIndicator count={1} onOpen={noop} />),
}

/** A three-digit count, to prove the indicator grows rather than clipping or wrapping the row. */
export const Many: Story = {
    render: () => frame(<InboxIndicator count={128} onOpen={noop} />),
}

/** Against its real neighbour at the real size, IN THE SHIPPED ORDER: indicator first, then the
 *  toned daemon readout carrying the caret. That order is not cosmetic here — it is the only story
 *  that can show whether the gold dot still reads as a signal when a green `working` sits directly
 *  after it, which is the one adjacency that could make two warm/cool status colours fight. If
 *  StatusBar's order ever changes, change it here too: a story that renders a layout the app does
 *  not ship is worse than no story, because it looks like evidence. */
export const InRow: Story = {
    render: () =>
        frame(
            <>
                <InboxIndicator count={3} onOpen={noop} />
                <span style={{ color: 'var(--green)' }}>
                    daemon: working
                    <span class="asc-caret" style={{ 'margin-left': '2px' }}>
                        _
                    </span>
                </span>
            </>,
        ),
}
