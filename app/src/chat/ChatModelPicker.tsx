// app/src/chat/ChatModelPicker.tsx
// The ONE model panel (replaces the provider ▸ / model ▸ / effort ▸ context-menu submenus AND the
// separate `[N providers]` pill): a left column of connectors (claude code, codex, opencode, …) and
// a right column holding the current connector's models, its effort levels, and — for opencode
// only — the provider manager (OpencodeProviderManager). Picking a connector keeps the panel open
// so its models show up beside it; picking a model closes it.
//
// Fixed-position, placed against `props.anchor` (the model word) — below it unless that would clip
// past the bottom of the viewport, then above — and portalled to <body> by the caller, because the
// controls row clips its overflow. Dismisses on an outside pointerdown (the trigger carries
// `data-chat-model-anchor`, so its own click toggles instead of dismissing-then-reopening) and Esc.
import {
    For,
    Show,
    createEffect,
    createSignal,
    onCleanup,
    onMount,
    type Component,
} from 'solid-js'
import styles from './ChatModelPicker.module.css'
import type { ChatControlsView } from './ChatControls'
import type { ChatModelOption } from './chatSession'
import { Icon } from '../icons/Icon'
import PlainButton from '../ui/PlainButton'
import SegmentedToggle from '../ui/SegmentedToggle'
import Text from '../ui/Text'
import OpencodeProviderManager from './OpencodeProviderManager'
import { CHAT_PROVIDER_OPTIONS, modelPriceBadge } from '../chatProvider'
import { placeBelowOrAbove, EDGE_GAP } from '../ui/popover/placeAnchored'
import { isDismissKey } from '../ui/widgetKeys'
import { groupModels } from './modelPickerGroups'

export type ChatModelPickerProps = {
    session: ChatControlsView
    /** The element the panel is placed against — the model word. */
    anchor: HTMLElement
    onClose: () => void
    class?: string
}

const ChatModelPicker: Component<ChatModelPickerProps> = props => {
    let panel!: HTMLDivElement
    const [top, setTop] = createSignal(0)
    const [left, setLeft] = createSignal(0)

    // Viewport coordinates (the panel is `position: fixed`): left-aligned to the anchor when there
    // is room, the right edge clamped inside the viewport; below the anchor unless that would clip,
    // then above.
    const reposition = () => {
        if (!panel) return
        const a = props.anchor.getBoundingClientRect()
        const box = panel.getBoundingClientRect()
        setTop(
            placeBelowOrAbove({
                y: a.bottom + EDGE_GAP,
                h: box.height,
                viewportH: window.innerHeight,
                flipFrom: a.top,
            }),
        )
        setLeft(
            Math.max(
                EDGE_GAP,
                Math.min(a.left, window.innerWidth - box.width - EDGE_GAP),
            ),
        )
    }

    const onDocPointerDown = (e: PointerEvent) => {
        const t = e.target as Node
        if (
            panel?.contains(t) ||
            (t as HTMLElement)?.closest?.('[data-chat-model-anchor]')
        )
            return
        props.onClose()
    }
    const onDocKey = (e: KeyboardEvent) => {
        if (isDismissKey(e)) props.onClose()
    }
    onMount(() => {
        reposition()
        // The panel changes height as the model list, effort row and provider catalog arrive.
        const ro = new ResizeObserver(reposition)
        ro.observe(panel)
        onCleanup(() => ro.disconnect())
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
    createEffect(() => {
        props.session.provider() // track: a connector switch reshapes the right column
        props.session.models()
        queueMicrotask(reposition)
    })

    const groups = () =>
        groupModels(props.session.models(), props.session.provider())
    const currentModel = () => props.session.displayModelValue()

    const pickModel = (m: ChatModelOption) => {
        props.session.switchModel(m.value)
        props.onClose()
    }

    return (
        <div
            ref={panel!}
            class={`${styles.panel} ${props.class ?? ''}`}
            style={{ top: `${top()}px`, left: `${left()}px` }}
            role="dialog"
            aria-label="model"
            data-chat-model-picker
        >
            <Text as="div" inherit class={styles.title}>
                model
            </Text>
            <div class={styles.body}>
                <div class={styles.connectors}>
                    <For each={CHAT_PROVIDER_OPTIONS}>
                        {o => {
                            const current = () =>
                                o.value === props.session.provider()
                            return (
                                <PlainButton
                                    class={`${styles.connector} ${current() ? styles['connector--current'] : ''}`}
                                    aria-current={current() || undefined}
                                    onClick={() =>
                                        props.session.switchProvider(o.value)
                                    }
                                >
                                    <Text as="span" inherit class={styles.mark}>
                                        {current() ? '▸' : ''}
                                    </Text>
                                    {o.label.toLowerCase()}
                                </PlainButton>
                            )
                        }}
                    </For>
                </div>
                <div class={styles.detail}>
                    <Show
                        when={props.session.models().length > 0}
                        fallback={
                            <Text as="div" inherit class={styles.empty}>
                                no models reported
                            </Text>
                        }
                    >
                        <For each={groups()}>
                            {g => (
                                <div class={styles.group}>
                                    <Show when={g.name}>
                                        <Text
                                            as="div"
                                            inherit
                                            class={styles['group-head']}
                                        >
                                            {g.name}
                                        </Text>
                                    </Show>
                                    <For each={g.models}>
                                        {m => (
                                            <PlainButton
                                                class={`${styles.model} ${m.value === currentModel() ? styles['model--current'] : ''}`}
                                                aria-current={
                                                    m.value ===
                                                        currentModel() ||
                                                    undefined
                                                }
                                                onClick={() => pickModel(m)}
                                            >
                                                <Text
                                                    as="span"
                                                    inherit
                                                    class={styles.check}
                                                >
                                                    <Show
                                                        when={
                                                            m.value ===
                                                            currentModel()
                                                        }
                                                    >
                                                        <Icon value="Check" />
                                                    </Show>
                                                </Text>
                                                <Text
                                                    as="span"
                                                    inherit
                                                    class={styles.label}
                                                >
                                                    {m.shortLabel}
                                                </Text>
                                                <Text
                                                    as="span"
                                                    inherit
                                                    class={styles.badge}
                                                >
                                                    {modelPriceBadge(
                                                        m.free,
                                                    )?.toLowerCase()}
                                                </Text>
                                            </PlainButton>
                                        )}
                                    </For>
                                </div>
                            )}
                        </For>
                    </Show>
                    <Show when={props.session.effortOptions().length > 1}>
                        <div class={styles.effort}>
                            <Text
                                as="div"
                                inherit
                                class={styles['effort-head']}
                            >
                                effort
                            </Text>
                            <SegmentedToggle
                                options={props.session
                                    .effortOptions()
                                    .map(o => ({
                                        id: o.value,
                                        label: o.label.toLowerCase(),
                                    }))}
                                value={props.session.effortValue()}
                                onChange={props.session.switchEffort}
                            />
                        </div>
                    </Show>
                    <Show when={props.session.provider() === 'opencode'}>
                        <OpencodeProviderManager
                            class={styles.manager}
                            onClose={props.onClose}
                        />
                    </Show>
                </div>
            </div>
        </div>
    )
}

export default ChatModelPicker
