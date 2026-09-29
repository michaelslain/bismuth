import type { Component } from 'solid-js'
import IconButton from '../ui/IconButton'
import { gestureStops } from '../ui/stopGestures'
import styles from './MapControls.module.css'

export type MapControlsProps = {
    /** Placement is armed: the pin button reads `Cancel placing pin` and is selected. */
    armed: boolean
    /** Why `Add pin` cannot create a row (no base file, computed coordinates …), or null. Shown
     *  as its title and disables the button — except while armed, when it stays a cancel. */
    blockedReason: string | null
    onZoomIn: () => void
    onZoomOut: () => void
    onReset: () => void
    onFit: () => void
    onAddPin: () => void
    class?: string
}

/** The floating map chrome: zoom in/out, reset and fit-to-pins top-right, `Add pin` top-left.
 *  Both clusters sit INSIDE the pannable map element, so each claims the pointer gestures —
 *  otherwise a press would start a pan and, while armed, its click would drop a pin under the
 *  button that was pressed. */
const MapControls: Component<MapControlsProps> = props => (
    <>
        <div
            class={`${styles.mapControls} ${props.class ?? ''}`.trim()}
            {...gestureStops}
            onContextMenu={e => e.stopPropagation()}
        >
            <IconButton icon="ZoomIn" label="Zoom in" onClick={props.onZoomIn} />
            <IconButton
                icon="ZoomOut"
                label="Zoom out"
                onClick={props.onZoomOut}
            />
            <IconButton
                icon="RotateCcw"
                label="Reset view"
                onClick={props.onReset}
            />
            <IconButton icon="Map" label="Fit to pins" onClick={props.onFit} />
        </div>
        <div
            class={styles.mapPlacement}
            {...gestureStops}
            onContextMenu={e => e.stopPropagation()}
        >
            <IconButton
                icon="Pin"
                label={props.armed ? 'Cancel placing pin' : 'Add pin'}
                variant={props.armed ? 'selected' : 'normal'}
                aria-pressed={props.armed}
                disabled={!props.armed && !!props.blockedReason}
                title={
                    props.armed
                        ? 'Cancel placing pin (esc)'
                        : (props.blockedReason ??
                          'Add pin — then click the map where it goes')
                }
                data-testid="map-add-pin"
                onClick={props.onAddPin}
            />
        </div>
    </>
)

export default MapControls
