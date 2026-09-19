import type { Component, JSX } from 'solid-js'
import { For, Show } from 'solid-js'
import styles from './StatTiles.module.css'

export type StatTile = {
    label: string
    value: string
    delta?: string
    /** Value color: plain fg by default; 'accent' for the standout metric, 'faint' for a
     *  near-empty one — per bases-stat.card.html's four tiles. */
    tone?: 'accent' | 'faint'
    /** Per-tile override for the value element's inline style (HeatmapView's streak cards
     *  render at a smaller 22px than StatView's default --fs-display). */
    valueStyle?: JSX.CSSProperties
}

export type StatTilesProps = {
    tiles: StatTile[]
    class?: string
}

/**
 * The plain "stat tile" grid — a big number, a muted label, a faint delta, no card border or
 * background (bases-stat.card.html) — shared by StatView's aggregate summary and HeatmapView's
 * streak stats (entries / current streak / longest streak). Extracted out of the old
 * bases/Charts.module.css, which both views imported directly for these same classes.
 */
const StatTiles: Component<StatTilesProps> = props => {
    return (
        <div class={`${styles.statgrid} ${props.class ?? ''}`}>
            <For each={props.tiles}>
                {tile => (
                    <div class={styles.statTile}>
                        <div
                            class={`${styles.statValue} ${tile.tone ? styles[tile.tone] : ''}`}
                            style={tile.valueStyle}
                        >
                            {tile.value}
                        </div>
                        <div class={styles.statLabel}>{tile.label}</div>
                        <Show when={tile.delta}>
                            <div class={styles.statDelta}>{tile.delta}</div>
                        </Show>
                    </div>
                )}
            </For>
        </div>
    )
}

export default StatTiles
