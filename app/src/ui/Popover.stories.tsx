// Visual spec for <Popover> — the floating surface used by menus/palettes/tooltips over live
// content. No scrim of its own (see graph/GraphView.tsx's bare `.asc-popover` writers this
// component will eventually replace), one hard-offset --lift depth cue. Shown here over a
// textured "live content" backdrop so the surface's own fill and hairline border read as
// distinct from whatever is behind it. The fill is OPAQUE in both tones (`menu` --bg, `panel`
// --surface-1): it used to be the translucent --pop-bg, which let the backdrop ghost through.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, within } from 'storybook/test'
import { Popover } from './Popover'

const meta = {
    title: 'UI/Popover',
    component: Popover,
} satisfies Meta<typeof Popover>

export default meta
type Story = StoryObj<typeof meta>

function Backdrop(props: { children: any }) {
    return (
        <div
            style={{
                position: 'relative',
                width: '360px',
                height: '220px',
                padding: '32px',
                background:
                    'repeating-linear-gradient(45deg, var(--surface-1), var(--surface-1) 10px, var(--bg) 10px, var(--bg) 20px)',
            }}
        >
            {props.children}
        </div>
    )
}

/** The bare surface (default tone `panel`, elevation `lift`): fill + hairline border +
 *  hard-offset lift shadow, over a busy backdrop so it is clearly distinguishable from the page
 *  behind it. */
export const Default: Story = {
    render: () => (
        <Backdrop>
            <Popover>
                <div style={{ padding: '12px 16px', 'font-family': 'var(--ui-font-stack)', 'font-size': 'var(--fs-ui)', color: 'var(--fg)' }}>
                    Popover content
                </div>
            </Popover>
        </Backdrop>
    ),
}

/** A representative menu list inside the surface, and a caller `class` composed alongside the
 *  primitive's own — proves `class` merges onto the root rather than replacing it. */
export const WithMenuItems: Story = {
    render: () => (
        <Backdrop>
            <Popover class="story-popover-menu">
                <div
                    style={{
                        display: 'flex',
                        'flex-direction': 'column',
                        'min-width': '160px',
                        'font-family': 'var(--ui-font-stack)',
                        'font-size': 'var(--fs-ui)',
                    }}
                >
                    {['Rename', 'Duplicate', 'Delete'].map(label => (
                        <div style={{ padding: '8px 12px', color: 'var(--fg)' }}>
                            {label}
                        </div>
                    ))}
                </div>
            </Popover>
        </Backdrop>
    ),
}

/** What a token resolves to on this page, as the browser serialises it — the probe the plays
 *  below compare a surface against, so no colour is hardcoded here. */
function resolved(doc: Document, property: 'background-color' | 'box-shadow', token: string): string {
    const probe = doc.createElement('div')
    probe.style.setProperty(property, `var(${token})`)
    doc.body.appendChild(probe)
    const value = getComputedStyle(probe).getPropertyValue(property)
    probe.remove()
    return value
}

function Sample(props: { label: string; testid: string; children: any }) {
    return (
        <div style={{ display: 'flex', 'flex-direction': 'column', gap: '4px', 'align-items': 'flex-start' }}>
            <span style={{ 'font-family': 'var(--ui-font-stack)', 'font-size': 'var(--fs-ui)', color: 'var(--text-muted)' }}>
                {props.label}
            </span>
            <div data-testid={props.testid}>{props.children}</div>
        </div>
    )
}

const Rows = () => (
    <div
        style={{
            'min-width': '120px',
            'font-family': 'var(--ui-font-stack)',
            'font-size': 'var(--fs-ui)',
            color: 'var(--fg)',
        }}
    >
        <div style={{ height: '18px', padding: '0 8px' }}>Rename</div>
        <div style={{ height: '18px', padding: '0 8px' }}>Delete</div>
    </div>
)

/** Both tones over the same busy backdrop. `menu` is the page's own `--bg` with the 4px inset a
 *  row list sits in; `panel` is `--surface-1` with no inset. Both fills are fully opaque — the
 *  backdrop stripes must not show through either. */
export const Tones: Story = {
    render: () => (
        <Backdrop>
            <div style={{ display: 'flex', gap: '24px' }}>
                <Sample label="menu" testid="tone-menu">
                    <Popover tone="menu">
                        <Rows />
                    </Popover>
                </Sample>
                <Sample label="panel" testid="tone-panel">
                    <Popover tone="panel">
                        <Rows />
                    </Popover>
                </Sample>
            </div>
        </Backdrop>
    ),
    play: async ({ canvasElement }) => {
        const doc = canvasElement.ownerDocument
        const canvas = within(canvasElement)
        const menu = canvas.getByTestId('tone-menu').firstElementChild as HTMLElement
        const panel = canvas.getByTestId('tone-panel').firstElementChild as HTMLElement
        await expect(getComputedStyle(menu).backgroundColor).toBe(resolved(doc, 'background-color', '--bg'))
        await expect(getComputedStyle(panel).backgroundColor).toBe(
            resolved(doc, 'background-color', '--surface-1'),
        )
        // opaque: a serialised `rgba(..., <1)` would be translucent
        await expect(getComputedStyle(menu).backgroundColor).not.toMatch(/rgba/)
        await expect(getComputedStyle(panel).backgroundColor).not.toMatch(/rgba/)
        await expect(getComputedStyle(menu).paddingLeft).toBe('4px')
        await expect(getComputedStyle(panel).paddingLeft).toBe('0px')
        await expect(getComputedStyle(menu).borderTopWidth).toBe('1px')
        await expect(getComputedStyle(menu).borderTopLeftRadius).toBe('0px')
    },
}

/** The three elevations: `lift` (the hard 2px 2px 0 offset, right + bottom), `lift` on the start
 *  edge (mirrored so a right-edge panel's shadow stays on screen), and `flat`. */
export const Elevations: Story = {
    render: () => (
        <Backdrop>
            <div style={{ display: 'flex', gap: '24px' }}>
                <Sample label="lift" testid="lift">
                    <Popover tone="menu" elevation="lift">
                        <Rows />
                    </Popover>
                </Sample>
                <Sample label="lift, start edge" testid="lift-start">
                    <Popover tone="menu" elevation="lift" edge="start">
                        <Rows />
                    </Popover>
                </Sample>
                <Sample label="flat" testid="flat">
                    <Popover tone="menu" elevation="flat">
                        <Rows />
                    </Popover>
                </Sample>
            </div>
        </Backdrop>
    ),
    play: async ({ canvasElement }) => {
        const doc = canvasElement.ownerDocument
        const canvas = within(canvasElement)
        const shadow = (id: string) =>
            getComputedStyle(canvas.getByTestId(id).firstElementChild as HTMLElement).boxShadow
        await expect(shadow('lift')).toBe(resolved(doc, 'box-shadow', '--lift'))
        await expect(shadow('lift-start')).toBe(resolved(doc, 'box-shadow', '--lift-start'))
        await expect(shadow('lift')).not.toBe(shadow('lift-start'))
        await expect(shadow('flat')).toBe('none')
    },
}
