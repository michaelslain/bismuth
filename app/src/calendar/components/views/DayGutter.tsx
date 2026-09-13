// The 54px left gutter column that aligns a day view's header/all-day rows with TimeGrid's
// hour labels (was `.time-gutter`). An empty spacer — its only job is to hold the width so the
// header/all-day rows above the hourly grid line up with the hour labels below them.
import type { Component } from 'solid-js'
import styles from './DayGutter.module.css'

export type DayGutterProps = {
    class?: string
}

const DayGutter: Component<DayGutterProps> = props => {
    return <div class={[styles.gutter, props.class ?? ''].filter(Boolean).join(' ')} />
}

export default DayGutter
