import type { Component } from 'solid-js'
import { For } from 'solid-js'
import StatTile, { type StatTileProps } from './StatTile'
import styles from './StatTiles.module.css'

export type StatTilesProps = {
    tiles: StatTileProps[]
    class?: string
}

/**
 * The plain "stat tile" grid (bases-stat.card.html) — one `StatTile` per entry, no card border
 * or background — shared by StatView's aggregate summary and any caller with a row of value/label
 * tiles. Each tile owns its own hover state, so the grid is only layout.
 */
const StatTiles: Component<StatTilesProps> = props => {
    return (
        <div class={`${styles.statgrid} ${props.class ?? ''}`}>
            <For each={props.tiles}>{tile => <StatTile {...tile} />}</For>
        </div>
    )
}

export default StatTiles
