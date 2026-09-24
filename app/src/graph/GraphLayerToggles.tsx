// The graph's two display layers as on/off bracket buttons: [clusters] (notes read as named
// community groups — zoomed-out masses in 2D, group names in 3D — vs every note drawn and named at
// every zoom) and [gradient] (the phosphor glow + vignette vs a flat
// ground). Presentational — GraphView owns the state (graph/graphLayers.ts) and passes it in.
import type { Component } from 'solid-js'
import TextButton from '../ui/TextButton'
import Text from '../ui/Text'
import styles from './GraphLayerToggles.module.css'

export type GraphLayerTogglesProps = {
    clusters: boolean
    gradient: boolean
    onClusters: (on: boolean) => void
    onGradient: (on: boolean) => void
    class?: string
}

const GraphLayerToggles: Component<GraphLayerTogglesProps> = props => (
    <Text
        as="span"
        size="inherit"
        tone="inherit"
        weight="inherit"
        class={[styles.toggles, props.class ?? ''].filter(Boolean).join(' ')}
    >
        <TextButton
            variant={props.clusters ? 'selected' : 'unselected'}
            aria-pressed={props.clusters}
            title={
                props.clusters
                    ? 'Clusters — notes read as named groups (zoomed-out masses in 2D). Click to show every note'
                    : 'Every note — drawn and named at every zoom. Click to group into clusters'
            }
            onClick={() => props.onClusters(!props.clusters)}
        >
            clusters
        </TextButton>
        <TextButton
            variant={props.gradient ? 'selected' : 'unselected'}
            aria-pressed={props.gradient}
            title={
                props.gradient
                    ? 'Gradient — the glow behind dense regions and the darkened edges. Click for a flat background'
                    : 'Flat background. Click to bring back the gradient'
            }
            onClick={() => props.onGradient(!props.gradient)}
        >
            gradient
        </TextButton>
    </Text>
)

export default GraphLayerToggles
