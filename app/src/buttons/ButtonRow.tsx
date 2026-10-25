// app/src/buttons/ButtonRow.tsx
// One ```button fence as a row of bracket chips (primary last), then a single status line: working,
// done / failed with its age, or the confirm prompt for an untrusted note button. Presentational:
// the host (ButtonBlockView) owns state, polling, trust and the actual press.
import { createEffect, For, onCleanup, Show, type Component } from 'solid-js'
import type { ButtonBlock, ButtonSpec, ButtonState } from '../../../core/src/buttons/buttonTypes'
import Text from '../ui/Text'
import { TextButton } from '../ui/TextButton'
import { isDismissKey } from '../ui/widgetKeys'
import { buttonRuntime } from './buttonRuntime'
import { isStale, statusLine, trustText } from './buttonRowLogic'
import styles from './ButtonRow.module.css'

export type ButtonRowProps = {
    block: ButtonBlock
    /** Index-aligned with block.buttons; null = idle (and always null for send/command). */
    states: (ButtonState | null)[]
    /** Index of the button showing its confirm line, or null. */
    confirming: number | null
    daemonOff: boolean
    notOwner: boolean
    /** Ms epoch for the "2m ago" readouts; stories pin it. */
    now: number
    onPress: (index: number) => void
    onConfirm: () => void
    onCancel: () => void
    class?: string
}

const confirmBody = (a: ButtonSpec['action']): string =>
    a.type === 'prompt' ? a.prompt : a.type === 'send' ? a.text : ''
const confirmMeta = (a: ButtonSpec['action']): string | null =>
    a.type === 'prompt' ? `${a.model} // ${a.timeoutSecs}s` : null

const NOT_OWNER = "this device isn't the daemon owner — pressing here won't run"

function tooltip(spec: ButtonSpec): string {
    const a = spec.action
    if (a.type === 'prompt') return a.prompt.slice(0, 300)
    if (a.type === 'send') return `send: ${a.text}`
    return buttonRuntime().commandLabel(a.id) ?? a.id
}

const ButtonRow: Component<ButtonRowProps> = props => {
    // primary LAST, otherwise source order; keep the source index for presses
    const ordered = () =>
        props.block.buttons
            .map((spec, index) => ({ spec, index }))
            .sort((a, b) => Number(a.spec.kind === 'primary') - Number(b.spec.kind === 'primary'))
    const hasPrompt = () => props.block.buttons.some(b => b.action.type === 'prompt')
    const working = (i: number) => {
        const s = props.states[i]
        return !!s && s.status === 'working' && !isStale(s, props.now)
    }
    const disabled = (spec: ButtonSpec, i: number) =>
        working(i) ||
        props.confirming !== null ||
        (spec.action.type === 'prompt' && (props.daemonOff || props.notOwner))
    // the freshest state wins the single status line
    const latest = () =>
        props.states.reduce<ButtonState | null>(
            (best, s) => (s && (!best || s.pressedAt > best.pressedAt) ? s : best),
            null,
        )
    const status = () => statusLine(latest(), props.now)
    const confirmAction = () =>
        props.confirming === null ? null : (props.block.buttons[props.confirming]?.action ?? null)

    createEffect(() => {
        if (props.confirming === null) return
        const onKey = (e: KeyboardEvent) => {
            if (isDismissKey(e)) props.onCancel()
        }
        document.addEventListener('keydown', onKey)
        onCleanup(() => document.removeEventListener('keydown', onKey))
    })

    return (
        <div class={`${styles['button-row']} ${props.class ?? ''}`} data-button-row>
            <Show
                when={!props.block.error}
                fallback={
                    <Text as="div" size="ui" tone="danger" class={styles.line}>
                        {`button // ${props.block.error}`}
                    </Text>
                }
            >
                <Show when={props.notOwner && hasPrompt()}>
                    <Text as="div" size="ui" tone="muted" class={styles.line}>
                        {NOT_OWNER}
                    </Text>
                </Show>
                <div class={styles.chips}>
                    <For each={ordered()}>
                        {item => (
                            <TextButton
                                primary={item.spec.kind === 'primary'}
                                danger={item.spec.kind === 'danger'}
                                disabled={disabled(item.spec, item.index)}
                                data-tooltip={tooltip(item.spec)}
                                onClick={() => props.onPress(item.index)}
                            >
                                {item.spec.label.toLowerCase()}
                            </TextButton>
                        )}
                    </For>
                    <Show when={props.daemonOff && hasPrompt()}>
                        <Text as="span" size="ui" tone="muted">
                            daemon is off
                        </Text>
                    </Show>
                </div>
                <Show
                    when={confirmAction()}
                    fallback={
                        <Show when={status()}>
                            {line => (
                                <Text
                                    as="div"
                                    size="ui"
                                    tone={line().tone}
                                    truncate
                                    class={styles.line}
                                    data-tooltip={line().full}
                                >
                                    {line().text}
                                </Text>
                            )}
                        </Show>
                    }
                >
                    {action => (
                        <div class={styles.confirm}>
                            <Text as="div" size="ui" tone="muted" class={styles.ask}>
                                {action().type === 'send' ? 'send this?' : 'run this?'}
                            </Text>
                            <Text as="div" size="ui" tone="muted" class={styles.body} data-confirm-text>
                                {confirmBody(action())}
                            </Text>
                            <Show when={confirmMeta(action())}>
                                {meta => (
                                    <Text as="div" size="ui" tone="muted" class={styles.line}>
                                        {meta()}
                                    </Text>
                                )}
                            </Show>
                            <div class={styles.chips}>
                                <TextButton
                                    primary
                                    data-tooltip={trustText(action()).slice(0, 300)}
                                    onClick={props.onConfirm}
                                >
                                    {action().type === 'send' ? 'send' : 'run'}
                                </TextButton>
                                <TextButton onClick={props.onCancel}>cancel</TextButton>
                            </div>
                        </div>
                    )}
                </Show>
            </Show>
        </div>
    )
}

export default ButtonRow
