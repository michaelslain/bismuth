// The left gutter column that aligns a day view's header/all-day rows with TimeGrid's hour
// labels (was `.time-gutter`). Its width is the `--time-gutter-width` custom property, itself
// set from the `calendar.timeGutterWidth` setting (settingsCssVars.ts) — the module's own
// `54px` is only the CSS fallback used if that token is ever missing, not the real width. An
// empty spacer — its only job is to hold the width so the header/all-day rows above the hourly
// grid line up with the hour labels below them. Only rows stacked over a TimeGrid need it
// (AllDayRow/DayHeaderRow default to rendering it for exactly that reason); a grid with no
// TimeGrid under it — the tasks strip — has nothing to align to, and those callers pass
// `gutter={false}` to leave the column out rather than render an empty spacer.
import type { Component } from 'solid-js'
import styles from './DayGutter.module.css'

export type DayGutterProps = {
    class?: string
}

const DayGutter: Component<DayGutterProps> = props => {
    return <div class={[styles.gutter, props.class ?? ''].filter(Boolean).join(' ')} />
}

export default DayGutter
