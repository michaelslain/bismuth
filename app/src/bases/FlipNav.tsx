// app/src/bases/FlipNav.tsx
// Under text or side by side read a page at a time: the page before, where you are, the page after.
// The page keys do the same; this is the way to flip without them.
import type { Component } from 'solid-js'
import IconButton from '../ui/IconButton'
import Label from '../ui/Label'
import { pageReadout } from './bookNav'
import styles from './FlipNav.module.css'

export type FlipNavProps = {
    /** The page shown, from 1. */
    page: number
    pages: number
    onStep: (dir: 1 | -1) => void
    class?: string
}

const FlipNav: Component<FlipNavProps> = props => (
    <div class={`${styles.nav} ${props.class ?? ''}`} data-flip-nav>
        <IconButton icon="ChevronLeft" label="previous page" disabled={props.page <= 1} onClick={() => props.onStep(-1)} />
        <Label tone="muted" class={styles.where}>{pageReadout(props.page, props.pages)}</Label>
        <IconButton icon="ChevronRight" label="next page" disabled={props.page >= props.pages} onClick={() => props.onStep(1)} />
    </div>
)

export default FlipNav
