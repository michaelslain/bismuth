// Visual spec for <StatusBar> — the field-log line along the bottom of the app shell
// (design/ascii/README.md "App shell", §2): vault name, the focused pane's content path,
// connection health, and a right-aligned inbox indicator + toned daemon readout, the latter
// carrying the blinking `_` caret that closes the line.
//
// WHY THIS FILE EXISTS: nine `.status-*` rules moved from the global App.css into
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
// STORIES. `Default` is the resting state. `NoVault` exercises the `props.vaultName || "vault"`
// fallback (an empty string, e.g. before `GET /config` resolves). `ConnectionLost` is LOAD-BEARING
// — it is the only story that renders `.status-conn` at all, so without it that rule has zero
// coverage and could be dropped in a CSS move with a green gate. `DaemonOff`/`DaemonIdle`/
// `DaemonWorking` pin all three daemon wordings AND all three `.status-daemon--*` tones
// (grey/orange/green), which nothing else covers. `InboxPending`/`InboxSingle`/`InboxMany` are the
// only stories rendering InboxIndicator's alert state (`.status-inbox--pending` +
// `.status-inbox-dot`) — same load-bearing argument as `ConnectionLost`. `LongPath` gives the
// path a 200-char value inside a fixed-width wrapper so its `overflow: hidden; text-overflow:
// ellipsis` is actually exercised rather than trivially passing because the text never overflowed.
//
// THE `mode` PROP IS GONE (2026-08-29) and so is the `.status-mode` element every story used to
// render. Nothing here should reintroduce it — the graph's mode is shown on the graph pane's own
// header toolbar now. Because `bench/cssBaseline.ts` records what stories mount, this file's
// recording MUST be re-blessed after this change; a "changed" result on these stories is the
// intended edit, not a regression.
//
// DAEMON GATING IS VISIBLE IN THE FIXTURE: `base` sets `daemon: 'idle'`, not `'off'`, because
// StatusBar hides the inbox indicator entirely while the daemon is off. A base of `'off'` would
// mean the majority of these stories silently exercised none of InboxIndicator, which is how a
// component ends up with stories that prove nothing about it.
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
    daemon: 'idle' as const,
    inboxCount: 0,
    onCopyVault: noop,
    onOpenInbox: noop,
}

/** The resting state: connected, daemon on and idle, an empty inbox, a normal-length path. */
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

/** `settings.daemon.enabled` false — reads "daemon: off". The inbox indicator is absent entirely
 *  here (not merely zeroed): with no daemon there is no inbox surface to report on. */
export const DaemonOff: Story = {
    render: () => <StatusBar {...base} daemon="off" />,
}

/** Daemon enabled, nothing in flight — reads "daemon: idle" in --gold. One of the three stories
 *  that together are the ONLY coverage of the toned `.status-daemon--*` rules; drop any one and
 *  that state's colour has no computed-style baseline and could be changed silently. */
export const DaemonIdle: Story = {
    render: () => <StatusBar {...base} daemon="idle" />,
}

/** `anyWorking()` true while `settings.daemon.enabled` — reads "daemon: working" in --green. */
export const DaemonWorking: Story = {
    render: () => <StatusBar {...base} daemon="working" />,
}

/** The inbox indicator's ALERT state, and one of only three stories rendering
 *  `.status-inbox--pending` / `.status-inbox-dot` at all. Without these the two rules have zero
 *  computed-style coverage — the same load-bearing role `ConnectionLost` plays for `.status-conn`. */
export const InboxPending: Story = {
    render: () => <StatusBar {...base} inboxCount={3} />,
}

/** Singular — the accessible label says "1 page awaiting review", not "1 pages". Worth a story of
 *  its own because the plural is computed, and an off-by-one in that expression is invisible in
 *  every other story (all of which use a plural count). */
export const InboxSingle: Story = {
    render: () => <StatusBar {...base} inboxCount={1} />,
}

/** A wide count, to prove the indicator grows rather than being clipped by `.status-bar`'s
 *  `overflow: hidden` or shoving the blinking caret off the end of the row. */
export const InboxMany: Story = {
    render: () => <StatusBar {...base} inboxCount={128} daemon="working" />,
}

const longPath =
    'projects/' + 'very-long-nested-folder-name/'.repeat(6) + 'roadmap.md'

/** A 200-character path inside a fixed-width wrapper, so the path's `overflow: hidden;
 *  text-overflow: ellipsis` (ui/Label.tsx) is actually exercised rather than trivially passing
 *  because the text never overflowed.
 *
 *  THE WRAPPER WIDENED FROM 360px TO 560px ON 2026-08-29, and the reason matters. 360px was
 *  chosen when the bar's right side read `BOTH  daemon: off`. Removing the mode readout but
 *  adding the inbox indicator made the bar's FIXED content ~358px on its own, so at
 *  360px there was no room left for a path at all — the story stopped demonstrating truncation and
 *  started demonstrating "the bar does not fit", with the path measuring 0x18. This is not moving
 *  the goalposts to get a green: the narrow case did not go away, it moved to `NarrowBar` below,
 *  which pins it explicitly. This story is the ELLIPSIS story and now has the room to be one. */
export const LongPath: Story = {
    render: () => (
        <div style={{ width: '560px', border: '1px solid var(--border-soft)' }}>
            <StatusBar {...base} path={longPath} />
        </div>
    ),
}

/** The narrow-bar degradation, pinned deliberately (an iPad slide-over or a small window — the
 *  mobile seam in `app/src/mobile/` makes these real widths, not hypothetical ones).
 *
 *  WHAT THIS STORY ASSERTS, in the order things are allowed to be spent. The path goes FIRST and
 *  goes entirely: it is the only shrinkable item here and the only one duplicated elsewhere on
 *  screen (the focused pane's header names the same file). What goes SECOND is the blinking `_`
 *  caret, which is pure decoration — measured, this story is 368px of content in a 358px box, and
 *  those 10px are the caret. Every VALUE survives intact: vault, `daemon: idle`, and the gold
 *  dot with its full `inbox: 3`.
 *
 *  So storyAudit's `clip-x` on this story is EXPECTED, and reviewing it means checking what got
 *  clipped, not that anything did. The regression to watch for is the clip reaching a value —
 *  `inbox: 3` rendering as `inbox: (` reads as a different number rather than as missing data,
 *  which is the one failure here that is worse than showing nothing. `zero-size` on the path is
 *  likewise the intended outcome, not a defect; see StatusBar.module.css for why no floor. */
export const NarrowBar: Story = {
    render: () => (
        <div style={{ width: '360px', border: '1px solid var(--border-soft)' }}>
            <StatusBar {...base} path={longPath} inboxCount={3} />
        </div>
    ),
}
