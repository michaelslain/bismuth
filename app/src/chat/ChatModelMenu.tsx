// app/src/chat/ChatModelMenu.tsx
// The controls row's ONE model control (Task 2 — "one model control, no browser toggle, no pixel
// ladder"): a single lowercase text trigger showing modelWord() of the session's current model,
// which opens the shared ContextMenu with up to three rows (provider / model / effort), each a row
// whose own current value is folded behind a submenu instead of three separate always-visible
// pickers. This is what lets the row's four items (this control, permission mode, history, new
// chat) never overflow — there is nothing left to drop.
//
// Mounts the shared `<ContextMenu>` (app/src/ContextMenu.tsx) — Task 1 gives that menu its own
// upward flip when it would fall off the bottom of the viewport, so this component does not write a
// second placement path; it only computes the trigger's `getBoundingClientRect()` and hands the
// menu x/y.
import { createSignal, Show } from 'solid-js'
import { Portal } from 'solid-js/web'
import styles from './ChatModelMenu.module.css'
import type { ChatSession } from './chatSession'
import { Button } from '../ui/Button'
import Text from '../ui/Text'
import { ContextMenu, type MenuItem } from '../ContextMenu'
import { modelLabelFor } from '../chatModelResolution'
import { modelWord } from './modelWord'
import { modelPriceBadge, CHAT_PROVIDER_OPTIONS } from '../chatProvider'

export type ChatModelMenuProps = { session: ChatSession }

/** The provider/model/effort submenu rows this menu builds, one per capability that actually has a
 *  choice — a session with only one provider, one model, or one effort level omits that row
 *  entirely rather than showing a dead submenu with a single, unpickable option. */
function buildItems(session: ChatSession): MenuItem[] {
    const items: MenuItem[] = []

    if (CHAT_PROVIDER_OPTIONS.length > 1) {
        const current = session.provider()
        items.push({
            label: 'provider',
            detail:
                CHAT_PROVIDER_OPTIONS.find(o => o.value === current)?.label ??
                current,
            submenu: CHAT_PROVIDER_OPTIONS.map(o => ({
                label: o.label,
                icon: o.value === current ? 'Check' : undefined,
                onSelect: () => session.switchProvider(o.value),
            })),
        })
    }

    const models = session.models()
    if (models.length > 1) {
        const current = session.displayModelValue()
        items.push({
            label: 'model',
            detail: modelLabelFor(session.displayModel(), models),
            submenu: models.map(m => ({
                label: m.label,
                detail: modelPriceBadge(m.free),
                icon: m.value === current ? 'Check' : undefined,
                onSelect: () => session.switchModel(m.value),
            })),
        })
    }

    const effortOptions = session.effortOptions()
    if (effortOptions.length > 1) {
        const current = session.effortValue()
        items.push({
            label: 'effort',
            detail:
                effortOptions.find(o => o.value === current)?.label ?? current,
            submenu: effortOptions.map(o => ({
                label: o.label,
                icon: o.value === current ? 'Check' : undefined,
                onSelect: () => session.switchEffort(o.value),
            })),
        })
    }

    return items
}

/** ONE control folding provider/model/effort behind the model word — the row's replacement for
 *  three separate always-visible pickers. Reads `props.session` at each use rather than binding it
 *  to a local: a `const session = props.session` alias would read the prop once at setup and keep
 *  that value forever even if a later render hands the component a different session. */
export default function ChatModelMenu(props: ChatModelMenuProps) {
    const [menu, setMenu] = createSignal<{
        x: number
        y: number
        flipFrom: number
    } | null>(null)

    const word = () => {
        const label = modelLabelFor(
            props.session.displayModel(),
            props.session.models(),
        )
        return label ? modelWord(label) : 'default model'
    }

    const items = () => buildItems(props.session)

    return (
        <Text
            as="span"
            size="inherit"
            tone="inherit"
            weight="inherit"
            class={styles['model-menu']}
            data-chat-model
            data-testid="chat-model"
        >
            <Show
                when={items().length > 0}
                fallback={
                    <Text as="span" size="ui" tone="faint" class={styles.word}>
                        {word()}
                    </Text>
                }
            >
                <Button
                    kind="text"
                    class={styles.word}
                    title="Provider, model and effort"
                    onClick={e => {
                        const r = e.currentTarget.getBoundingClientRect()
                        setMenu({ x: r.left, y: r.bottom, flipFrom: r.top })
                    }}
                >
                    {word()}
                </Button>
                <Show when={menu()}>
                    {m => (
                        <Portal>
                            <ContextMenu
                                x={m().x}
                                y={m().y}
                                flipFrom={m().flipFrom}
                                items={items()}
                                onClose={() => setMenu(null)}
                            />
                        </Portal>
                    )}
                </Show>
            </Show>
        </Text>
    )
}
