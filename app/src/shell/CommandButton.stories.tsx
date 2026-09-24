// Visual spec for <CommandButton> — the presentational half of App.tsx's configurable toolbar
// button, shared by the sidebar header bar and the vertical tab rail.
//
// WHY THIS FILE EXISTS: `.toolbar-btn-wrap` and `.toolbar-badge` are CommandButton.module.css
// classes, HASHED at build time. A name left behind as a string literal still compiles and still
// renders, it just matches nothing — the badge loses its absolute positioning and lands inline
// instead of pinned to the icon's corner. Nothing else in the repo can see that: typecheck reads
// no CSS, and Bun resolves `solid-js/web` to its server build so no unit test can mount a Solid
// component at all. `bench/cssBaseline.ts` reads computed styles off Storybook, so these stories
// ARE the gate.
//
// EVERY STORY RENDERS INSIDE AN `IconBar` (toolbar-iconbar plan, Task 3) — CommandButton no
// longer hardcodes a size, so its box and glyph now come entirely from the enclosing bar via
// context, the same as every real caller (the sidebar row, the tab rail). A CommandButton
// rendered bare, with no IconBar, would just fall back to IconButton's own default and prove
// nothing about this component's actual behaviour.
//
// FOUR STORIES: `Default` at rest. `WithBadge` — the only story rendering `.toolbar-badge` at a
// default size, on a dark surface so its `color: var(--bg)` on `background: var(--accent)` is
// legible. `Disabled` — the unknown-command fallback path, which also wraps in
// `.toolbar-btn-wrap`. `WithBadgeLarge` — the same badge at `toolbarIconSize` 20 (the schema's
// upper bound) with a neighbour button on each side, proving the badge's fixed `--sp-1` corner
// inset (not a percentage of its own size) still clears the `--sp-2` inter-button gap and never
// touches either neighbour's bracket (Acceptance 6).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { CommandButton } from './CommandButton'
import IconBar from '../ui/IconBar'

const noop = () => {}

const meta = {
    title: 'Shell/CommandButton',
    component: CommandButton,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof CommandButton>

export default meta
type Story = StoryObj<typeof meta>

/** The resting state: a single icon button with no badge. */
export const Default: Story = {
    render: () => (
        <IconBar label="Toolbar">
            <CommandButton icon="Inbox" label="Inbox" onClick={noop} />
        </IconBar>
    ),
}

/** The inbox's live due-count badge — one of the two stories that render `.toolbar-badge`
 *  (with WithBadgeLarge).
 *  Rendered on a dark surface so the badge's `color: var(--bg)` on `background: var(--accent)`
 *  reads correctly. */
export const WithBadge: Story = {
    render: () => (
        <div style={{ padding: '12px', background: 'var(--bg)' }}>
            <IconBar label="Toolbar">
                <CommandButton icon="Inbox" label="Inbox" badge={3} onClick={noop} />
            </IconBar>
        </div>
    ),
}

/** The unknown-command fallback: `resolveButtonCommands` found nothing to run, so the button is
 *  disabled and its label names the unresolved command. */
export const Disabled: Story = {
    render: () => (
        <IconBar label="Toolbar">
            <CommandButton
                icon="CircleHelp"
                label="Unknown command: not-a-real-command"
                disabled
                onClick={noop}
            />
        </IconBar>
    ),
}

/** The badge at the schema's largest `toolbarIconSize` (20px) and smallest (11px), each with a
 *  neighbour button on either side — proves the badge (now laid out in-flow after its button,
 *  Task 3 fix round 2) never covers either neighbour's `[`/`]` at the size extremes the setting
 *  allows. BOTH bars are built INLINE, directly as children of their own `<IconBar>`, inside this
 *  `render()` — never hoisted to a module-level constant and reused as `{row}` — because
 *  `useIconBar()` is a Solid context read, and context is only visible to JSX created while the
 *  provider is actually rendering it. A `const row = <>…</>` built once at module scope, then
 *  interpolated into a story's JSX, would run outside any `<IconBar>` at creation time and every
 *  `CommandButton` in it would silently fall back to `IconButton`'s standalone default (14px icon,
 *  24px box) instead of the bar's `iconSize` — never exercising the sizes this story exists to
 *  prove. */
export const WithBadgeLarge: Story = {
    render: () => (
        <div style={{ padding: '12px', background: 'var(--bg)' }}>
            <IconBar label="Toolbar" iconSize={20}>
                <CommandButton icon="Search" label="Search" onClick={noop} />
                <CommandButton icon="Inbox" label="Inbox" badge={3} onClick={noop} />
                <CommandButton icon="Settings" label="Settings" onClick={noop} />
            </IconBar>
            <div style={{ height: '12px' }} />
            <IconBar label="Toolbar" iconSize={11}>
                <CommandButton icon="Search" label="Search" onClick={noop} />
                <CommandButton icon="Inbox" label="Inbox" badge={3} onClick={noop} />
                <CommandButton icon="Settings" label="Settings" onClick={noop} />
            </IconBar>
        </div>
    ),
}
