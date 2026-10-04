import { Index, Match, Show, Switch, type JSX } from 'solid-js'
import type { StatusSegment as StatusSegmentData } from '../../../core/src/statusBarEval'
import { normalizeStatusBar } from '../../../core/src/statusBarItems'
import Label from '../ui/Label'
import Text from '../ui/Text'
import Caret from '../ui/Caret'
import { InboxIndicator } from './InboxIndicator'
import StatusSegment from './StatusSegment'
import styles from './StatusBar.module.css'

// The status bar field-log line (bismuth-design/ascii/README.md "App shell", §2), lifted out of App.tsx
// verbatim — pure presentation of signals App.tsx already owns: a single location readout
// (issue #10 — the focused file's full absolute path, or `vaultPath // label` for a sentinel
// pane), connection health (serverVersion's ConnectionState), and right-aligned daemon + inbox
// indicators, closed by a blinking `_` caret. It renders an ordered segment list (`segments`, from
// `GET /status-bar`) whose builtins are today's four readouts; it owns no signal and never fetches; `onCopyLocation` is the
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
// which app/vite.config.ts does not set. `.asc-caret` stays a bare global permanently
// (global.css's `ui/ui.css` section, alongside its `@keyframes asc-blink`), not chrome owned by
// this component. `.status-dot` (owned by ui/StatusDot.tsx, in global.css's `ui/ui.css` section)
// is unrelated and never appears here despite the shared
// `status-` prefix.
// The daemon state as the bar SAYS it, distinct from the state itself. The prop keeps the three
// bare state names ('off' | 'idle' | 'working') because that is what App.tsx computes from
// `settings.daemon.enabled` + `anyWorking()`; only the wording and the tone are decided here.
//
// WHY NOT "on - idle" / "on - working". That WAS the wording, for one commit, to make the
// daemon's on-ness explicit rather than inferred from the absence of "off". Colour now carries
// that far better than a prefix did (2026-08-29, second pass: "daemon, off, grey / daemon, idle,
// orange / daemon, working, green"), so the prefix is dead weight — it padded the two most
// common states with five characters that said nothing the colour does not, in the narrowest
// type in the app. The word alone plus a tone is both shorter and louder.
const DAEMON_TEXT: Record<'off' | 'idle' | 'working', string> = {
    off: 'off',
    idle: 'idle',
    working: 'working',
}

// Today's layout as data, derived from core's defaults so the two never drift. Ids are core's
// (s0..s3); rendering is keyed by position (<Index>), so a refetch that returns the same layout
// patches text in place instead of remounting.
const DEFAULT_SEGMENTS: StatusSegmentData[] = normalizeStatusBar(undefined).map(i => ({
    id: i.id,
    builtin: i.builtin,
    align: i.align,
    text: '',
}))

