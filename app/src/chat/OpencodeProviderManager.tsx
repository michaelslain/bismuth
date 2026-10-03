// app/src/chat/OpencodeProviderManager.tsx
// The opencode provider manager BODY, hosted inside ChatModelPicker's right column (it has no frame,
// title, positioning or dismiss of its own). Fetches the running opencode's provider catalog on
// mount (`api.opencodeProviders()`): a connected list, a filter, and the not-yet-connected providers
// as `OpencodeProviderRow`s that connect / sign in in place. Anything the rows cannot do (opencode's
// wizard is CLI-interactive) stays one footer line away: open a Bismuth terminal tab or copy the
// command. If opencode is not installed the route's message replaces the lists and the footer still
// works.
import { For, Show, createSignal, onMount, type Component } from 'solid-js'
import styles from './OpencodeProviderManager.module.css'
import SectionLabel from '../ui/SectionLabel'
import Text from '../ui/Text'
import TextInput from '../ui/TextInput'
import { TextButton } from '../ui/TextButton'
import InlineCode from '../ui/InlineCode'
import OpencodeProviderRow from './OpencodeProviderRow'
import { filterAvailable } from './opencodeProviderFilter'
import { api, type OpencodeProviderList } from '../api'
import { OPENCODE_LOGIN_COMMAND } from '../chatProvider'
import { pushToast } from '../toastStore'
import { copyChatText } from './copyChatText'

export type OpencodeProviderManagerProps = {
    /** Called when "open terminal" hands off to a terminal tab, so the hosting panel can close. */
    onClose?: () => void
    class?: string
}

const OpencodeProviderManager: Component<
    OpencodeProviderManagerProps
