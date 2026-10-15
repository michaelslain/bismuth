// Visual spec for <IconTextButton> — a text <Button> with a leading icon, rendered as the
// bracket register: `[ icon label ]`.
//
// Props: icon (required), iconSize (default 12), variant ("normal" default | "selected"
// | "unselected"), danger, primary, plus native <button> attributes. Labels must be
// lowercase (dev warns otherwise — same rule as TextButton). `size`/`bracket` are deprecated
// and ignored.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import type { JSX } from 'solid-js'
import { IconTextButton } from './IconTextButton'
import { IconButton } from './IconButton'
import { BarLabel } from './BarLabel'
import ViewBar from './ViewBar'
import { Row } from './_storyKit'

const meta = {
    title: 'UI/IconTextButton',
    component: IconTextButton,
    parameters: { layout: 'centered' },
    argTypes: {
        icon: { control: 'text' },
        variant: {
            control: 'inline-radio',
            options: ['normal', 'selected', 'unselected'],
        },
        danger: { control: 'boolean' },
        primary: { control: 'boolean' },
        disabled: { control: 'boolean' },
        children: { control: 'text' },
    },
    args: {
        icon: 'Check',
        variant: 'normal',
        danger: false,
        primary: false,
        disabled: false,
        children: 'approve',
    },
} satisfies Meta<typeof IconTextButton>

export default meta
type Story = StoryObj<typeof meta>

/** Fully controllable single button. */
export const Playground: Story = {}

/** `[✓ approve]` in every state — the three selection states, plus danger + disabled. */
export const States: Story = {
    render: () => (
        <Row>
            <IconTextButton icon="Check" variant="normal">
                approve
            </IconTextButton>
            <IconTextButton icon="Check" variant="unselected">
                approve
            </IconTextButton>
            <IconTextButton icon="Check" variant="selected">
                approve
            </IconTextButton>
            <IconTextButton icon="Check" danger>
                approve
            </IconTextButton>
            <IconTextButton icon="Check" disabled>
                approve
            </IconTextButton>
        </Row>
    ),
}

// A ViewBar is a bare header strip whose own `.viewbar` is the collapse ladder's `@container`
// root — sizing the WRAPPER sizes the query. Content-box width = wrapper width minus the bar's
// own 18px-a-side padding, which is what the ladder's tiers are measured against (see
// ViewBar.module.css's collapse-ladder comment).
function BarFrame(props: { w: string; children: JSX.Element }) {
    return (
        <div
            style={{
                width: props.w,
                border: '1px solid var(--border)',
                'border-radius': 'var(--r-0)',
                overflow: 'hidden',
                background: 'var(--bg)',
            }}
        >
            {props.children}
        </div>
    )
}

/** The collapse ladder (one-button Task 1) squares an `IconTextButton` to the same `[▣]` box as a
 *  plain `IconButton` beside it, once its word tier fires — see ViewBar.module.css's ladder. 900px
 *  keeps every label ("categories", "event", "today"): the bar's content box is well above the
 *  800px tier where "early" words drop. At 510px, both "categories" and "today" collapse to `[▣]`,
 *  matching the native `IconButton` `[⚙]` next to it, with no leftover gap or padding where the
 *  words used to be. */
export const Collapse: Story = {
    render: () => (
        <Row label="collapse ladder // wide (900px) vs narrow (510px)">
            <BarFrame w="900px">
                <ViewBar
                    actions={
                        <>
                            <IconTextButton icon="Tag" data-bar-drop="1">
                                <BarLabel long="categories" drop="early" />
                            </IconTextButton>
                            <IconTextButton icon="Plus" primary>
                                <BarLabel long="event" drop="early" />
                            </IconTextButton>
                            <IconTextButton icon="Calendar">
                                <BarLabel long="today" drop="late" />
                            </IconTextButton>
                            <IconButton icon="Settings" label="Settings" />
                        </>
                    }
                />
            </BarFrame>
            <BarFrame w="510px">
                <ViewBar
                    actions={
                        <>
                            <IconTextButton icon="Tag" data-bar-drop="1">
                                <BarLabel long="categories" drop="early" />
                            </IconTextButton>
                            <IconTextButton icon="Plus" primary>
                                <BarLabel long="event" drop="early" />
                            </IconTextButton>
                            <IconTextButton icon="Calendar">
                                <BarLabel long="today" drop="late" />
                            </IconTextButton>
                            <IconButton icon="Settings" label="Settings" />
                        </>
                    }
                />
            </BarFrame>
        </Row>
    ),
    // The icon sits on the label's x-height centre, not the line box's centre: a lowercase word
    // has no ascenders to speak of, so a line-box-centred icon reads high. The label's baseline
    // and x-height come from a baseline-aligned `1ex` inline probe, so bold (primary) labels measure true.
    play: async ({ canvasElement }) => {
        const buttons = [
            ...canvasElement.querySelectorAll<HTMLElement>('button'),
        ].filter(b => b.querySelector('svg') && b.textContent)
        expect(buttons.length).toBeGreaterThan(0)
        const deltas: number[] = []
        for (const b of buttons.slice(0, 3)) {
            const word = [
                ...b.querySelectorAll<HTMLElement>('[data-bar-abbr]'),
            ].find(w => w.getClientRects().length > 0)
            if (!word) continue
            const probe = document.createElement('span')
            probe.style.cssText =
                'display:inline-block;width:0;height:1ex;vertical-align:baseline'
            word.appendChild(probe)
            const pr = probe.getBoundingClientRect()
            probe.remove()
            const label = (pr.top + pr.bottom) / 2
            const r = b.querySelector('svg')!.getBoundingClientRect()
            const icon = r.top + r.height / 2
            deltas.push(Math.round((icon - label) * 100) / 100)
        }
        expect(
            deltas.every(d => Math.abs(d) <= 0.5),
            `icon vs x-height centre (px): ${deltas}`,
        ).toBe(true)
    },
}

/** A few representative real labels from call sites (new note, saved, sync). */
export const Examples: Story = {
    render: () => (
        <Row>
            <IconTextButton icon="Plus" variant="normal">
                new note
            </IconTextButton>
            <IconTextButton icon="Check" primary>
                saved
            </IconTextButton>
            <IconTextButton icon="RefreshCw" variant="normal">
                sync
            </IconTextButton>
        </Row>
    ),
}
