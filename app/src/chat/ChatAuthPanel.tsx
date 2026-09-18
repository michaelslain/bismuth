// app/src/chat/ChatAuthPanel.tsx
// The opencode auth popover BODY — moved out of ChatView.tsx's inline `AuthPanel()` (~2762-2851).
// Lists stored credentials (`opencode auth list`) and gives the in-app login path: opencode's login
// wizard (`opencode auth login`) is CLI-interactive, so the affordance here is honest — open a
// Bismuth terminal tab (the wizard runs right there) or copy the command. The ANCHOR + toggle pill
// stay in ChatControls.tsx, which owns "where does this attach"; this file owns only the body.
import { For, Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js'
import styles from './ChatAuthPanel.module.css'
import { Icon } from '../icons/Icon'
import Text from '../ui/Text'
import { TextButton } from '../ui/TextButton'
import { OPENCODE_LOGIN_COMMAND } from '../chatProvider'
import { pushToast } from '../Toast'
import { placeBelowOrAbove } from '../ui/popover/placeAnchored'
import { isDismissKey } from '../ui/widgetKeys'

export type ChatAuthPanelProps = {
    providers: { name: string; kind: string }[] | null
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
                            <Icon value="KeyRound" size={13} />
                            <Text
                                as="span"
                                size="inherit"
                                tone="inherit"
                                weight="inherit"
                                class={styles.name}
                            >
                                {p.name}
                            </Text>
                            <Show when={p.kind}>
                                <Text
                                    as="span"
                                    size="inherit"
                                    tone="inherit"
                                    weight="inherit"
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
                <code>{OPENCODE_LOGIN_COMMAND}</code> — it's an interactive
                wizard, so it runs in a terminal.
            </div>
            <div class={styles.actions}>
                <TextButton onClick={openTerminal}>OPEN TERMINAL</TextButton>
                <TextButton onClick={copyCommand}>COPY COMMAND</TextButton>
            </div>
        </div>
    )
}
