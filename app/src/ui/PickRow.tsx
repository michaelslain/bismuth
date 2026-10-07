// app/src/ui/PickRow.tsx
// The `▸`-marker pick row: ONE choice out of a list, the current one marked. Built three times
// (chat/ChatModelPicker's connector + model rows, chat/ChatPresetList's preset row), each with its
// own `.mark` slot and its own hanging indent. This is the one copy: a fixed two-character mark
// slot, so labels align whether or not the `▸` is present; the label, which WRAPS under itself
// rather than under the marker; and an optional right-aligned detail (a price badge, a span).
//
// Distinct from OptionRow, which needs an icon and is a whole-row modal choice: a PickRow is a
// lighter row for a popover list where "which one is current" is the only decoration.
import { Show, type Component } from 'solid-js'
import PlainButton from './PlainButton'
import Text from './Text'
import styles from './PickRow.module.css'

export type PickRowProps = {
    /** This is the current choice: the `▸` shows, the label takes `--fg`, `aria-current` is set. */
    marked?: boolean
    label: string
    /** Faint right-aligned text after the label, e.g. a price badge. */
    detail?: string
    onPick?: () => void
    /** Merged onto the root, so a caller can adjust one instance without forking the component. */
    class?: string
}

const PickRow: Component<PickRowProps> = props => (
    <PlainButton
        class={[styles.row, props.marked ? styles.marked : '', props.class ?? '']
            .filter(Boolean)
            .join(' ')}
        aria-current={props.marked || undefined}
        data-testid="pick-row"
        onClick={() => props.onPick?.()}
    >
        <Text as="span" inherit class={styles.mark} aria-hidden="true">
            {props.marked ? '▸' : ''}
        </Text>
        <Text as="span" inherit class={styles.label}>
            {props.label}
        </Text>
        <Show when={props.detail}>
            {d => (
                <Text as="span" inherit class={styles.detail}>
                    {d()}
                </Text>
            )}
        </Show>
    </PlainButton>
)

export default PickRow
export { PickRow }
