// Visual spec for <Popover> — the floating surface used by menus/palettes/tooltips over live
// content. No scrim of its own (see graph/GraphView.tsx's bare `.asc-popover` writers this
// component will eventually replace), one hard-offset --lift depth cue. Shown here over a
// textured "live content" backdrop so the surface's own fill (--pop-bg) and hairline border
// read as distinct from whatever is behind it.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
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

/** The bare surface: fill + hairline border + hard-offset lift shadow, over a busy backdrop so
 *  it is clearly distinguishable from the page behind it. */
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
