import { Show, splitProps, type Component, type JSX } from 'solid-js'
import PlainButton from '../ui/PlainButton'
import NoteLink from '../ui/NoteLink'
import Text from '../ui/Text'
import styles from './MapPin.module.css'

export type MapPinProps = {
    /** The row's label, shown in the chip above the glyph. */
    title: string
    /** Screen position (px) of the glyph's baseline, inside the map. */
    x: number
    y: number
    /** A pin being dragged to a new spot. */
    dragging?: boolean
    /** Click-through, while the map is armed to place a pin and the next click is the map's. */
    passThrough?: boolean
    /** Tooltip. */
    hint?: string
    /** Set when the pin cannot be edited (a map with no base file, a task line): the chip is then
     *  a NoteLink that opens this note, and the pin is not a button. */
    notePath?: string
    class?: string
} & Pick<
    JSX.ButtonHTMLAttributes<HTMLButtonElement>,
    | 'onClick'
    | 'onMouseDown'
    | 'onPointerDown'
    | 'onPointerMove'
    | 'onPointerUp'
    | 'onContextMenu'
    | 'onKeyDown'
>

/** One map pin: an accent `@` glyph under a label chip. Pure presentation — MapView owns the
 *  drag, click and menu behaviour and passes the handlers in. */
const MapPin: Component<MapPinProps> = props => {
    const [local, handlers] = splitProps(props, [
        'title',
        'x',
        'y',
        'dragging',
        'passThrough',
        'hint',
        'notePath',
        'class',
    ])
    const cls = () =>
        [
            styles.mapPin,
            local.dragging && styles.mapPinDragging,
            local.passThrough && styles.mapPinPassThrough,
            local.class,
        ]
            .filter(Boolean)
            .join(' ')
    const pos = () => ({ left: `${local.x}px`, top: `${local.y}px` })
    const glyph = (
        // Accent glyph marker — no drawn teardrop shape, per bases-map.card.html ("@ a record").
        <Text
            as="span"
            size="inherit"
            tone="inherit"
            weight="bold"
            class={styles.mapPinGlyph}
            aria-hidden="true"
        >
            @
        </Text>
    )
    return (
        <Show
            when={local.notePath === undefined}
            fallback={
                <div
                    class={cls()}
                    style={pos()}
                    title={local.hint}
                    {...(handlers as JSX.HTMLAttributes<HTMLDivElement>)}
                >
                    <NoteLink path={local.notePath!} class={styles.mapPinChip}>
                        {local.title}
                    </NoteLink>
                    {glyph}
                </div>
            }
        >
            <PlainButton
                class={cls()}
                style={pos()}
                title={local.hint}
                {...handlers}
            >
                <Text
                    as="span"
                    size="inherit"
                    tone="default"
                    weight="inherit"
                    class={styles.mapPinChip}
                >
                    {local.title}
                </Text>
                {glyph}
            </PlainButton>
        </Show>
    )
}

export default MapPin
