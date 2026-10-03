// app/src/chat/OpencodeProviderRow.tsx
// ONE not-yet-connected opencode provider in the credentials popover, and the whole of its own
// connect / sign-in state machine, in place on the row:
//   idle        name + `[ connect ]` (API key) or `[ sign in ]` (OAuth) — the provider's first method
//   key         password input + `[ save ]` `[ cancel ]`
//   code        `paste the code` input + `[ submit ]`     (an OAuth `code` method)
//   waiting     `waiting for sign-in…`                      (an OAuth `auto` method, until the callback)
//   connecting  `connecting…`                               (a request is in flight)
// A failure lands back where the person can retry, with the route's message under the row in the
// danger tone chat already uses for inline errors. Success calls `onConnected(name)` — the panel
// owns the refetch and the toast; this row just stops being an available provider.
import { Show, createEffect, createSignal, type Component } from 'solid-js'
import styles from './OpencodeProviderRow.module.css'
import Text from '../ui/Text'
import TextInput from '../ui/TextInput'
import { TextButton } from '../ui/TextButton'
import { isConfirmKey } from '../ui/widgetKeys'
import { api, type OpencodeAuthMethod } from '../api'
import { openExternalUrl } from '../appWindow'

export type OpencodeRowState =
    | { kind: 'idle' }
    | { kind: 'key' }
    | { kind: 'connecting' }
    | { kind: 'code'; method: number; instructions: string }
    | { kind: 'waiting'; instructions: string }

export type OpencodeProviderRowProps = {
    provider: { id: string; name: string; methods: OpencodeAuthMethod[] }
    onConnected: (name: string) => void
    class?: string
    /** Where the row starts. A story/test seam — the app never passes it, so a row always opens
     *  idle; it exists so a state can be rendered without a timer or a real sign-in tab. */
    initialState?: OpencodeRowState
    /** A failure message to show on first render (same seam). */
    initialError?: string
}

const OpencodeProviderRow: Component<OpencodeProviderRowProps> = props => {
    const [state, setState] = createSignal<OpencodeRowState>(
        props.initialState ?? { kind: 'idle' },
    )
    const [error, setError] = createSignal<string | undefined>(
        props.initialError,
    )
    const [text, setText] = createSignal('')
    let field: HTMLDivElement | undefined

    // The method this row offers: the provider's first one (core never sends an empty list).
    const method = () => props.provider.methods[0]
    const isOauth = () => method()?.type === 'oauth'

    // Focus the input the moment the row turns into one.
    createEffect(() => {
        const k = state().kind
        if (k === 'key' || k === 'code')
            queueMicrotask(() => field?.querySelector('input')?.focus())
    })

    const fail = (e: unknown, back: OpencodeRowState) => {
        setError(e instanceof Error ? e.message : String(e))
        setState(back)
    }

    const saveKey = async () => {
        const key = text().trim()
        if (!key) return
        setError(undefined)
        setState({ kind: 'connecting' })
        try {
            await api.opencodeSetKey(props.provider.id, key)
            props.onConnected(props.provider.name)
        } catch (e) {
            fail(e, { kind: 'key' })
        }
    }

    const finishOauth = async (index: number, code?: string) => {
        try {
            await api.opencodeOauthCallback(props.provider.id, index, code)
            props.onConnected(props.provider.name)
        } catch (e) {
            fail(e, code === undefined ? { kind: 'idle' } : { kind: 'code', method: index, instructions: '' })
        }
    }

    const signIn = async () => {
        setError(undefined)
        setState({ kind: 'connecting' })
        try {
            const a = await api.opencodeOauthAuthorize(props.provider.id, 0)
            void openExternalUrl(a.url)
            if (a.method === 'code') {
                setText('')
                setState({ kind: 'code', method: 0, instructions: a.instructions })
            } else {
                setState({ kind: 'waiting', instructions: a.instructions })
                await finishOauth(0)
            }
        } catch (e) {
            fail(e, { kind: 'idle' })
        }
    }

    const submitCode = () => {
        const s = state()
        const code = text().trim()
        if (s.kind !== 'code' || !code) return
        setError(undefined)
        setState({ kind: 'connecting' })
        void finishOauth(s.method, code)
    }

    const cancel = () => {
        setError(undefined)
        setText('')
        setState({ kind: 'idle' })
    }

    const onEnter = (submit: () => void) => (e: KeyboardEvent) => {
        if (!isConfirmKey(e)) return
        e.preventDefault()
        submit()
    }

    return (
        <div class={`${styles.root} ${props.class ?? ''}`}>
            <div class={styles.row}>
                <Show
                    when={state().kind === 'key' || state().kind === 'code'}
                    fallback={
                        <>
                            <Text
                                as="span"
                                inherit
                                tone="default"
                                class={styles.name}
                            >
                                {props.provider.name}
                            </Text>
                            <Show when={state().kind === 'idle'}>
                                <TextButton
                                    onClick={() =>
                                        isOauth()
                                            ? void signIn()
                                            : (setText(''), setState({ kind: 'key' }))
                                    }
                                >
                                    {isOauth() ? 'sign in' : 'connect'}
                                </TextButton>
                            </Show>
                            <Show when={state().kind === 'connecting'}>
                                <Text as="span" inherit tone="muted">
                                    connecting…
                                </Text>
                            </Show>
                            <Show when={state().kind === 'waiting'}>
                                <Text
                                    as="span"
                                    inherit
                                    tone="muted"
                                    title={(state() as { instructions?: string }).instructions}
                                >
                                    waiting for sign-in…
                                </Text>
                            </Show>
                        </>
                    }
                >
                    <div ref={field} class={styles.field}>
                        <TextInput
                            class={styles.input}
                            type={state().kind === 'key' ? 'password' : 'text'}
                            value={text()}
                            onInput={setText}
                            placeholder={
                                state().kind === 'key'
                                    ? `${props.provider.name} API key`
                                    : 'paste the code'
                            }
                            aria-label={
                                state().kind === 'key'
                                    ? `${props.provider.name} API key`
                                    : `${props.provider.name} sign-in code`
                            }
                            title={(state() as { instructions?: string }).instructions}
                            autocomplete="off"
                            spellcheck={false}
                            onKeyDown={onEnter(
                                state().kind === 'key' ? saveKey : submitCode,
                            )}
                        />
                    </div>
                    <Show
                        when={state().kind === 'key'}
                        fallback={
                            <TextButton onClick={submitCode}>submit</TextButton>
                        }
                    >
                        <div class={styles.buttons}>
                            <TextButton onClick={() => void saveKey()}>
                                save
                            </TextButton>
                            <TextButton onClick={cancel}>cancel</TextButton>
                        </div>
                    </Show>
                </Show>
            </div>
            <Show when={error()}>
                <Text as="div" inherit class={styles.error} role="alert">
                    {error()}
                </Text>
            </Show>
        </div>
    )
}

export default OpencodeProviderRow
