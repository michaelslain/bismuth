import { Show, type Component } from 'solid-js'
import Text from '../ui/Text'
import { plural } from '../plural'
import fpsColor from './fpsColor'
import { splitStatusPath } from './statusPath'
import styles from './GraphStatusLine.module.css'

export type GraphStatusLineProps = {
    /** What the pointer is over — a note's vault path or a node label. Omit/null: the left side
     *  is empty, but the strip and the readout stay exactly where they are. */
    hover?: string | null
    nodes: number
    edges: number
    /** The brain-mode word, e.g. `both brains`. */
    mode: string
    /** Resolution, not scale — see the zoom law in AsciiGraphRenderer. */
    zoom: number
    /** Appends `// N fps` in the traffic-light colour while set. */
    fps?: number | null
    class?: string
}

/**
 * The graph's floor: ONE terminal-style status line — a --rule-soft hairline on top, the hovered
 * path on the left, the `//`-joined readout on the right. Replaces the two boxed pills (a Badge
 * and a Popover) that sat there with different borders, heights and depth. The folder part of a
 * path gives way first, from its LEFT (`…PLAN 114/notes/`), so the nearest folders and the file
 * name survive a narrow pane. Click-through: nothing on it is
 * interactive, and the canvas under it still takes the pointer.
 *
 * The readout is ONE flex item (`.readout`) with the zoom/fps segments nested inline inside it:
 * a flex item's own leading/trailing whitespace is trimmed, so splitting segments into sibling
 * items silently ate the spaces around their `//` separators.
 */
const GraphStatusLine: Component<GraphStatusLineProps> = props => {
    const path = () => (props.hover ? splitStatusPath(props.hover) : null)
    return (
        <div
            class={`${styles.status}${props.class ? ` ${props.class}` : ''}`}
            data-testid="graph-status"
        >
            <Text as="span" inherit class={styles.path} data-testid="graph-status-path">
                <Show when={path()}>
                    {p => (
                        <>
                            <Show when={p().dir}>
                                <Text as="span" inherit class={styles.dir}>
                                    {/* LRM pins the trailing `/` to the right under the
                                    rtl direction that moves the ellipsis to the left. */}
                                    {`${p().dir}\u200E`}
                                </Text>
                            </Show>
                            <Text as="span" inherit class={styles.name}>
                                {p().name}
                            </Text>
                        </>
                    )}
                </Show>
            </Text>
            <Text as="span" inherit class={styles.readout} data-testid="graph-status-readout">
                {plural(props.nodes, 'node')} // {plural(props.edges, 'edge')} //{' '}
                {props.mode} // {props.zoom}%
                <Show when={props.fps != null}>
                    {' '}//{' '}
                    <Text as="span" inherit style={{ color: fpsColor(props.fps!) }}>
                        {props.fps} fps
                    </Text>
                </Show>
            </Text>
        </div>
    )
}

export default GraphStatusLine
