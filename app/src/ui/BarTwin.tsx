// app/src/ui/BarTwin.tsx — a view-bar command drawn as a worded/icon TWIN pair.
//
// The worded `IconTextButton` (`[⚡ cram]`) shows while there is room; below its tier the bare
// `IconButton` takes over, so an OFF toggle never draws icon-only brackets (DESIGN.md "### Buttons":
// icon brackets mean ON). The swap widths live ONCE: ViewBar.module.css for `early` and
// `late`, ChatControls.module.css's `@container chatrow` tier for `row`. This file only
// stamps the data hooks those rules read, and owns the one `active ? 'selected' : offVariant`
// choice so no caller writes it.
import type { Component } from 'solid-js'
import { IconTextButton } from './IconTextButton'
import { IconButton } from './IconButton'
import styles from './BarTwin.module.css'

export type BarTwinProps = {
    /** Icon shared by both halves. */
    icon: string
    /** The word on the worded half, and the bare half's accessible name. */
    label: string
    title?: string
    onClick: (e: MouseEvent) => void
    /** Which tier swaps worded -> bare: the view bar's early or late tier, or the
     *  chat row's own container tier. */
    drop: 'early' | 'late' | 'row'
    /** Absent = a one-shot command (`normal` both halves). A boolean = a toggle: on is `selected`. */
    active?: boolean
    /** The worded half's look while a toggle is off. The bare half is always `unselected` then. */
    offVariant?: 'unselected' | 'normal'
    className?: string
    'data-testid'?: string
}

const BarTwin: Component<BarTwinProps> = props => {
    const worded = () =>
        props.active === undefined
            ? 'normal'
            : props.active
              ? 'selected'
              : (props.offVariant ?? 'unselected')
    const bare = () =>
        props.active === undefined
            ? 'normal'
            : props.active
              ? 'selected'
              : 'unselected'
    return (
        <span
            class={`${styles.twin} ${props.className ?? ''}`}
            data-bar-twin={props.drop}
        >
            <IconTextButton
                icon={props.icon}
                variant={worded()}
                data-bar-twin-half="full"
                data-testid={props['data-testid']}
                title={props.title}
                onClick={props.onClick}
            >
                {props.label}
            </IconTextButton>
            <IconButton
                icon={props.icon}
                label={props.label}
                title={props.title}
                variant={bare()}
                data-bar-twin-half="icon"
                data-testid={
                    props['data-testid']
                        ? `${props['data-testid']}-icon`
                        : undefined
                }
                onClick={props.onClick}
            />
        </span>
    )
}

export default BarTwin
