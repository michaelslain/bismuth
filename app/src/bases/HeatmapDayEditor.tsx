// A small numeric field anchored over a clicked heatmap square — HeatmapView's only editable
// write surface. Composes ui/InlineTextInput rather than reinventing the confirm/dismiss/blur
// contract: Enter or blur commits (InlineTextInput's own behaviour), Escape cancels. This
// component only hands up the committed text parsed by `parseDayValue` (a number, or a clear;
// non-numeric text cancels instead) —
// deciding what a number DOES (create/update/delete a row, or set a note property) is
// heatmapWrites.ts's job, not this component's.
import type { Component } from 'solid-js'
import InlineTextInput from '../ui/InlineTextInput'
import Text from '../ui/Text'
import { parseDayValue } from './heatmapDayParse'
import styles from './HeatmapDayEditor.module.css'

export type HeatmapDayEditorProps = {
    /** `Tue Jul 8`-style label shown above the field. */
    dateLabel: string
    /** The day's current value, prefilled — empty when the day has none yet. */
    value: number | undefined
    /** Commits (Enter or blur). `undefined` means the field was left empty — the caller decides
     *  whether that deletes an existing entry or simply does nothing. */
    onSave: (value: number | undefined) => void
    /** Escape — no write. */
    onCancel: () => void
    style?: Record<string, string>
}

const HeatmapDayEditor: Component<HeatmapDayEditorProps> = props => {
    return (
        <div class={styles.editor} style={props.style}>
            <Text as="span" inherit size="micro" tone="muted" class={styles.label}>
                {props.dateLabel}
            </Text>
            <InlineTextInput
                value={props.value !== undefined ? String(props.value) : ''}
                label={`Value for ${props.dateLabel}`}
                class={styles.input}
                onCommit={text => {
                    const parsed = parseDayValue(text)
                    // not a number: leave the stored value untouched rather than clearing it
                    if (parsed === null) props.onCancel()
                    else props.onSave(parsed)
                }}
                onCancel={() => props.onCancel()}
            />
        </div>
    )
}

export default HeatmapDayEditor
