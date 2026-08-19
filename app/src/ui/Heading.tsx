import type { Component, JSX } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import styles from './Heading.module.css'
import './ui.css'

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6

const TAG: Record<HeadingLevel, 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'> = {
    1: 'h1',
    2: 'h2',
    3: 'h3',
    4: 'h4',
    5: 'h5',
    6: 'h6',
}

export type HeadingProps = {
    /** h1..h6 — picks both the rendered tag and the size/weight step off the app's one
     *  canonical heading ramp (BlockEditor.module.css .block-rich--h1..h6, editor/livePreview.ts
     *  .cm-h1..h6 — see Heading.module.css). level={2} is the default, the common
     *  panel/section-title size. */
    level?: HeadingLevel
    class?: string
    children?: JSX.Element
}

function headingClass(props: HeadingProps): string {
    const level = props.level ?? 2
    return [styles.heading, styles[`heading--${TAG[level]}`], props.class]
        .filter(Boolean)
        .join(' ')
}

/**
 * Section-title primitive. Takes `level` and picks the tag from it — never ship
 * `Heading1`..`Heading6` as separate files; the level is a prop. Pages should never write a
 * raw `<h1>`..`<h6>` — this is what those become.
 */
const Heading: Component<HeadingProps> = props => {
    const level = () => props.level ?? 2
    return (
        <Dynamic component={TAG[level()]} class={headingClass(props)}>
            {props.children}
        </Dynamic>
    )
}

export default Heading
