// app/src/daemon/DaemonRow.tsx
// One row of a shared column grid — the crons/services lists' only row primitive. The PARENT
// list (DaemonCrons.module.css's `.list` / DaemonProcesses.module.css's `.list`) sets
// `grid-template-columns`; this row is `grid-column: 1 / -1; display: grid; grid-template-columns:
// subgrid`, so its cells land in the parent's own tracks and every row's dot/name/meta/status/
// actions line up across the whole list — a flex row per item would drift instead (each row
// sizing its own columns from its own content).
//
// `meta` is rendered only when the prop is DEFINED (`!== undefined`), never merely truthy — a
// subgrid row has no explicit grid-column indices, so its cells rely on auto-placement filling
// the parent's tracks in DOM order. A list must therefore pass `meta` on EVERY row or NEVER: one
// row rendering 5 cells inside a 4-column list (or vice versa) overflows into a wrapped second
// line instead of lining up. DaemonCrons always supplies `meta` (even `''`) so its rows keep 5
// cells against its 5-column list; DaemonProcesses never does, so its rows stay at 4 cells
// against its 4-column list — "the column stays empty" from the caller's own list, never a
// column a single row invents or drops on its own. `actions` has no such constraint: it is
// always the LAST cell, so a row that omits it simply ends one cell short with no effect on
// anything before it.
import { type JSX, Show } from 'solid-js'
import Text from '../ui/Text'
import Label from '../ui/Label'
import { isConfirmKey } from '../ui/widgetKeys'
import styles from './DaemonRow.module.css'

export type DaemonRowTone = 'ok' | 'running' | 'failed' | 'off' | 'idle'

export type DaemonRowProps = {
    name: string
    /** Dot colour token — always paired with `status` text, never the only signal. */
    tone: DaemonRowTone
    /** 'ok 4m ago' | 'failed 2h ago' | 'running' | 'off' | 'on'. */
    status: string
    /** Schedule / trigger. Omitted (not just empty) → the column renders with nothing in it. */
    meta?: string
    /** Disabled definition — the whole row dims. */
    dim?: boolean
    /** Trailing slot ('[ run ]', or '[ delete ] [ cancel ]' while confirming). */
    actions?: JSX.Element
    onOpen?: () => void
    onContextMenu?: (e: MouseEvent) => void
    class?: string
}

const GLOW_TONE: DaemonRowTone = 'running'

function DaemonRow(props: DaemonRowProps) {
    const glow = () => props.tone === GLOW_TONE
    const open = () => props.onOpen?.()

    return (
        <div
            class={`${styles.row} ${props.class ?? ''}`}
            classList={{ [styles.dim]: props.dim }}
            tabIndex={props.onOpen ? 0 : undefined}
            role={props.onOpen ? 'button' : undefined}
            onClick={open}
            onKeyDown={e => {
                // Only the row's own key events, not ones bubbling up from a focused child
                // button ([ run ]/[ delete ]/[ cancel ]) — otherwise Enter/Space on a button
                // both fires the button's click AND opens the row's definition file.
                if (e.target !== e.currentTarget) return
                // ui-confirm (rebindable, default Enter) plus a hardcoded Space — Space is this
                // row's own activation gesture under the WAI-ARIA button pattern (role="button"),
                // not a named command, same treatment as ui/ToggleRow.tsx's switch.
                if (!isConfirmKey(e) && e.key !== ' ') return
                e.preventDefault()
                open()
            }}
            onContextMenu={props.onContextMenu}
        >
            <Text
                as="span"
                size="inherit"
                tone="inherit"
                weight="inherit"
                class={styles.dot}
                classList={{
                    [styles.glow]: glow(),
                    [styles['tone-ok']]: props.tone === 'ok',
                    [styles['tone-running']]: props.tone === 'running',
                    [styles['tone-failed']]: props.tone === 'failed',
                    [styles['tone-off']]: props.tone === 'off',
                    [styles['tone-idle']]: props.tone === 'idle',
                }}
            />
            <Label tone={props.dim ? 'faint' : 'default'} class={styles.name}>
                {props.name}
            </Label>
            <Show when={props.meta !== undefined}>
                <Text as="span" size="micro" tone="muted" class={styles.meta}>
                    {props.meta}
                </Text>
            </Show>
            <Text
                as="span"
                size="micro"
                class={styles.status}
                classList={{
                    [styles['tone-ok']]: props.tone === 'ok',
                    [styles['tone-running']]: props.tone === 'running',
                    [styles['tone-failed']]: props.tone === 'failed',
                    [styles['tone-off']]: props.tone === 'off',
                    [styles['tone-idle']]: props.tone === 'idle',
                }}
            >
                {props.status}
            </Text>
            <div class={styles.actions}>{props.actions}</div>
        </div>
    )
}

export default DaemonRow
