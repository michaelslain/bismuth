import type { Component, JSX } from 'solid-js'
import { For, Show } from 'solid-js'
import Tex from '../ui/Tex'
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
    /** StatView's period-split line, e.g. `3 this week // 1 last week`. Omitted when the
     *  metric has no date axis to split by. */
    period?: string
    /** A 12-bin sparkline (sparkline.ts), omitted alongside `period` for the same reason. */
    spark?: string
    /** The metric's expression, pre-rendered to LaTeX (no delimiters) for `ui/Tex`. */
    tex?: string
    /** A parse/evaluation failure message — replaces `tex` as `cannot read: <error>`. */
    error?: string
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
                        <Show when={tile.period}>
                            <div class={styles.statPeriod}>{tile.period}</div>
                        </Show>
                        <Show when={tile.spark}>
                            <div class={styles.statSpark}>{tile.spark}</div>
                        </Show>
                        <Show
                            when={tile.error}
                            fallback={
                                <Show when={tile.tex}>
                                    <Tex tex={tile.tex ?? ''} class={styles.statTex} />
                                </Show>
                            }
                        >
                            <div class={styles.statError}>cannot read: {tile.error}</div>
                        </Show>
                    </div>
                )}
            </For>
        </div>
    )
}

export default StatTiles
