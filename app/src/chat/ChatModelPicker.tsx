// app/src/chat/ChatModelPicker.tsx
// The ONE model dialog (replaces the provider ▸ / model ▸ / effort ▸ context-menu submenus AND the
// separate `[N providers]` pill): a left column of the saved presets (ChatPresetList — `chat.presets`
// in .settings, each a connector + model + effort) above the connectors (claude code, codex,
// opencode, …), and a right column holding the current connector's models, its effort levels, and
// — for opencode only — the provider manager (OpencodeProviderManager). Picking a preset moves the
// connector ▸ too, and the right column then shows the model and effort it set. Every pick — connector, model, effort —
// applies at once and keeps the dialog open; only `[x]`, Esc or the backdrop close it.
//
// A FormModal: it portals itself over the scrim, owns Esc / backdrop dismiss, the focus trap and
// the `model // <connector>` header. There is no footer — nothing to confirm, a pick applies at once.
// The columns have a fixed height so switching connector never resizes the dialog; the right column
// scrolls on its own and the connector column stays put.
import { For, Show, type Component } from 'solid-js'
import styles from './ChatModelPicker.module.css'
import type { ChatControlsView } from './ChatControls'
import type { ChatModelOption } from './chatSession'
import FormModal from '../ui/FormModal'
import ModalBody from '../ui/ModalBody'
import ModalHeader from '../ui/ModalHeader'
import PlainButton from '../ui/PlainButton'
import SegmentedToggle from '../ui/SegmentedToggle'
import SectionLabel from '../ui/SectionLabel'
import Text from '../ui/Text'
import OpencodeProviderManager from './OpencodeProviderManager'
import ChatPresetList from './ChatPresetList'
import { CHAT_PROVIDER_OPTIONS, modelPriceBadge } from './chatProvider'
import { groupModels } from './modelPickerGroups'
import { modelLabelFor } from './chatModelResolution'
import { modelWord } from './modelWord'
import {
    deletePreset,
    savePreset,
    suggestPresetName,
    type ChatPreset,
} from './chatPresets'
import { settings, setSettings } from '../settings'

export type ChatModelPickerProps = {
    session: ChatControlsView
    onClose: () => void
    class?: string
}

const ChatModelPicker: Component<ChatModelPickerProps> = props => {
    // The header subtitle: the connector whose models the right column is showing.
    const connector = () =>
        CHAT_PROVIDER_OPTIONS.find(
            o => o.value === props.session.provider(),
        )?.label.toLowerCase()

    const groups = () =>
        groupModels(props.session.models(), props.session.provider())
    const currentModel = () => props.session.displayModelValue()

    const pickModel = (m: ChatModelOption) => props.session.switchModel(m.value)

    // ── presets (`chat.presets` in .settings) ──
    const providerLabel = (id: string) =>
        CHAT_PROVIDER_OPTIONS.find(o => o.value === id)?.label.toLowerCase() ??
        id
    // A preset on the current connector can use its reported label; another connector's models are
    // not loaded, so its raw id is shown as-is (modelWord only lowercases an id).
    const presetModelWord = (provider: string, model: string) =>
        model
            ? modelWord(
                  provider === props.session.provider()
                      ? modelLabelFor(model, props.session.models())
                      : model,
              )
            : 'default model'
    const describe = (p: ChatPreset) =>
        [providerLabel(p.provider), presetModelWord(p.provider, p.model), p.effort]
            .filter(Boolean)
            .join(' // ')
    // Effort only counts when the model offers a choice — the same rule that shows the effort row.
    const currentEffort = () =>
        props.session.effortOptions().length > 1
            ? props.session.effortValue()
            : ''
    const current = () => ({
        provider: props.session.provider(),
        model: currentModel(),
        effort: currentEffort(),
    })
    const savePresetNamed = (name: string) =>
        setSettings(
            'chat',
            'presets',
            savePreset(settings.chat.presets, { name, ...current() }),
        )

    return (
        <FormModal
            onClose={props.onClose}
            label="model"
            width={640}
            class={props.class}
        >
            <ModalHeader
                title="model"
                subtitle={connector()}
                onClose={props.onClose}
            />
            <ModalBody class={styles.body}>
                <div class={styles.connectors}>
                    <ChatPresetList
                        presets={settings.chat.presets}
                        current={current()}
                        suggestedName={suggestPresetName(
                            presetModelWord(
                                props.session.provider(),
                                currentModel(),
                            ),
                            currentEffort(),
                        )}
                        {...{ describe }}
                        onApply={props.session.applyPreset}
                        onSave={savePresetNamed}
                        onDelete={i =>
                            setSettings(
                                'chat',
                                'presets',
                                deletePreset(settings.chat.presets, i),
                            )
                        }
                    />
                    <SectionLabel class={styles['connectors-head']}>
                        connectors
                    </SectionLabel>
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
                                        <SectionLabel
                                            class={styles['group-head']}
                                        >
                                            {g.name}
                                        </SectionLabel>
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
                                                    class={styles.mark}
                                                >
                                                    {m.value === currentModel()
                                                        ? '▸'
                                                        : ''}
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
                            <SectionLabel as="span">effort</SectionLabel>
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
            </ModalBody>
        </FormModal>
    )
}

export default ChatModelPicker
