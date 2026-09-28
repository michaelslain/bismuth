// The left gutter column that aligns a day view's header/all-day rows with TimeGrid's hour
// labels (was `.time-gutter`). Its width is the `--time-gutter-width` custom property, itself
// set from the `calendar.timeGutterWidth` setting (settingsCssVars.ts) — the module's own
// `54px` is only the CSS fallback used if that token is ever missing, not the real width. Empty,
// it is a spacer: its only job is to hold the width so the header/all-day rows above the hourly
// grid line up with the hour labels below them. TimeGrid's own hour column COMPOSES this same
// gutter and passes the hour labels as children, so the spacer and the labelled column can never
// disagree about width. A grid with no TimeGrid under it — the tasks strip — passes
// `gutter={false}` to the rows rather than render an empty spacer.
import type { Component, JSX } from 'solid-js'
import styles from './DayGutter.module.css'

export type DayGutterProps = {
    class?: string
    /** Hour labels (TimeGrid). Omitted = the empty alignment spacer. */
    children?: JSX.Element
}

const DayGutter: Component<DayGutterProps> = props => {
    return (
        <div class={[styles.gutter, props.class ?? ''].filter(Boolean).join(' ')}>
            {props.children}
        </div>
    )
}

export default DayGutter
