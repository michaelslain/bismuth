// app/src/buttons/ButtonBlockView.tsx
// A live ```button fence. Parses via the runtime, loads and polls the job states of its prompt
// buttons, gates note-hosted prompt/send presses behind a per-device trust confirm, and dispatches
// a press by action type. Everything outside the UI reaches it through buttonRuntime().
import { createEffect, createMemo, createSignal, on, onCleanup, type Component } from 'solid-js'
import type { ButtonHost, ButtonState } from '../../../core/src/buttons/buttonTypes'
import ButtonRow from './ButtonRow'
import { buttonRuntime } from './buttonRuntime'
import { needsTrust, trustKey } from './buttonRowLogic'

export type ButtonBlockViewProps = {
    host: ButtonHost
    body: string
    /** A `send` button's text goes here (a chat's next message, a note's quick ask). */
    onSend?: (text: string) => void
    class?: string
}

const POLL_MS = 2000
const CLOCK_MS = 30_000

const ButtonBlockView: Component<ButtonBlockViewProps> = props => {
    const rt = () => buttonRuntime()
    const block = createMemo(() => rt().parse(props.body))
    const keys = createMemo(() =>
        block().buttons.map((b, i) => (b.action.type === 'prompt' ? rt().key(props.host, props.body, i) : null)),
    )
    const [stored, setStored] = createSignal<Record<string, ButtonState>>({})
    const [refused, setRefused] = createSignal<{ index: number; state: ButtonState } | null>(null)
    const [confirming, setConfirming] = createSignal<number | null>(null)
    const [now, setNow] = createSignal(Date.now())

    const states = createMemo<(ButtonState | null)[]>(() => {
        const r = refused()
        return keys().map((k, i) => (r && r.index === i ? r.state : k ? (stored()[k] ?? null) : null))
    })
    const anyWorking = () => states().some(s => s?.status === 'working')

    async function load() {
        const ks = keys().filter((k): k is string => k !== null)
        if (ks.length === 0) return
        try {
            setStored(await rt().states(ks))
            setNow(Date.now())
        } catch {
            // keep the last known states; the next poll or press retries
        }
    }

    createEffect(on(keys, () => void load()))
    createEffect(() => {
        if (!anyWorking()) return
        const id = setInterval(() => void load(), POLL_MS)
        onCleanup(() => clearInterval(id))
    })
    createEffect(() => {
        const id = setInterval(() => setNow(Date.now()), CLOCK_MS)
        onCleanup(() => clearInterval(id))
    })

    function failedState(index: number, message: string) {
        const spec = block().buttons[index]
        const a = spec?.action
        if (!spec) return
        setNow(Date.now())
        setRefused({
            index,
            state: {
                status: 'failed',
                host: '',
                label: spec.label,
                prompt: a?.type === 'prompt' ? a.prompt : '',
                model: a?.type === 'prompt' ? a.model : '',
                timeoutSecs: a?.type === 'prompt' ? a.timeoutSecs : 0,
                pressedAt: new Date(now()).toISOString(),
                completedAt: new Date(now()).toISOString(),
                note: message,
            },
        })
    }

    async function act(index: number) {
        const spec = block().buttons[index]
        if (!spec) return
        const a = spec.action
        setRefused(null)
        try {
            if (a.type === 'send') return props.onSend?.(a.text)
            if (a.type === 'command') return await rt().runCommand(a.id)
            const res = await rt().press({ host: props.host, body: props.body, index })
            if (res.ok) {
                setStored(s => ({ ...s, [res.key]: res.state }))
                void load()
                return
            }
            failedState(index, res.message)
        } catch (e) {
            failedState(index, String((e as Error)?.message ?? e))
        }
    }

    function onPress(index: number) {
        const spec = block().buttons[index]
        if (!spec) return
        if (needsTrust(props.host, spec.action) && !rt().isTrusted(trustKey(spec.action))) {
            setConfirming(index)
            return
        }
        void act(index)
    }

    function onConfirm() {
        const index = confirming()
        setConfirming(null)
        const spec = index === null ? undefined : block().buttons[index]
        if (index === null || !spec) return
        rt().trust(trustKey(spec.action))
        void act(index)
    }

    return (
        <ButtonRow
            class={props.class}
            block={block()}
            states={states()}
            confirming={confirming()}
            daemonOff={!rt().daemonEnabled()}
            notOwner={rt().notOwner()}
            now={now()}
            onPress={onPress}
            onConfirm={onConfirm}
            onCancel={() => setConfirming(null)}
        />
    )
}

export default ButtonBlockView
