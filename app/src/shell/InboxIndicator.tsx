import { Show } from 'solid-js'
import styles from './InboxIndicator.module.css'

// The status bar's daemon-inbox NOTIFICATION indicator.
//
// THIS IS NOT A SECOND INBOX BUTTON. The sidebar header bar already carries one (App.tsx's
// `ToolbarButton` + the `open-inbox` entry in settingsSchema's `toolbar` default), and that one
// is a *launcher*: an icon button that happens to grow a count badge. This is the inverse — a
// always-present readout of "is anything waiting for you", living in the field-log line beside
// `daemon: …`, which happens to also be pressable. Requested 2026-08-29: "its a notification
// indicator, not an inbox button".
//
// WHY IT STILL RENDERS AT ZERO. A notification indicator that vanishes when there is nothing to
// notify is not a *place* — the user asked for "a place in the toolbar for inbox notifications",
// and a control that only exists while it has something to say can never be found, learned, or
// pressed on purpose. So the resting state is quiet (faint, no dot, matching `.status-daemon`'s
// weight) and the alert state lights up: a --gold dot plus the count promoted to --fg. Same shape
// either way, so nothing in the bar reflows as pages arrive and settle.
//
// --gold is the daemon inbox's own "pending / awaiting review" colour — daemonInboxLogic.ts's
// STATUS_COLOR maps `pending` to `var(--gold)` and InboxView paints its row dots from it. Reusing
// it here means the dot in the status bar and the dots in the inbox it opens are the same signal,
// not two independent colour choices that can drift.
//
// VISIBILITY IS THE CALLER'S CALL: StatusBar renders this only while the daemon is on, since the
// whole inbox surface is gated behind `settings.daemon.enabled` (see CLAUDE.md, "Daemon
// Integration") and a count of 0 pages in a vault with no daemon is meaningless rather than calm.
//
// WHY A BARE <button> AND NOT ui/Button. The house rule is "never a bare <button> where a ui/
// primitive exists", and the exemption it names is "if no primitive fits". None does: ui/Button
// composes the `.btn` family via buttonClass.ts, which brings a border, padding and one of three
// sizes — chrome sized for a real button, not for a run of text inside an 18px --fs-micro field
// log. Adopting it would mean overriding most of what it applies, which is the shape of fighting a
// primitive rather than using one. shell/WindowControls.tsx is the established precedent for
// exactly this case (a bare <button> plus a module class, for chrome that is clickable without
// being button-shaped), and this follows it deliberately — do not "fix" it into a ui/Button.
// It IS a real <button>, not the clickable <span> that `.status-vault` uses beside it, because
// this one is reachable and operable from the keyboard; `.status-vault`'s copy-to-clipboard is
// not, which is a pre-existing gap this component does not inherit.
//
// Classes are reached through the imported `styles` object — bracket access, not
// `styles.statusInbox`, since Vite only exposes camelCase aliases under css.modules.
// localsConvention, which app/vite.config.ts does not set. The conditional class rides
// `classList={{ [styles[...]]: … }}` for the same reason: a bare "status-inbox--pending" literal
// would hash to nothing and silently never match.
export function InboxIndicator(props: { count: number; onOpen: () => void }) {
    const pending = () => props.count > 0
    // Spelled out for the accessible name because "inbox: 3" read aloud is a label and a number
    // with no relationship stated. The pressed outcome is named too — this is the only affordance
    // in the bar whose click does something other than copy text.
    const label = () =>
        pending()
            ? `Inbox: ${props.count} page${props.count === 1 ? '' : 's'} awaiting review. Open inbox.`
            : 'Inbox: nothing awaiting review. Open inbox.'
    return (
        <button
            type="button"
            class={styles['status-inbox']}
            classList={{ [styles['status-inbox--pending']]: pending() }}
            aria-label={label()}
            title={label()}
            onClick={props.onOpen}
        >
            <Show when={pending()}>
                <span class={styles['status-inbox-dot']} />
            </Show>
            inbox: {props.count}
        </button>
    )
}
