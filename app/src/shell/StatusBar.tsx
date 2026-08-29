import { Show } from 'solid-js'
import Label from '../ui/Label'
import { InboxIndicator } from './InboxIndicator'
import styles from './StatusBar.module.css'

// The status bar field-log line (design/ascii/README.md "App shell", §2), lifted out of App.tsx
// verbatim — pure presentation of signals App.tsx already owns: vault name, the focused pane's
// content, connection health (serverVersion's ConnectionState), and right-aligned daemon +
// inbox indicators, closed by a blinking `_` caret. No new state; `onCopyVault` is the
// click-to-copy callback that stays in App.tsx because it pushes toasts, which a presentational
// component must not do, and `onOpenInbox` for the same reason (it opens a tab).
//
// THE GRAPH-MODE READOUT IS GONE (2026-08-29). This bar used to end with `.status-mode` — the
// live `GraphMode` ("2ND"/"3RD"/"BOTH"/"DAEMON"/"LOCAL"), mirrored here from App.tsx's `mode()`
// signal. It was removed on request: "can we remove the both, 2nd, 3rd based on the selection in
// the graph, from the tool bar please. that doesnt belong there." The mode is not lost — it is
// still shown and still switchable on the graph pane's OWN header toolbar, which is where a
// graph-scoped control belongs. This bar is app-scoped, so a per-pane setting reading out here was
// the anomaly. `mode` is no longer a prop at all rather than merely unrendered, so no caller can
// keep threading a value nothing displays.
//
// Classes below are reached through the imported `styles` object — bracket access, not
// `styles.statusBar`, since Vite only exposes camelCase aliases under css.modules.localsConvention,
// which app/vite.config.ts does not set. `.asc-caret` stays a bare global permanently (ui.css,
// alongside its `@keyframes asc-blink`), not chrome owned by this component. `.status-dot` (owned
// by ui/StatusDot.tsx, in ui/ui.css) is unrelated and never appears here despite the shared
// `status-` prefix.
// The daemon state as the bar SAYS it, distinct from the state itself. Requested 2026-08-29:
// "daemon should say: off, on - working, on - idle". The prop keeps the three bare state names
// ('off' | 'idle' | 'working') because that is what App.tsx computes from
// `settings.daemon.enabled` + `anyWorking()`; only the wording changes here. The win is that
// "on - idle" now states the ON-ness explicitly — previously a bare "idle" left "is the daemon
// running at all?" to be inferred from the absence of the word "off", which is exactly the kind
// of read-the-negative-space inference a status line should not require.
const DAEMON_TEXT: Record<'off' | 'idle' | 'working', string> = {
    off: 'off',
    idle: 'on - idle',
    working: 'on - working',
}

export function StatusBar(props: {
    vaultName: string
    vaultPath: string
    path: string
    connected: boolean
    daemon: 'off' | 'idle' | 'working'
    /** Daemon-inbox pages awaiting review (App.tsx's `dueCount()`). */
    inboxCount: number
    onCopyVault: () => void
    onOpenInbox: () => void
}) {
    return (
        <div class={styles['status-bar']}>
            <span
                class={styles['status-vault']}
                title={props.vaultPath || undefined}
                onClick={props.onCopyVault}
            >
                {props.vaultName || 'vault'}
            </span>
            <span class={styles['status-sep']}>//</span>
            {/* No layout class of its own, deliberately: this is the one item in the row that can
                shrink to zero (Label pairs `min-width: 0` with `overflow: hidden`), so it absorbs
                every shortfall and yields entirely on a narrow bar. That is the intended
                degradation — the alternative is clipping a live status value mid-character off the
                right edge. Reasoned through with measurements in StatusBar.module.css. */}
            <Label tone="muted">{props.path}</Label>
            {/* The one status in this bar that can cost the user work: while it is showing, edits
                are not reaching the backend. `role="status"` (an implicit polite live region) so a
                screen reader is told the moment it appears — it was previously conveyed by 10.5px
                of colour alone, in the smallest type in the app, which is exactly backwards for
                the highest-stakes message on screen. See StatusBar.module.css for the matching
                visual promotion. */}
            <Show when={!props.connected}>
                <span class={styles['status-conn']} role="status">
                    connection lost — polling
                </span>
            </Show>
            <div class={styles['status-spacer']} />
            <span class={styles['status-daemon']}>
                daemon: {DAEMON_TEXT[props.daemon]}
            </span>
            {/* Gated on the daemon being on: the whole inbox surface is gated behind
                `settings.daemon.enabled` (CLAUDE.md, "Daemon Integration"), so with the daemon off
                there is no inbox to have notifications from — "inbox: 0" there would be a reading
                of something that isn't running, not a calm empty state. Mirrors the sidebar
                toolbar button, which App.tsx hides on the same condition. */}
            <Show when={props.daemon !== 'off'}>
                <InboxIndicator
                    count={props.inboxCount}
                    onOpen={props.onOpenInbox}
                />
            </Show>
            <span class="asc-caret">_</span>
        </div>
    )
}
