import type { Component, JSX } from 'solid-js'
import { For, Show, createSignal } from 'solid-js'
import type { Bin } from '../../../core/src/dates'
import Tex from '../ui/Tex'
import SparklineChart from './SparklineChart'
import { hoverPeriodText } from './sparkline'
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
     *  metric has no date axis to split by. Replaced by that bin's own value while a
     *  sparkline glyph is hovered. */
    period?: string
    /** A 12-bin sparkline (SparklineChart.tsx), omitted alongside `period` for the same reason.
     *  A plain glyph string still renders (non-interactively, no caption/hover) for any
     *  caller with no per-bin keys/labels to hand over. */
    spark?:
        | string
        | {
              values: (number | null)[]
              keys: string[]
              labels: string[]
              bin: Bin
          }
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
                {tile => {
                    const [hover, setHover] = createSignal<string | undefined>(undefined)
                    const periodText = () => hover() ?? tile.period
                    const onHover = (bucket: string | null) => {
                        if (bucket === null || typeof tile.spark !== 'object') {
                            setHover(undefined)
                            return
                        }
                        const i = tile.spark.keys.indexOf(bucket)
                        if (i < 0) {
                            setHover(undefined)
                            return
                        }
                        setHover(
                            hoverPeriodText(tile.spark.bin, tile.spark.labels[i], tile.spark.values[i]),
                        )
                    }
                    return (
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
                            <Show when={periodText()}>
                                <div class={styles.statPeriod}>{periodText()}</div>
                            </Show>
                            <Show when={tile.spark}>
                                <Show
                                    when={typeof tile.spark === 'object' ? tile.spark : undefined}
                                    fallback={
                                        <div class={styles.statSpark}>
                                            {typeof tile.spark === 'string' ? tile.spark : ''}
                                        </div>
                                    }
                                >
                                    {spark => (
                                        <SparklineChart
                                            values={spark().values}
                                            keys={spark().keys}
                                            labels={spark().labels}
                                            bin={spark().bin}
                                            onHover={onHover}
                                        />
                                    )}
                                </Show>
                            </Show>
                            <Show
                                when={tile.error}
                                fallback={
                                    <Show when={tile.tex}>
                                        <Tex
                                            tex={tile.tex ? `\\displaystyle ${tile.tex}` : ''}
                                            class={styles.statTex}
                                        />
                                    </Show>
                                }
                            >
                                <div class={styles.statError}>cannot read: {tile.error}</div>
                            </Show>
                        </div>
                    )
                }}
            </For>
        </div>
    )
}

export default StatTiles
