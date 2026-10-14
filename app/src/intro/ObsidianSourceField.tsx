// The intro's Obsidian slide control: a choice between a new vault and converting an Obsidian one
// (ui/SegmentedToggle). Picking `from obsidian` shows the path of the vault to convert, typed or
// picked with the native folder dialog (ui/PathField), and under it where the converted vault
// opens. With a path set, the last slide's button converts and opens that copy.
import { Show, type Component } from 'solid-js'
import PathField from '../ui/PathField'
import SegmentedToggle from '../ui/SegmentedToggle'
import Text from '../ui/Text'
import { convertedVaultPath } from './introSlides'
import styles from './ObsidianSourceField.module.css'

export type VaultStart = 'new' | 'obsidian'

export type ObsidianSourceFieldProps = {
    start: VaultStart
    onStartChange: (start: VaultStart) => void
    value: string
    onInput: (value: string) => void
    /** Open the folder picker; the caller feeds the picked path back through `value`. */
    onBrowse: () => void
    class?: string
}

const ObsidianSourceField: Component<ObsidianSourceFieldProps> = props => (
    <div class={[styles.root, props.class ?? ''].filter(Boolean).join(' ')}>
        <SegmentedToggle
            options={[
                { id: 'new' as const, label: 'new vault' },
                { id: 'obsidian' as const, label: 'from obsidian' },
            ]}
            value={props.start}
            onChange={props.onStartChange}
        />
        <Show when={props.start === 'obsidian'}>
            <div class={styles.source}>
                <PathField
                    value={props.value}
                    onInput={props.onInput}
                    onBrowse={props.onBrowse}
                    placeholder="your obsidian vault"
                    label="Obsidian vault to convert"
                />
                <Text size="ui" tone="muted" class={styles.target}>
                    {convertedVaultPath(props.value)
                        ? `opens as ${convertedVaultPath(props.value)}`
                        : 'pick the vault to convert'}
                </Text>
            </div>
        </Show>
    </div>
)

export default ObsidianSourceField
