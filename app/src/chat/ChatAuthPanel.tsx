// app/src/chat/ChatAuthPanel.tsx
// The opencode auth popover BODY — moved out of ChatView.tsx's inline `AuthPanel()` (~2762-2851).
// Lists stored credentials (`opencode auth list`) and gives the in-app login path: opencode's login
// wizard (`opencode auth login`) is CLI-interactive, so the affordance here is honest — open a
// Bismuth terminal tab (the wizard runs right there) or copy the command. The ANCHOR + toggle pill
// stay in ChatControls.tsx, which owns "where does this attach"; this file owns only the body.
import { For, Show, onCleanup, onMount } from 'solid-js'
import styles from './ChatAuthPanel.module.css'
import { Icon } from '../icons/Icon'
import { TextButton } from '../ui/TextButton'
import { OPENCODE_LOGIN_COMMAND } from '../chatProvider'
import { pushToast } from '../Toast'

export type ChatAuthPanelProps = {
    providers: { name: string; kind: string }[] | null
    onClose: () => void
    class?: string
}

export default function ChatAuthPanel(props: ChatAuthPanelProps) {
    let panel!: HTMLDivElement

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
        if (e.key === 'Escape') props.onClose()
    }
    onMount(() => {
        document.addEventListener('pointerdown', onDocPointerDown, true)
        document.addEventListener('keydown', onDocKey, true)
    })
    onCleanup(() => {
        document.removeEventListener('pointerdown', onDocPointerDown, true)
        document.removeEventListener('keydown', onDocKey, true)
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
        <div ref={panel!} class={`${styles.panel} bismuth-popover ${props.class ?? ''}`}>
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
                            <span class={styles.name}>{p.name}</span>
                            <Show when={p.kind}>
                                <span class={styles.kind}>{p.kind}</span>
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
