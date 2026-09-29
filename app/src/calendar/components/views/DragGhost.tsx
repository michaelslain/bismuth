import type { Component } from 'solid-js'
import { formatTime } from '../../dates'
import { settings } from '../../state'
import Text from '../../../ui/Text'
import { minutesToStr } from './timeGridDrag'
import styles from './DragGhost.module.css'

export type DragGhostProps = {
    /** Pixel box inside the day column (timeGridLayout's `ghostBox`). */
    top: number
    height: number
    startMin: number
    endMin: number
    /** Any CSS colour. */
    color: string
    class?: string
}

/** The translucent block that previews an event being created or moved: its time range, over
 *  the category colour (accent for a create). Pointer-transparent. */
const DragGhost: Component<DragGhostProps> = props => (
    <div
        class={`${styles.ghost} ${props.class ?? ''}`.trim()}
        data-testid="drag-ghost"
        style={{
            top: `${props.top}px`,
            height: `${props.height}px`,
            background: props.color,
        }}
    >
        <Text as="span" inherit>
            {formatTime(minutesToStr(props.startMin), settings.value.militaryTime)}
            {' — '}
            {formatTime(minutesToStr(props.endMin), settings.value.militaryTime)}
        </Text>
    </div>
)

export default DragGhost
