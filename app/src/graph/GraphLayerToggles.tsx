// The graph's display layer as an on/off bracket button: [clusters] (notes read as named
// community groups — zoomed-out masses in 2D, group names in 3D — vs every note drawn and named at
// every zoom). Presentational — GraphView owns the state (graph/graphLayers.ts) and passes it in.
// The gradient (bloom + vignette) is no longer a button here; it is the `graph.gradient` setting.
import type { Component } from 'solid-js'
import TextButton from '../ui/TextButton'
import Text from '../ui/Text'
import styles from './GraphLayerToggles.module.css'

export type GraphLayerTogglesProps = {
    clusters: boolean
    onClusters: (on: boolean) => void
    class?: string
}

const GraphLayerToggles: Component<GraphLayerTogglesProps> = props => (
    <Text
        as="span"
        inherit
        class={[styles.toggles, props.class ?? ''].filter(Boolean).join(' ')}
    >
        <TextButton
            variant={props.clusters ? 'selected' : 'unselected'}
            aria-pressed={props.clusters}
            title={
                props.clusters
                    ? 'Clusters — notes read as named groups (zoomed-out masses in 2D). Click to show every note'
                    : 'Every note — the biggest hubs named, more names as you zoom in. Click to group into clusters'
            }
            onClick={() => props.onClusters(!props.clusters)}
        >
            clusters
        </TextButton>
    </Text>
)

export default GraphLayerToggles
