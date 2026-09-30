import type { Component } from 'solid-js'
import { formatTime } from '../../dates'
import { settings } from '../../state'
import Text from '../../../ui/Text'
import { minutesToStr } from './timeGridDrag'
import { categoryBands } from '../../categoryColor'
import styles from './DragGhost.module.css'

export type DragGhostProps = {
    /** Pixel box inside the day column (timeGridLayout's `ghostBox`). */
    top: number
    height: number
    startMin: number
    endMin: number
    /** The previewed event's resolved category colours, in order (`eventCategoryColors`): the ghost
     *  draws the same frame + wash as the event chip. Empty = a create, drawn in the accent. */
    colors: string[]
    class?: string
}

/** The block that previews an event being created or moved: its time range, in the same frame +
 *  wash as the event chip (accent for a create), so a two-category move shows its split frame
 *  rather than a half-and-half fill. Pointer-transparent. */
const DragGhost: Component<DragGhostProps> = props => {
    const colors = () => (props.colors.length ? props.colors : ['var(--accent)'])
    return (
        <div
            class={`${styles.ghost} ${props.class ?? ''}`.trim()}
            data-testid="drag-ghost"
            style={{
                top: `${props.top}px`,
                height: `${props.height}px`,
                // Custom properties, not inline `background`/`border` (which would outrank the module).
                '--ghost-c': colors()[0],
                '--ghost-frame': categoryBands(colors(), 90)!,
            }}
        >
            <Text as="span" inherit>
                {formatTime(minutesToStr(props.startMin), settings.value.militaryTime)}
                {' — '}
                {formatTime(minutesToStr(props.endMin), settings.value.militaryTime)}
            </Text>
        </div>
    )
}

export default DragGhost
