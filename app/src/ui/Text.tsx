import type { Component, JSX } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import styles from './Text.module.css'
import './ui.css'

export type TextTag = 'p' | 'span' | 'div'
export type TextSize = 'micro' | 'ui' | 'body' | 'body-lg' | 'lead'
export type TextTone = 'default' | 'muted' | 'faint'
export type TextWeight = 'regular' | 'medium' | 'bold'

export type TextProps = {
    /** Tag to render. 'p' (default) for a paragraph, 'span' for an inline run, 'div' for a
     *  block with no paragraph semantics (wrapping a label + a control, say). */
    as?: TextTag
    /** Step on the app's fixed type scale (ui/ui.css --fs-*). 'body' (13px — note prose in
     *  panels) is the default and adds no class. */
    size?: TextSize
    /** Text color: 'default' reads --fg, 'muted' --text-muted, 'faint' --faint. */
    tone?: TextTone
    /** Font weight (--fw-*). 'regular' (400) is the default and adds no class. */
    weight?: TextWeight
    /** The uppercase, tracked "section label" register (--ls-eyebrow) already hand-rolled
     *  per call site as DaemonList.module.css's .daemon-section-head and
     *  graph/Graph.module.css's .graph-card-h. Structural only — pass `size="micro"` and a
     *  `tone` alongside it; see Text.module.css for why eyebrow itself stays silent on
     *  tone/weight. */
    eyebrow?: boolean
    class?: string
    children?: JSX.Element
}

function textClass(props: TextProps): string {
    const size = props.size ?? 'body'
    const tone = props.tone ?? 'default'
    const weight = props.weight ?? 'regular'
    return [
        styles.text,
        size !== 'body' ? styles[`text--${size}`] : '',
        tone !== 'default' ? styles[`text--${tone}`] : '',
        weight !== 'regular' ? styles[`text--${weight}`] : '',
        props.eyebrow ? styles['text--eyebrow'] : '',
        props.class,
    ]
        .filter(Boolean)
        .join(' ')
}

/**
 * The body/prose text primitive. Pages should never write a raw `<p>`, `<span>`, or a `<div>`
 * standing in for one — this is what those become. Variants are props (size/tone/weight/
 * eyebrow), not separate components; see Text.module.css for where each token comes from.
 */
const Text: Component<TextProps> = props => {
    return (
        <Dynamic component={props.as ?? 'p'} class={textClass(props)}>
            {props.children}
        </Dynamic>
    )
}

export default Text
