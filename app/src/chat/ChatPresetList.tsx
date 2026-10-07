// app/src/chat/ChatPresetList.tsx
// The model dialog's "presets" section — the top of ChatModelPicker's left column, above the
// connectors, because a preset is a connector too (plus a model and an effort). Each saved preset is
// a `ui/PickRow` (the connector and model rows' own component): `▸` when it matches what the chat is
// running, its name, in a `ui/ListRow` whose revealed trailing `[x]` deletes it — --danger on hover,
// like every list row's remove `[x]`. What it holds
// (`connector // model // effort`) is the row's tooltip; picking it shows the rest, since the
// connector ▸ and the right column's model check and effort follow. A `+ save` control at the bottom turns into a name input (prefilled with a
// suggestion, selected so typing replaces it).
//
// Controlled: the list comes in as `presets` and every change goes out through onApply / onSave /
// onDelete, so ChatModelPicker owns the `.settings` write and a story owns a plain signal. The list
// rules themselves (match, save-replaces-by-name) are chatPresets.ts's.
import { createSignal, For, Show, type Component } from 'solid-js'
import styles from './ChatPresetList.module.css'
import { IconTextButton } from '../ui/IconTextButton'
import InlineTextInput from '../ui/InlineTextInput'
import PickRow from '../ui/PickRow'
import ListRow from '../ui/ListRow'
import TextButton from '../ui/TextButton'
import SectionLabel from '../ui/SectionLabel'
import {
    presetMatches,
    type ChatPreset,
    type ChatPresetCurrent,
} from './chatPresets'

export type ChatPresetListProps = {
    presets: ChatPreset[]
    /** What the chat is running now — marks the matching preset and is what `+ save` saves. */
    current: ChatPresetCurrent
    /** The save input's starting text. */
    suggestedName: string
    /** What a preset holds, for its tooltip — e.g. `claude code // opus 4.8 // high`. */
    describe: (preset: ChatPreset) => string
    onApply: (preset: ChatPreset) => void
    onSave: (name: string) => void
    onDelete: (index: number) => void
    class?: string
}

const ChatPresetList: Component<ChatPresetListProps> = props => {
    const [saving, setSaving] = createSignal(false)

    return (
        <div class={`${styles.root} ${props.class ?? ''}`}>
            <SectionLabel class={styles.head}>presets</SectionLabel>
            <For each={props.presets}>
                {(preset, i) => {
                    const current = () => presetMatches(preset, props.current)
                    return (
                        <ListRow
                            reveal
                            baseline
                            class={styles.row}
                            trailing={
                                <TextButton
                                    danger="hover"
                                    aria-label={`Delete preset ${preset.name}`}
                                    title={`Delete preset ${preset.name}`}
                                    onClick={() => props.onDelete(i())}
                                >
                                    x
                                </TextButton>
                            }
                        >
                            {/* PickRow takes no `title`; the tooltip (what the preset holds) rides
                                on this wrapper, which also gives the row its full width. */}
                            <div
                                class={styles.pick}
                                title={`${preset.name} — ${props.describe(preset)}`}
                            >
                                <PickRow
                                    marked={current()}
                                    label={preset.name}
                                    onPick={() => props.onApply(preset)}
                                />
                            </div>
                        </ListRow>
                    )
                }}
            </For>
            <div class={styles.save}>
                <Show
                    when={saving()}
                    fallback={
                        <IconTextButton
                            icon="Plus"
                            title="Save the current connector, model and effort as a preset"
                            onClick={() => setSaving(true)}
                        >
                            save
                        </IconTextButton>
                    }
                >
                    <InlineTextInput
                        class={styles.input}
                        value={props.suggestedName}
                        label="Preset name"
                        // Clicking away cancels: only Enter saves a preset, so a stray click
                        // (say, on a connector) never creates one.
                        blurCancels
                        onCommit={name => {
                            setSaving(false)
                            if (name) props.onSave(name)
                        }}
                        onCancel={() => setSaving(false)}
                    />
                </Show>
            </div>
        </div>
    )
}

export default ChatPresetList