> = props => {
    // The catalog: `null` while checking, an error message in place of the lists when the route
    // refused (opencode not installed), else the connected/available split. `loadId` drops a stale
    // answer when a refetch overtakes it.
    const [list, setList] = createSignal<OpencodeProviderList | null>(null)
    const [loadError, setLoadError] = createSignal<string | null>(null)
    const [query, setQuery] = createSignal('')
    let loadId = 0
    const load = async () => {
        const mine = ++loadId
        try {
            const next = await api.opencodeProviders()
            if (mine !== loadId) return
            setLoadError(null)
            setList(next)
        } catch (e) {
            if (mine !== loadId) return
            setLoadError(e instanceof Error ? e.message : String(e))
        }
    }
    onMount(() => void load())
    const onConnected = (name: string) => {
        pushToast(`Connected ${name}`)
        void load()
    }
    const filtered = () => filterAvailable(list()?.available ?? [], query())

    const openTerminal = () => {
        window.dispatchEvent(new CustomEvent('bismuth-open-terminal'))
        props.onClose?.()
        pushToast(
            `Run ${OPENCODE_LOGIN_COMMAND} in the terminal, then start a new chat.`,
        )
    }
    const copyCommand = () =>
        copyChatText(OPENCODE_LOGIN_COMMAND, {
            ok: `Copied "${OPENCODE_LOGIN_COMMAND}"`,
            fail: `Couldn't copy — type ${OPENCODE_LOGIN_COMMAND} in a terminal.`,
        })

    return (
        <div class={`${styles.manager} ${props.class ?? ''}`}>
            <SectionLabel class={styles.head}>providers</SectionLabel>
            <Show
                when={loadError() === null}
                fallback={
                    <Text
                        as="div"
                        tone="muted"
                        class={styles.state}
                        role="alert"
                    >
                        {loadError()}
                    </Text>
                }
            >
                <Show
                    when={list()}
                    fallback={
                        <Text as="div" tone="muted" class={styles.state}>
                            checking providers…
                        </Text>
                    }
                >
                    {l => (
                        <>
                            <Show
                                when={l().connected.length > 0}
                                fallback={
                                    <Text
                                        as="div"
                                        tone="muted"
                                        class={styles.state}
                                    >
                                        no providers connected yet
                                    </Text>
                                }
                            >
                                <For each={l().connected}>
                                    {p => (
                                        <div class={styles.row}>
                                            <Text
                                                as="span"
                                                inherit
                                                tone="default"
                                                class={styles.name}
                                            >
                                                {p.name}
                                            </Text>
                                            <Text
                                                as="span"
                                                inherit
                                                class={styles.kind}
                                            >
                                                {p.kind === 'api'
                                                    ? 'api key'
                                                    : p.kind}
                                            </Text>
                                        </div>
                                    )}
                                </For>
                            </Show>
                            <div class={styles.filter}>
                                <TextInput
                                    value={query()}
                                    onInput={setQuery}
                                    placeholder="add a provider…"
                                    aria-label="add a provider"
                                    autocomplete="off"
                                    spellcheck={false}
                                />
                            </div>
                            <For each={filtered().shown}>
                                {p => (
                                    <OpencodeProviderRow
                                        provider={p}
                                        {...{ onConnected }}
                                    />
                                )}
                            </For>
                            <Show when={filtered().more > 0}>
                                <Text
                                    as="div"
                                    inherit
                                    tone="muted"
                                    class={styles.note}
                                >
                                    +{filtered().more} more // keep typing
                                </Text>
                            </Show>
                            <Show
                                when={
                                    filtered().shown.length === 0 &&
                                    l().available.length > 0
                                }
                            >
                                <Text
                                    as="div"
                                    inherit
                                    tone="muted"
                                    class={styles.note}
                                >
                                    no provider matches "{query().trim()}"
                                </Text>
                            </Show>
                        </>
                    )}
                </Show>
            </Show>
            <div class={styles.help}>
                <Text as="div" inherit tone="muted">
                    anything else //{' '}
                    <InlineCode>{OPENCODE_LOGIN_COMMAND}</InlineCode>
                </Text>
                <div class={styles.actions}>
                    <TextButton onClick={openTerminal}>
                        open terminal
                    </TextButton>
                    <TextButton onClick={copyCommand}>copy command</TextButton>
                </div>
            </div>
        </div>
    )

    return (
        <div class={`${styles.manager} ${props.class ?? ''}`}>
            <Show
                when={loadError() === null}
                fallback={
                    <Text
                        as="div"
                        tone="muted"
                        class={styles.state}
                        role="alert"
                    >
                        {loadError()}
                    </Text>
                }
            >
                <Show
                    when={list()}
                    fallback={
                        <Text as="div" tone="muted" class={styles.state}>
                            checking providers…
                        </Text>
                    }
                >
                    {l => (
                        <>
                            <Show
                                when={l().connected.length > 0}
                                fallback={
                                    <Text
                                        as="div"
                                        tone="muted"
                                        class={styles.state}
                                    >
                                        no providers connected yet
                                    </Text>
                                }
                            >
                                <For each={l().connected}>
                                    {p => (
                                        <div class={styles.row}>
                                            <Text
                                                as="span"
                                                inherit
                                                tone="default"
                                                class={styles.name}
                                            >
                                                {p.name}
                                            </Text>
                                            <Text
                                                as="span"
                                                inherit
                                                class={styles.kind}
                                            >
                                                {p.kind === 'api'
                                                    ? 'api key'
                                                    : p.kind}
                                            </Text>
                                        </div>
                                    )}
                                </For>
                            </Show>
                            <div class={styles.filter}>
                                <TextInput
                                    value={query()}
                                    onInput={setQuery}
                                    placeholder="add a provider…"
                                    aria-label="add a provider"
                                    autocomplete="off"
                                    spellcheck={false}
                                />
                            </div>
                            <For each={filtered().shown}>
                                {p => (
                                    <OpencodeProviderRow
                                        provider={p}
                                        {...{ onConnected }}
                                    />
                                )}
                            </For>
                            <Show when={filtered().more > 0}>
                                <Text
                                    as="div"
                                    inherit
                                    tone="muted"
                                    class={styles.note}
                                >
                                    +{filtered().more} more // keep typing
                                </Text>
                            </Show>
                            <Show
                                when={
                                    filtered().shown.length === 0 &&
                                    l().available.length > 0
                                }
                            >
                                <Text
                                    as="div"
                                    inherit
                                    tone="muted"
                                    class={styles.note}
                                >
                                    no provider matches "{query().trim()}"
                                </Text>
                            </Show>
                        </>
                    )}
                </Show>
            </Show>
            <div class={styles.help}>
                <Text as="div" inherit tone="muted">
                    anything else //{' '}
                    <InlineCode>{OPENCODE_LOGIN_COMMAND}</InlineCode>
                </Text>
                <div class={styles.actions}>
                    <TextButton onClick={openTerminal}>
                        open terminal
                    </TextButton>
                    <TextButton onClick={copyCommand}>copy command</TextButton>
                </div>
            </div>
        </div>
    )
}

export default OpencodeProviderManager
