// Visual spec for <Band> — the chrome band every header strip shares: --h-band tall, --sp-5 side
// padding, a --rule-soft bottom hairline. ViewBar and a `band` IconBar both render through it.
//
// Props: class (the composer's own layout), children, plus any div attribute, and the four a caller
// asks for instead of writing its own padding (a band never does — DESIGN.md, Layout):
//   rule      'top' | 'bottom' | 'none'          which edge carries the hairline
//   flush     boolean                            no inline padding
//   inset     'traffic-lights' | 'rail'          a NAMED extra start inset, never a px value
//   padBlock  boolean                            vertical room for a wrapping IconBar's stack
//   compact   boolean                            one text row tall (--row-h) — the status bar
// The stories below put the default band directly above each variant, so the edge that moved is the
// thing you see.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import Band from './Band'
import IconBar from './IconBar'
import IconButton from './IconButton'
import ViewBar, { Crumb } from './ViewBar'
import Text from './Text'

const meta = {
    title: 'UI/Band',
    component: Band,
} satisfies Meta<typeof Band>

export default meta
type Story = StoryObj<typeof meta>

/** A bare band with one line of text — the box alone. */
export const Default: Story = {
    render: () => (
        <div style={{ width: '280px' }}>
            <Band>
                <Text as="span" size="ui" tone="muted">
                    a band
                </Text>
            </Band>
        </div>
    ),
}

/** `rule="top"` — the hairline on the top edge, for a band that is the last row of a column. */
export const RuleTop: Story = {
    render: () => (
        <div style={{ width: '280px' }}>
            <Band rule="top">
                <Text as="span" size="ui" tone="muted">
                    a band, rule on top
                </Text>
            </Band>
        </div>
    ),
}

const W = '280px'

/** The bands of a story's column, in order, with their computed padding/border. */
function measure(canvasElement: HTMLElement) {
    const bands = [...(canvasElement.firstElementChild as HTMLElement).children] as HTMLElement[]
    return bands.map(b => {
        const cs = getComputedStyle(b)
        return {
            left: parseFloat(cs.paddingLeft),
            right: parseFloat(cs.paddingRight),
            top: parseFloat(cs.paddingTop),
            borderBottom: parseFloat(cs.borderBottomWidth),
            borderTop: parseFloat(cs.borderTopWidth),
        }
    })
}

/** A reference row: the default band as a ruler, so each variant below reads against the same axis. */
function Ref() {
    return (
        <Band>
            <Text as="span" size="ui" tone="muted">
                default
            </Text>
        </Band>
    )
}

/** `rule="none"` — no hairline, for a band inside a surface that draws its own edge. */
export const RuleNone: Story = {
    render: () => (
        <div style={{ width: W }}>
            <Band rule="none">
                <Text as="span" size="ui" tone="muted">
                    a band, no rule
                </Text>
            </Band>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const [b] = measure(canvasElement)
        expect(b.borderBottom).toBe(0)
        expect(b.borderTop).toBe(0)
    },
}

/** `flush` — no side padding: the text sits on the band's own edge, the hairline stays. */
export const Flush: Story = {
    render: () => (
        <div style={{ width: W }}>
            <Ref />
            <Band flush>
                <Text as="span" size="ui" tone="muted">
                    flush
                </Text>
            </Band>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const [ref, flush] = measure(canvasElement)
        expect(ref.left).toBe(12)
        expect([flush.left, flush.right]).toEqual([0, 0])
        // padding and the hairline are independent: flush keeps its bottom rule.
        expect(flush.borderBottom).toBe(1)
    },
}

/** `inset="traffic-lights"` — the macOS overlay-titlebar gap TopStrip needs. Combined with `flush`
 *  it is the only padding the band has. */
export const InsetTrafficLights: Story = {
    render: () => (
        <div style={{ width: W }}>
            <Ref />
            <Band inset="traffic-lights">
                <Text as="span" size="ui" tone="muted">
                    inset traffic-lights
                </Text>
            </Band>
            <Band flush inset="traffic-lights">
                <Text as="span" size="ui" tone="muted">
                    flush + traffic-lights
                </Text>
            </Band>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const [ref, inset, flushInset] = measure(canvasElement)
        expect(ref.left).toBe(12)
        expect(inset.left).toBe(78)
        expect(inset.right).toBe(12)
        // flush + inset = no padding except the inset.
        expect([flushInset.left, flushInset.right]).toEqual([78, 0])
    },
}

/** `inset="rail"` — the mirrored tab rail's start nudge, one pixel past the default padding. */
export const InsetRail: Story = {
    render: () => (
        <div style={{ width: W }}>
            <Ref />
            <Band inset="rail">
                <Text as="span" size="ui" tone="muted">
                    inset rail
                </Text>
            </Band>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const [ref, inset] = measure(canvasElement)
        expect(inset.left).toBe(ref.left + 1)
    },
}

/** `padBlock` — vertical padding for a wrapping IconBar: the collapsed tab rail's stacked icons
 *  get room above and below instead of a hand-written `padding-block` in the rail's stylesheet. */
export const PadBlock: Story = {
    render: () => (
        <div style={{ width: '45px' }}>
            <Band>
                <IconButton icon="FilePlus" label="New note" />
            </Band>
            <Band
                padBlock
                style={{ display: 'flex', 'flex-wrap': 'wrap', 'align-content': 'center' }}
            >
                <IconButton icon="FilePlus" label="New note" />
                <IconButton icon="Inbox" label="Inbox" />
                <IconButton icon="Settings" label="Settings" />
            </Band>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const [plain, padded] = measure(canvasElement)
        expect(plain.top).toBe(0)
        expect(padded.top).toBeGreaterThan(0)
    },
}

/** `compact` — one --row-h line instead of a --h-band header (the status bar). The side padding and the
 *  hairline are the band's own, so a compact band's text starts on the same x as the full one above it. */
export const Compact: Story = {
    render: () => (
        <div style={{ width: W }}>
            <Ref />
            <Band>
                <Text as="span" size="ui" tone="muted">
                    full band
                </Text>
            </Band>
            <Band compact rule="top">
                <Text as="span" size="ui" tone="muted">
                    compact band
                </Text>
            </Band>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const column = [...(canvasElement.firstElementChild as HTMLElement).children] as HTMLElement[]
        const [, full, compact] = column
        const cs = (el: HTMLElement) => getComputedStyle(el)
        const rowH = parseFloat(cs(document.documentElement).getPropertyValue('--row-h'))
        const bandH = parseFloat(cs(document.documentElement).getPropertyValue('--h-band'))
        expect(full.getBoundingClientRect().height).toBe(bandH)
        // The hairline is inside the height (border-box), so the whole band is exactly one row.
        expect(compact.getBoundingClientRect().height).toBe(rowH)
        // Same side padding, so the text edge is shared — only the height differs.
        expect(cs(compact).paddingLeft).toBe(cs(full).paddingLeft)
        expect(cs(compact).borderTopWidth).toBe('1px')
    },
}

/** Its two composers stacked in one column: the first bracket of each starts on the same x. */
export const Composers: Story = {
    render: () => (
        <div style={{ width: '280px' }}>
            <IconBar label="Toolbar band" band>
                <IconButton icon="FilePlus" label="New note" />
                <IconButton icon="Inbox" label="Inbox" />
                <IconButton icon="Settings" label="Settings" />
            </IconBar>
            <ViewBar identity={<Crumb icon="Share2">Knowledge Graph</Crumb>} />
        </div>
    ),
}
