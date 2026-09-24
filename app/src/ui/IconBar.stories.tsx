import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import IconBar from './IconBar'
import IconButton from './IconButton'
import Text from './Text'
import { Icon } from '../icons/Icon'

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

/** The same three buttons at iconSize 11, 12 (the default), 16 and 20 — glyph and brackets resize
 *  together (Acceptance 8). */
export const Sizes: Story = {
    render: () => (
        <div
            style={{
                display: 'grid',
                'grid-template-columns': 'auto auto',
                'align-items': 'center',
                'column-gap': 'var(--sp-6)',
                'row-gap': 'var(--sp-4)',
                'justify-content': 'start',
            }}
        >
            {[11, 12, 16, 20].map(n => (
                <>
                    <Text as="span" size="ui" tone="faint">
                        {n}px
                    </Text>
                    <IconBar label={`Toolbar at ${n}px`} iconSize={n}>
                        <IconButton icon="Search" label="Search" />
                        <IconButton icon="Inbox" label="Inbox" />
                        <IconButton icon="Settings" label="Settings" />
                    </IconBar>
                </>
            ))}
        </div>
    ),
}

/** One file-tree row as the real tree draws it (FileTree.module.css `.ft-row`: `--row-h` tall,
 *  `var(--sp-3)` between icon and name, `--fs-ui` muted text) — with the glyph at `size`. */
function TreeRow(props: { icon: string; name: string; size: number }) {
    return (
        <div
            style={{
                display: 'flex',
                'align-items': 'center',
                gap: 'var(--sp-3)',
                height: 'var(--row-h)',
                padding: '0 var(--sp-4)',
            }}
        >
            <Icon value={props.icon} size={props.size} />
            <Text as="span" size="ui" tone="muted">
                {props.name}
            </Text>
        </div>
    )
}

const TREE: [string, string][] = [
    ['Folder', 'archive'],
    ['Folder', 'dreams'],
    ['FolderOpen', 'projects'],
    ['FileText', 'Calendar'],
    ['FileText', 'reading list'],
    ['Settings2', 'settings'],
]

/** A sidebar column: the toolbar band over tree rows, every glyph at `toolbar` / `tree` px. */
function SidebarColumn(props: {
    title: string
    toolbar: number
    tree: number
}) {
    return (
        <div
            style={{
                display: 'flex',
                'flex-direction': 'column',
                gap: 'var(--sp-3)',
            }}
        >
            <Text as="span" size="ui" tone="faint">
                {props.title}
            </Text>
            <div
                style={{
                    width: '220px',
                    background: 'var(--rail)',
                    border: '1px solid var(--border-soft)',
                }}
            >
                <IconBar band label="Sidebar toolbar" iconSize={props.toolbar}>
                    <IconButton icon="Search" label="Search" />
                    <IconButton icon="Inbox" label="Inbox" />
                    <IconButton icon="Settings" label="Settings" />
                </IconBar>
                <div style={{ padding: 'var(--sp-2) 0 var(--sp-4)' }}>
                    {TREE.map(([icon, name]) => (
                        <TreeRow icon={icon} name={name} size={props.tree} />
                    ))}
                </div>
            </div>
        </div>
    )
}

/** The app's ONE icon size judged IN CONTEXT — the sidebar toolbar and file-tree rows next to the
 *  real 11.5px `--fs-ui` chrome text — at the default and at two larger `appearance.iconSize`
 *  values, so a change to the setting can be previewed before it is made. */
export const SizesInContext: Story = {
    render: () => (
        <div
            style={{
                display: 'flex',
                gap: 'var(--sp-7)',
                'align-items': 'flex-start',
            }}
        >
            <SidebarColumn title="12px // the default" toolbar={12} tree={12} />
            <SidebarColumn title="14px" toolbar={14} tree={14} />
            <SidebarColumn title="16px" toolbar={16} tree={16} />
        </div>
    ),
}
