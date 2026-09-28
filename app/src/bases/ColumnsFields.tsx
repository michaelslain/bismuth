import { Index, type Component } from 'solid-js'
import ToggleList from '../ui/ToggleList'
import ToggleRow from '../ui/ToggleRow'
import SettingsHint from '../ui/SettingsHint'
import { columnLabel } from './columnLabel'
import type { BaseConfig } from '../../../core/src/bases/types'

export type ColumnsFieldsProps = {
    columns: { col: string; visible: boolean }[]
    /** Labels come from the base's declared properties. */
    config: BaseConfig
    onToggle: (col: string) => void
}

/** A record view's column visibility: one toggle per column, the last visible one locked. */
const ColumnsFields: Component<ColumnsFieldsProps> = props => {
    const visibleCount = () => props.columns.filter(c => c.visible).length
    return (
        <>
            <SettingsHint>
                toggle to show or hide. drag the column headers in the table to
                reorder.
            </SettingsHint>
            <ToggleList>
                {/* <Index>: a toggle replaces the row object, and <For> would remount the
                    focused row and drop focus to <body>. */}
                <Index each={props.columns}>
                    {item => {
                        const locked = () =>
                            item().visible && visibleCount() <= 1
                        return (
                            <ToggleRow
                                label={columnLabel(item().col, props.config)}
                                checked={item().visible}
                                onToggle={() => props.onToggle(item().col)}
                                muted={!item().visible}
                                locked={locked()}
                                title={
                                    locked()
                                        ? 'at least one column must stay visible'
                                        : undefined
                                }
                            />
                        )
                    }}
                </Index>
            </ToggleList>
        </>
    )
}

export default ColumnsFields
