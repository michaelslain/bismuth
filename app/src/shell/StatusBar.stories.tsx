// Visual spec for <StatusBar> — the field-log line along the bottom of the app shell
// (design/ascii/README.md "App shell", §2): vault name, the focused pane's content path,
// connection health, and right-aligned mode + daemon indicators, closed by a blinking `_` caret.
//
// WHY THIS FILE EXISTS: nine `.status-*` rules are about to move from the global App.css into
// StatusBar.module.css, which HASHES every class name. A name left behind as a string literal
// still compiles and still renders, it just matches nothing. Nothing else in the repo can see
// that: typecheck reads no CSS, and Bun resolves `solid-js/web` to its server build so no unit
// test can mount a Solid component at all. `bench/cssBaseline.ts` reads computed styles off
// Storybook, so these stories ARE the gate — and they were recorded BEFORE the CSS moved, while
// the class names were still the pre-migration global literals. That ordering is the only one
// under which a subsequent "0 changed" means the migration preserved the rendering; a story first
// recorded after the move would have blessed whatever it happened to render, broken included.
//
// NO FIXTURE SEAM NEEDED: the component takes seven read-only props and a callback, holds no
// state, fetches nothing, and reads no context. The Storybook-wide setup in .storybook/preview.ts
// already supplies the real theme tokens this needs (`--text-muted`, `--faint`, `--warning`,
// `--fg`) projected onto :root exactly as App.tsx projects them.
//
// FIVE STORIES: `Default` is the resting state. `NoVault` exercises the `props.vaultName || "vault"`
// fallback (an empty string, e.g. before `GET /config` resolves). `ConnectionLost` is LOAD-BEARING
// — it is the only story that renders `.status-conn` at all, so without it that rule has zero
// coverage and could be dropped in the CSS move with a green gate. `DaemonWorking` covers the third
// daemon-badge text variant. `LongPath` gives `.status-path` a 200-char path inside a fixed-width
// wrapper so its `overflow: hidden; text-overflow: ellipsis` is actually exercised rather than
// trivially passing because the text never overflowed.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { StatusBar } from './StatusBar'

const noop = () => {}

const meta = {
    title: 'Shell/StatusBar',
    component: StatusBar,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof StatusBar>

export default meta
type Story = StoryObj<typeof meta>

const base = {
    vaultName: 'notes',
    vaultPath: '/Users/michaelslain/Documents/notes',
    path: 'projects/roadmap.md',
    connected: true,
    mode: 'both',
    daemon: 'off' as const,
    onCopyVault: noop,
}

/** The resting state: connected, daemon off, a normal-length path. */
export const Default: Story = {
    render: () => <StatusBar {...base} />,
}

/** Before `GET /config` resolves (or on failure), `vaultName` is the empty string and the bar
 *  falls back to the literal "vault" rather than rendering blank. */
export const NoVault: Story = {
    render: () => <StatusBar {...base} vaultName="" vaultPath="" />,
}

/** The only story rendering `.status-conn` at all — `currentConnectionState() !== "connected"`
 *  (SSE loss, before the `/version` poll recovers it). Without this story the rule has zero
 *  coverage and a CSS move could silently drop it. */
export const ConnectionLost: Story = {
    render: () => <StatusBar {...base} connected={false} />,
}

/** The daemon badge's third text variant — `anyWorking()` true while `settings.daemon.enabled`. */
export const DaemonWorking: Story = {
    render: () => <StatusBar {...base} daemon="working" />,
}

/** A 200-character path inside a fixed-width wrapper, so `.status-path`'s
 *  `overflow: hidden; text-overflow: ellipsis` is actually exercised. */
export const LongPath: Story = {
    render: () => (
        <div style={{ width: '360px', border: '1px solid var(--border-soft)' }}>
            <StatusBar
                {...base}
                path={
                    'projects/' +
                    'very-long-nested-folder-name/'.repeat(6) +
                    'roadmap.md'
                }
            />
        </div>
    ),
}
