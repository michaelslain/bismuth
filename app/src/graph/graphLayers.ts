// app/src/graph/graphLayers.ts
// The graph's transient per-window display choices — [clusters] (GraphConfig.showLodMasses),
// [gradient] (GraphAtmosphere's bloom + vignette) and the 2D/3D dimension. Module-level signals so
// the full-pane graph and the sidebar mini graph share one value, seeded from localStorage so they
// survive a reload WITHOUT writing .settings (toggling the dimension once rewrote settings.yaml
// canonically, which reloaded an open settings buffer and scrolled it to the top).
import { createSignal } from 'solid-js'
import { readCache, writeCache } from '../viewCache'

export const CLUSTERS_KEY = 'bismuth:graph:clusters'
export const GRADIENT_KEY = 'bismuth:graph:gradient'
export const VIEW_MODE_KEY = 'bismuth:graph:viewMode'

/** On unless the stored value is exactly `false` — absent, unreadable or junk all mean the default. */
export function readStoredFlag(key: string): boolean {
    return readCache<unknown>(key) !== false
}

const [graphClusters, setClustersSignal] = createSignal(readStoredFlag(CLUSTERS_KEY))
const [graphGradient, setGradientSignal] = createSignal(readStoredFlag(GRADIENT_KEY))

export { graphClusters, graphGradient }

export function setGraphClusters(on: boolean): void {
    setClustersSignal(on)
    writeCache(CLUSTERS_KEY, on)
}

export function setGraphGradient(on: boolean): void {
    setGradientSignal(on)
    writeCache(GRADIENT_KEY, on)
}

export type GraphViewMode = '2d' | '3d'

/** 2D unless the stored value is exactly '3d' — the LOD field (aggregate cluster entities,
 *  cursor-anchored zoom) ships for 2D; 3D keeps its non-LOD orbit behaviour one toggle away. */
export function readStoredViewMode(): GraphViewMode {
    return readCache<unknown>(VIEW_MODE_KEY) === '3d' ? '3d' : '2d'
}

const [graphViewMode, setViewModeSignal] = createSignal<GraphViewMode>(
    readStoredViewMode(),
)

export { graphViewMode }

export function setGraphViewMode(m: GraphViewMode): void {
    setViewModeSignal(m)
    writeCache(VIEW_MODE_KEY, m)
}
