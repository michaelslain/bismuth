import type { Component, JSX } from 'solid-js'
import { Show, createSignal } from 'solid-js'
import type { Bin } from '../../../core/src/dates'
import Text from '../ui/Text'
import Tex from '../ui/Tex'
import SparklineChart from './SparklineChart'
import { hoverPeriodText } from './sparkline'
import styles from './StatTile.module.css'

export type StatTileProps = {
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
    class?: string
}

/**
 * One stat tile — a big number, a muted label, a faint delta, then (for a declared metric) the
 * period split, the hoverable sparkline and the KaTeX definition. Owns its own hover state: a
 * sparkline glyph swaps the period line for that bin's own value (`hoverPeriodText`), and
 * leaving it restores the default line. No card border or background (bases-stat.card.html).
 */
const StatTile: Component<StatTileProps> = props => {
    const [hover, setHover] = createSignal<string | undefined>(undefined)
    const periodText = () => hover() ?? props.period
    const onHover = (bucket: string | null) => {
        const spark = props.spark
        if (bucket === null || typeof spark !== 'object') {
            setHover(undefined)
            return
        }
        const i = spark.keys.indexOf(bucket)
        if (i < 0) {
            setHover(undefined)
            return
        }
        setHover(hoverPeriodText(spark.bin, spark.labels[i], spark.values[i]))
    }
    const sparkObject = () => (typeof props.spark === 'object' ? props.spark : undefined)
    return (
        <div class={`${styles.statTile} ${props.class ?? ''}`}>
            <Text
                as="div"
                inherit
                class={styles.statValue}
                classList={{
                    [styles.accent]: props.tone === 'accent',
                    [styles.faint]: props.tone === 'faint',
                }}
                style={props.valueStyle}
            >
                {props.value}
            </Text>
            <Text as="div" inherit class={styles.statLabel}>
                {props.label}
            </Text>
            <Show when={props.delta}>
                <Text as="div" inherit class={styles.statDelta}>
                    {props.delta}
                </Text>
            </Show>
            <Show when={periodText()}>
                <Text as="div" inherit class={styles.statPeriod}>
                    {periodText()}
                </Text>
            </Show>
            <Show when={props.spark}>
                <Show
                    when={sparkObject()}
                    fallback={
                        <Text as="div" inherit class={styles.statSpark}>
                            {typeof props.spark === 'string' ? props.spark : ''}
                        </Text>
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
                when={props.error}
                fallback={
                    <Show when={props.tex}>
                        <Tex
                            tex={props.tex ? `\\displaystyle ${props.tex}` : ''}
                            class={styles.statTex}
                        />
                    </Show>
                }
            >
                <Text as="div" inherit class={styles.statError}>
                    cannot read: {props.error}
                </Text>
            </Show>
        </div>
    )
}

export default StatTile
