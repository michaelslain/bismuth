// app/src/graph/graphLayers.ts
// The graph's two display layers — [clusters] (GraphConfig.showLodMasses) and [gradient]
// (GraphAtmosphere's bloom + vignette). Transient per-window UI choices exactly like the 2D/3D
// toggle in GraphView.tsx: module-level signals so the full-pane graph and the sidebar mini graph
// share one value, seeded from localStorage so they survive a reload WITHOUT writing .settings
// (see settingsSchema.ts's note on why the 2D/3D dimension is not a setting either).
import { createSignal } from 'solid-js'
import { readCache, writeCache } from '../viewCache'

export const CLUSTERS_KEY = 'bismuth:graph:clusters'
export const GRADIENT_KEY = 'bismuth:graph:gradient'

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
