// app/src/chat/ChatAuthPanel.tsx
// The opencode auth popover BODY.
// Lists stored credentials (`opencode auth list`) and gives the in-app login path: opencode's login
// wizard (`opencode auth login`) is CLI-interactive, so the affordance here is honest — open a
// Bismuth terminal tab (the wizard runs right there) or copy the command. The ANCHOR + toggle pill
// stay in ChatControls.tsx, which owns "where does this attach"; this file owns only the body.
import {
    For,
    Show,
    createEffect,
    createSignal,
    onCleanup,
    onMount,
    type Component,
} from 'solid-js'
import styles from './ChatAuthPanel.module.css'
import { Icon } from '../icons/Icon'
import Text from '../ui/Text'
import { TextButton } from '../ui/TextButton'
import InlineCode from '../ui/InlineCode'
import { OPENCODE_LOGIN_COMMAND } from '../chatProvider'
import { pushToast } from '../toastStore'
import { copyChatText } from './copyChatText'
import { placeBelowOrAbove } from '../ui/popover/placeAnchored'
import { isDismissKey } from '../ui/widgetKeys'

export type ChatAuthPanelProps = {
    providers: { name: string; kind: string }[] | null
    onClose: () => void
    class?: string
}

const ChatAuthPanel: Component<ChatAuthPanelProps> = props => {
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
    // Re-measure whenever the body's own content changes shape (providers list, checking
    // state) — the fit test depends on the panel's own height, and only then reposition.
    createEffect(() => {
        props.providers // track
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
    const copyCommand = () =>
        copyChatText(OPENCODE_LOGIN_COMMAND, {
            ok: `Copied "${OPENCODE_LOGIN_COMMAND}"`,
            fail: `Couldn't copy — type ${OPENCODE_LOGIN_COMMAND} in a terminal.`,
        })

    return (
        <div
            ref={panel!}
            class={`${styles.panel} bismuth-popover ${props.class ?? ''}`}
            style={{ top: `${top()}px` }}
        >
            <div class={styles.title}>opencode credentials</div>
            <Show
                when={(props.providers ?? []).length > 0}
                fallback={
                    <div class={styles.state}>
                        {props.providers === null
                            ? 'Checking credentials…'
                            : 'No providers signed in yet.'}
                    </div>
                }
            >
                <For each={props.providers ?? []}>
                    {p => (
                        <div class={styles.row}>
                            <Icon value="KeyRound" />
                            <Text
                                as="span"
                                inherit
                                class={styles.name}
                            >
                                {p.name}
                            </Text>
                            <Show when={p.kind}>
                                <Text
                                    as="span"
                                    inherit
                                    class={styles.kind}
                                >
                                    {p.kind}
                                </Text>
                            </Show>
                        </div>
                    )}
                </For>
            </Show>
            <div class={styles.help}>
                Add or change providers (including opencode Zen) with{' '}
                <InlineCode>{OPENCODE_LOGIN_COMMAND}</InlineCode> — it's an interactive
                wizard, so it runs in a terminal.
            </div>
            <div class={styles.actions}>
                <TextButton onClick={openTerminal}>open terminal</TextButton>
                <TextButton onClick={copyCommand}>copy command</TextButton>
            </div>
        </div>
    )
}

export default ChatAuthPanel
