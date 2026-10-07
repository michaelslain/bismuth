import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import IconBar from './IconBar'
import IconButton from './IconButton'
import ViewBar from './ViewBar'
import { Row } from './_storyKit'

const meta: Meta<typeof IconBar> = {
    title: 'ui/IconBar',
    component: IconBar,
}
export default meta

type Story = StoryObj<typeof IconBar>

export const Default: Story = {
    render: () => (
        <IconBar label="Example toolbar">
            <IconButton icon="Search" label="Search" />
            <IconButton icon="Inbox" label="Inbox" />
            <IconButton icon="Settings" label="Settings" />
        </IconBar>
    ),
}

/** A chrome band — the sidebar row / tab-rail action row shape: min-height var(--h-band), side
 *  padding var(--sp-5), a bottom hairline. */
export const Band: Story = {
    render: () => (
        <IconBar label="Band toolbar" band>
            <IconButton icon="Search" label="Search" />
            <IconButton icon="Inbox" label="Inbox" />
            <IconButton icon="Settings" label="Settings" />
        </IconBar>
    ),
}

/** `bandRule="top"` — a band that is the last row of a column carries its hairline on top. */
export const BandRuleTop: Story = {
    render: () => (
        <IconBar label="Band toolbar, rule on top" band bandRule="top">
            <IconButton icon="Search" label="Search" />
            <IconButton icon="Inbox" label="Inbox" />
            <IconButton icon="Settings" label="Settings" />
        </IconBar>
    ),
}

/** The collapsed tab rail's shape: icons stack one per line, centred, in a narrow container. */
export const Wrapped: Story = {
    render: () => (
        <div style={{ width: '36px' }}>
            <IconBar label="Wrapped toolbar" layout="wrap">
                <IconButton icon="Search" label="Search" />
                <IconButton icon="Inbox" label="Inbox" />
                <IconButton icon="Settings" label="Settings" />
                <IconButton icon="Star" label="Star" />
            </IconBar>
        </div>
    ),
}

/** A toggle/series member (selected) beside two unselected members — no half-opacity dim inside a
 *  bar (Acceptance 5). */
export const WithSelected: Story = {
    render: () => (
        <IconBar label="Toolbar with a selected member">
            <IconButton icon="Search" label="Search" variant="unselected" />
            <IconButton icon="Inbox" label="Inbox" variant="selected" />
            <IconButton icon="Settings" label="Settings" variant="unselected" />
        </IconBar>
    ),
}

/** A disabled member alongside two enabled ones. */
export const Disabled: Story = {
    render: () => (
        <IconBar label="Toolbar with a disabled member">
            <IconButton icon="Search" label="Search" />
            <IconButton icon="Inbox" label="Inbox" disabled />
            <IconButton icon="Settings" label="Settings" />
        </IconBar>
    ),
}

/** The three places an IconBar lives, stacked at sidebar width so they compare in one frame
 *  (icon-brackets): the sidebar toolbar band, the tab-rail action band, and an IconBar inside a
 *  ViewBar's `facet` slot (the mini-graph mode switcher). The glyph size, the bracket size, the
 *  collar and the gap must match across all three rows: an IconBar's buttons look the same
 *  wherever the bar sits. The tab-rail row is shown as the EXPANDED rail draws it (left-aligned,
 *  one line). All three bands are one ui/Band, so the first bracket of each row lands on one x. */
export const Hosts: Story = {
    render: () => (
        <div
            style={{
                width: '280px',
                display: 'flex',
                'flex-direction': 'column',
                gap: '16px',
            }}
        >
            <Row column gap="4px" label="sidebar band">
                <IconBar label="Sidebar toolbar" band>
                    <IconButton icon="FilePlus" label="New note" />
                    <IconButton icon="Inbox" label="Inbox" />
                    <IconButton icon="Settings" label="Settings" />
                </IconBar>
            </Row>
            <Row column gap="4px" label="tab-rail band">
                <IconBar label="Tab actions" band>
                    <IconButton icon="Plus" label="New tab" />
                    <IconButton icon="Eye" label="Preview" />
                    <IconButton icon="SquareTerminal" label="New terminal" />
                </IconBar>
            </Row>
            <Row column gap="4px" label="viewbar facet (mini graph)">
                <ViewBar
                    facet={
                        <IconBar label="Graph mode">
                            <IconButton
                                icon="Notebook"
                                label="2nd brain"
                                variant="selected"
                            />
                            <IconButton
                                icon="Brain"
                                label="3rd brain"
                                variant="unselected"
                            />
                            <IconButton
                                icon="Combine"
                                label="Both brains"
                                variant="unselected"
                            />
                        </IconBar>
                    }
                />
            </Row>
        </div>
    ),
}