export function StatusBar(props: {
    /** The single location readout (App.tsx's `statusLocation()`) — a focused file's full
     *  absolute path, or `vaultPath // label` for a sentinel pane / no focus. See issue #10. */
    location: string
    connected: boolean
    daemon: 'off' | 'idle' | 'working'
    /** Daemon-inbox pages awaiting review (App.tsx's `dueCount()`). */
    inboxCount: number
    onCopyLocation: () => void
    onOpenInbox: () => void
    /** Ordered segments from GET /status-bar. Undefined = today's default layout
     *  (location, connection | inbox, daemon) — every existing story passes nothing and must not
     *  change. */
    segments?: StatusSegmentData[]
    onRunCommand?: (commandId: string) => void
    onTrust?: (command: string) => void
}) {
    const location = () => (
        <>
        {/* No layout class of its own, deliberately: this is the one item in the row that can
            shrink to zero (Label pairs `min-width: 0` with `overflow: hidden`), so it absorbs
            every shortfall and yields entirely on a narrow bar. That is the intended
            degradation — the alternative is clipping a live status value mid-character off the
            right edge. Reasoned through with measurements in StatusBar.module.css.
            Click-to-copy (issue #10) + `title` tooltip live directly on this Label, which is
            why `.status-location` in StatusBar.module.css only adds `cursor: pointer` + the
            hover colour shift — Label already owns the shrink/ellipsis behavior above. */}
        <Label
            tone="muted"
            class={styles['status-location']}
            title={props.location || undefined}
            onClick={props.onCopyLocation}
        >
            {props.location}
        </Label>
        </>
    )
    const connection = () => (
        <>
        {/* The one status in this bar that can cost the user work: while it is showing, edits
            are not reaching the backend. `role="status"` (an implicit polite live region) so a
            screen reader is told the moment it appears — it was previously conveyed by 10.5px
            of colour alone, in the smallest type in the app, which is exactly backwards for
            the highest-stakes message on screen. See StatusBar.module.css for the matching
            visual promotion. */}
        <Show when={!props.connected}>
            <Text
                as="span"
                inherit
                class={styles['status-conn']}
                role="status"
            >
                connection lost — polling
            </Text>
        </Show>
        </>
    )
    const inbox = () => (
        <>
        {/* INBOX SITS BEFORE THE DAEMON, so the daemon status can be the last thing on the
            line and own the caret (below). Gated on the daemon being on: the whole inbox
            surface is gated behind `settings.daemon.enabled` (CLAUDE.md, "Daemon
            Integration"), so with the daemon off there is no inbox to have notifications from
            — "inbox: 0" there would be a reading of something that isn't running, not a calm
            empty state. Mirrors the sidebar toolbar button, which App.tsx hides on the same
            condition. */}
        <Show when={props.daemon !== 'off'}>
            <InboxIndicator
                count={props.inboxCount}
                onOpen={props.onOpenInbox}
            />
        </Show>
        </>
    )
    const daemon = () => (
        <>
        {/* THE CARET LIVES INSIDE THIS SPAN, not as a sibling at the end of the bar. Being a
            sibling put it after whatever happened to be last and left it separated by the
            bar's `gap`, so it read as loose punctuation belonging to nothing. Nested, it sits
            tight against the daemon word and the pair reads as one live prompt — which is
            what a blinking cursor is for, and the daemon is the one genuinely live value here.
            Requested 2026-08-29: "that cursor effect in the bottom right corner should be for
            just this".

            ONLY THE STATE WORD IS TONED, not the whole readout (2026-08-29: "just make the
            'idle' or the 'on', etc. colorful"). "daemon:" is a fixed label — it never varies,
            so colouring it spends the eye's attention on the one part of the string that
            carries no information, and at three different hues it made the bar look like it
            had three different KINDS of thing in it rather than one thing in three states.
            Keeping the label --faint and tinting only the value also matches how the rest of
            this bar already reads: `vault // path` is neutral chrome around a changing value.

            Tone is three explicit classList entries rather than
            `styles['status-daemon-state--' + props.daemon]`: a runtime-built key is invisible
            to bench/moduleClassCheck.ts, which then downgrades this whole module to
            "reachability UNCHECKED" — literal keys keep every one of the three verifiable. */}
        <Text as="span" inherit class={styles['status-daemon']}>
            daemon:{' '}
            <Text
                as="span"
                inherit
                classList={{
                    [styles['status-daemon-state--off']]:
                        props.daemon === 'off',
                    [styles['status-daemon-state--idle']]:
                        props.daemon === 'idle',
                    [styles['status-daemon-state--working']]:
                        props.daemon === 'working',
                }}
            >
                {DAEMON_TEXT[props.daemon]}
            </Text>
            <Caret class={styles['status-caret']} />
        </Text>
        </>
    )
    // `segments` undefined is today's bar expressed as the list it would have been: the same four
    // builtins in the same DOM order, so the default render is unchanged element for element.
    // A builtin segment renders exactly the element it always did (the four consts above); only a
    // non-builtin goes through StatusSegment. The left group, then the spacer, then the right group.
    const segments = () => props.segments ?? DEFAULT_SEGMENTS
    const renderSegment = (segment: () => StatusSegmentData): JSX.Element => (
        <Switch>
            <Match when={segment().builtin === 'location'}>{location()}</Match>
            <Match when={segment().builtin === 'connection'}>{connection()}</Match>
            <Match when={segment().builtin === 'inbox'}>{inbox()}</Match>
            <Match when={segment().builtin === 'daemon'}>{daemon()}</Match>
            <Match when={!segment().builtin}>
                <StatusSegment
                    segment={segment()}
                    onRunCommand={props.onRunCommand}
                    onTrust={props.onTrust}
                />
            </Match>
        </Switch>
    )
    return (
        <div class={styles['status-bar']}>
            <Index each={segments().filter(s => s.align === 'left')}>
                {renderSegment}
            </Index>
            <div class={styles['status-spacer']} />
            <Index each={segments().filter(s => s.align === 'right')}>
                {renderSegment}
            </Index>
        </div>
    )
}
