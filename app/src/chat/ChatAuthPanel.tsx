// app/src/chat/ChatAuthPanel.tsx
// The opencode providers popover BODY. Fetches the running opencode's provider catalog on mount
// (`api.opencodeProviders()`): a Connected block, a filter, and the not-yet-connected providers as
// `OpencodeProviderRow`s that connect / sign in in place. Anything the rows cannot do (opencode's
// wizard is CLI-interactive) stays one footer line away: open a Bismuth terminal tab or copy the
// command. If opencode is not installed the route's message replaces the lists and the footer still
// works. The ANCHOR + toggle pill stay in ChatControls.tsx, which owns "where does this attach";
// this file owns only the body.
import { For, Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js'
import styles from './ChatAuthPanel.module.css'
import { Icon } from '../icons/Icon'
import Text from '../ui/Text'
import TextInput from '../ui/TextInput'
import { TextButton } from '../ui/TextButton'
import InlineCode from '../ui/InlineCode'
import OpencodeProviderRow from './OpencodeProviderRow'
import { filterAvailable } from './opencodeProviderFilter'
import { api, type OpencodeProviderList } from '../api'
import { OPENCODE_LOGIN_COMMAND } from '../chatProvider'
import { pushToast } from '../Toast'
import { placeBelowOrAbove } from '../ui/popover/placeAnchored'
import { isDismissKey } from '../ui/widgetKeys'

export type ChatAuthPanelProps = {
    onClose: () => void
    class?: string
}

export default function ChatAuthPanel(props: ChatAuthPanelProps) {
    let panel!: HTMLDivElement

    // Vertical placement is measured, not a fixed CSS `top`/`bottom` — the panel flips above
    // its anchor (`.auth-anchor`, this component's own parent element) only when it would
    // otherwise clip past the bottom of the viewport. `top` is expressed relative to the
    // anchor, which is `.panel`'s own `position: relative` positioning context.
    const [panelH, setPanelH] = createSignal(0)
    const [top, setTop] = createSignal(0)

    const reposition = () => {
        const anchor = panel?.parentElement
        if (!anchor) return
        const r = anchor.getBoundingClientRect()
        const placed = placeBelowOrAbove({
            y: r.bottom + 6,
            h: panelH(),
            viewportH: window.innerHeight,
            flipFrom: r.top,
        })
        setTop(placed - r.top)
    }
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

    // Re-measure whenever the body's own content changes shape (the catalog, the load error, the
    // filter) — the fit test depends on the panel's own height, and only then reposition.
    createEffect(() => {
        list() // track
        loadError() // track
        filtered() // track
        setPanelH(panel?.getBoundingClientRect().height ?? 0)
    })
    createEffect(() => {
        panelH() // track
        reposition()
    })

    const onDocPointerDown = (e: PointerEvent) => {
        const t = e.target as Node
        if (
            panel?.contains(t) ||
            (t as HTMLElement)?.closest?.('[data-chat-auth-anchor]')
        )
            return
        props.onClose()
    }
    const onDocKey = (e: KeyboardEvent) => {
        if (isDismissKey(e)) props.onClose()
    }
    onMount(() => {
        document.addEventListener('pointerdown', onDocPointerDown, true)
        document.addEventListener('keydown', onDocKey, true)
        window.addEventListener('resize', reposition)
        window.addEventListener('scroll', reposition, true)
    })
    onCleanup(() => {
        document.removeEventListener('pointerdown', onDocPointerDown, true)
        document.removeEventListener('keydown', onDocKey, true)
        window.removeEventListener('resize', reposition)
        window.removeEventListener('scroll', reposition, true)
    })

    const openTerminal = () => {
        window.dispatchEvent(new CustomEvent('bismuth-open-terminal'))
        props.onClose()
        pushToast(
            `Run ${OPENCODE_LOGIN_COMMAND} in the terminal, then start a new chat.`,
        )
    }
    const copyCommand = () => {
        void navigator.clipboard?.writeText(OPENCODE_LOGIN_COMMAND).then(
            () => pushToast(`Copied "${OPENCODE_LOGIN_COMMAND}"`),
            () =>
                pushToast(
                    `Couldn't copy — type ${OPENCODE_LOGIN_COMMAND} in a terminal.`,
                ),
        )
    }

    return (
        <div
            ref={panel!}
            class={`${styles.panel} bismuth-popover ${props.class ?? ''}`}
            style={{ top: `${top()}px` }}
        >
            <div class={styles.title}>opencode providers</div>
            <Show
                when={loadError() === null}
                fallback={
                    <Text as="div" tone="muted" class={styles.state} role="alert">
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
                                    <Text as="div" tone="muted" class={styles.state}>
                                        no providers connected yet
                                    </Text>
                                }
                            >
                                <For each={l().connected}>
                                    {p => (
                                        <div class={styles.row}>
                                            <Icon value="KeyRound" />
                                            <Text
                                                as="span"
                                                inherit
                                                tone="default"
                                                class={styles.name}
                                            >
                                                {p.name}
                                            </Text>
                                            <Text as="span" inherit class={styles.kind}>
                                                {p.kind === 'api' ? 'api key' : p.kind}
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
                                <Text as="div" inherit tone="muted" class={styles.note}>
                                    +{filtered().more} more // keep typing
                                </Text>
                            </Show>
                            <Show
                                when={
                                    filtered().shown.length === 0 &&
                                    l().available.length > 0
                                }
                            >
                                <Text as="div" inherit tone="muted" class={styles.note}>
                                    no provider matches "{query().trim()}"
                                </Text>
                            </Show>
                        </>
                    )}
                </Show>
            </Show>
            <div class={styles.help}>
                <Text as="div" inherit tone="muted">
                    anything else // <InlineCode>{OPENCODE_LOGIN_COMMAND}</InlineCode>
                </Text>
                <div class={styles.actions}>
                    <TextButton onClick={openTerminal}>open terminal</TextButton>
                    <TextButton onClick={copyCommand}>copy command</TextButton>
                </div>
            </div>
        </div>
    )
}