/** The px a `--bar-icon-gap`-style token resolves to in this frame (never a hardcoded stand-in). */
function resolvedGap(host: Element, token: string) {
    const probe = document.createElement('span')
    probe.style.marginLeft = `var(${token})`
    host.appendChild(probe)
    const value = getComputedStyle(probe).marginLeft
    probe.remove()
    return value
}

/** `bare` — the plain run of icon buttons: only the `--bar-icon-gap` between them. No
 *  role="toolbar", no label, and the buttons keep their standalone size rather than the bar's
 *  toolzone box. Replaces the `display: flex; gap: var(--bar-icon-gap)` pair that eight modules
 *  hand-wrote. */
export const Bare: Story = {
    render: () => (
        <IconBar bare data-bare>
            <IconButton icon="Search" label="Search" />
            <IconButton icon="Inbox" label="Inbox" />
            <IconButton icon="Settings" label="Settings" />
        </IconBar>
    ),
    play: ({ canvasElement }) => {
        const bar = canvasElement.querySelector<HTMLElement>('[data-bare]')!
        expect(bar.getAttribute('role')).toBeNull()
        expect(bar.getAttribute('aria-label')).toBeNull()
        expect(getComputedStyle(bar).display).toBe('flex')
        expect(getComputedStyle(bar).flexDirection).toBe('row')
        expect(getComputedStyle(bar).columnGap).toBe(
            resolvedGap(canvasElement, '--bar-icon-gap'),
        )
        // no forced box: a bare IconButton is not the bar's --iconbar-box square
        expect(getComputedStyle(bar).getPropertyValue('--iconbar-box')).toBe('')
    },
}

/** `direction="column"` on a toolbar — one icon per line at the bar's own gap; reports
 *  aria-orientation="vertical" (a map's zoom controls). */
export const Column: Story = {
    render: () => (
        <IconBar label="Zoom controls" direction="column" data-column>
            <IconButton icon="Plus" label="Zoom in" />
            <IconButton icon="Minus" label="Zoom out" />
            <IconButton icon="Search" label="Reset" />
        </IconBar>
    ),
    play: ({ canvasElement }) => {
        const bar = canvasElement.querySelector<HTMLElement>('[data-column]')!
        expect(bar.getAttribute('role')).toBe('toolbar')
        expect(bar.getAttribute('aria-orientation')).toBe('vertical')
        expect(getComputedStyle(bar).flexDirection).toBe('column')
        const [a, b] = [...bar.querySelectorAll('button')].map(x =>
            x.getBoundingClientRect(),
        )
        expect(b.top).toBeGreaterThan(a.bottom - 1)
        expect(Math.abs(a.left - b.left)).toBeLessThan(2)
    },
}

/** `bare` + `direction="column"` — the vertical run with no toolbar semantics. */
export const BareColumn: Story = {
    render: () => (
        <IconBar bare direction="column" data-bare-column>
            <IconButton icon="Plus" label="Zoom in" />
            <IconButton icon="Minus" label="Zoom out" />
        </IconBar>
    ),
    play: ({ canvasElement }) => {
        const bar = canvasElement.querySelector<HTMLElement>('[data-bare-column]')!
        expect(bar.getAttribute('role')).toBeNull()
        expect(getComputedStyle(bar).flexDirection).toBe('column')
        expect(getComputedStyle(bar).rowGap).toBe(
            resolvedGap(canvasElement, '--bar-icon-gap'),
        )
    },
}
