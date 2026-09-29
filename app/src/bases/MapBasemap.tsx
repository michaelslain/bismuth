import { For, createMemo, type Component } from 'solid-js'
import {
    LANDMASSES,
    graticuleFor,
    landPathsFor,
    type Size,
    type XY,
} from './mapCoords'
import styles from './MapBasemap.module.css'

export type MapBasemapProps = {
    /** The map element's pixel size. */
    size: Size
    /** World-pixel coords of the view centre at `zoom` (`project(center, zoom)`). */
    centerWorld: XY
    zoom: number
    class?: string
}

/** The offline vector basemap: sea, a coarse graticule and six continent outlines, drawn in
 *  screen space from the same projection the pins use so both pan and zoom together. Owns no
 *  state and takes no input — it is a picture of (size, centre, zoom). */
const MapBasemap: Component<MapBasemapProps> = props => {
    const landPaths = createMemo(() =>
        landPathsFor(LANDMASSES, props.size, props.centerWorld, props.zoom),
    )
    const graticule = createMemo(() =>
        graticuleFor(props.size, props.centerWorld, props.zoom),
    )
    return (
        <svg
            class={`${styles.mapVector} ${props.class ?? ''}`.trim()}
            width={props.size.w}
            height={props.size.h}
        >
            <rect
                class={styles.mapSea}
                x="0"
                y="0"
                width={props.size.w}
                height={props.size.h}
            />
            <g>
                <For each={graticule()}>
                    {l => (
                        <line
                            class={l.bold ? styles.mapGridBold : styles.mapGrid}
                            x1={l.x1}
                            y1={l.y1}
                            x2={l.x2}
                            y2={l.y2}
                        />
                    )}
                </For>
            </g>
            <g>
                <For each={landPaths()}>
                    {d => <path class={styles.mapLand} d={d} />}
                </For>
            </g>
        </svg>
    )
}

export default MapBasemap
