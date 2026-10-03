import { splitProps, type Component, type JSX } from 'solid-js'
import { Dynamic } from 'solid-js/web'
import styles from './Heading.module.css'

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6

const TAG: Record<HeadingLevel, 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'> = {
    1: 'h1',
    2: 'h2',
    3: 'h3',
    4: 'h4',
    5: 'h5',
    6: 'h6',
}

export type HeadingSize = 'hero' | 'hero-xl'
export type HeadingRegister = 'chrome' | 'prose'

export type HeadingProps = {
    /** h1..h6 — picks both the rendered tag and the size/weight step off the app's one
     *  canonical heading ramp (editor/livePreview.ts's .cm-h1..h6 — see Heading.module.css).
     *  level={2} is the default, the common panel/section-title size. */
    level?: HeadingLevel
    /** Display step overriding the level's size: 'hero' = --fs-hero (40px), 'hero-xl' =
     *  --fs-hero-xl (48px, steps down to --fs-hero below 980px). Both: --fw-regular, line-height
     *  1.02, letter-spacing 0, text-wrap: balance. Omit for the level's own ramp step. */
    size?: HeadingSize
    /** 'chrome' (default) emits nothing; 'prose' adds font-family: var(--prose-font). Mirrors
     *  Text. */
    register?: HeadingRegister
    class?: string
    children?: JSX.Element
} & Omit<JSX.HTMLAttributes<HTMLHeadingElement>, 'class' | 'children'>

function headingClass(props: HeadingProps): string {
    const level = props.level ?? 2
    return [
        styles.heading,
        styles[`heading--${TAG[level]}`],
        props.size ? styles[`heading--${props.size}`] : '',
        props.register === 'prose' ? styles['heading--prose'] : '',
        props.class,
    ]
        .filter(Boolean)
        .join(' ')
}

/**
 * Section-title primitive. Takes `level` and picks the tag from it — never ship
 * `Heading1`..`Heading6` as separate files; the level is a prop. Pages should never write a
 * raw `<h1>`..`<h6>` — this is what those become. Every other HTML attribute and `ref` pass
 * through untouched onto the rendered element.
 */
const Heading: Component<HeadingProps> = props => {
    const [local, rest] = splitProps(props, [
        'level',
        'size',
        'register',
        'class',
        'children',
    ])
    return (
        <Dynamic component={TAG[local.level ?? 2]} class={headingClass(props)} {...rest}>
            {local.children}
        </Dynamic>
    )
}

export default Heading
