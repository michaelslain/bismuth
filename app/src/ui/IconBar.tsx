import { splitProps, type Component, type JSX } from 'solid-js'
import { IconBarContext } from './iconBarContext'
import iconSize from './iconSize'
import styles from './IconBar.module.css'

// The unified icon-toolbar primitive (toolbar-iconbar plan). Every icon toolbar in the app — the
// sidebar row, the tab-rail action row, the mini-graph mode switcher — composes this instead of
// bespoke layout CSS, so bracket spacing, button box, glyph size and band height are identical
// everywhere. It reaches its `IconButton` children through Solid context only (never a class
// selector or `:global()`) — see iconBarContext.ts and Button.module.css's `--iconbar-*` reads.
export type IconBarProps = {
    children: JSX.Element
    /** Accessible name; the root is role="toolbar". */
    label: string
    /** 'row' (default): one flex line, var(--sp-2) between buttons.
     *  'wrap': wraps onto more lines, centred, zero row gap (the collapsed tab rail's stacked icons). */
    layout?: 'row' | 'wrap'
    /** true: a chrome band, min-height var(--h-band), 0 var(--sp-5) side padding, 1px var(--border-soft)
     *  bottom hairline. false (default): an inline group inside another bar, e.g. a ViewBar slot. */
    band?: boolean
    /** Glyph px for every IconButton inside. Default iconSize() — the app's one icon size. Stories pass it; app code never does. */
    iconSize?: number
    class?: string
} & Omit<
    JSX.HTMLAttributes<HTMLDivElement>,
    'children' | 'class' | 'role' | 'aria-label'
>

const IconBar: Component<IconBarProps> = props => {
    // `style` is destructured out (not left in `rest`) so a caller-supplied style object merges
    // with `--iconbar-glyph` instead of a later `{...rest}` spread silently replacing the whole
    // style attribute and losing it — Solid's JSX applies attributes in the order written, and a
    // plain object spread would win over the explicit `style` above it.
    const [local, rest] = splitProps(props, [
        'children',
        'label',
        'layout',
        'band',
        'iconSize',
        'class',
        'style',
    ])
    const glyph = () => local.iconSize ?? iconSize()
    const style = (): JSX.CSSProperties | string => {
        const vars = { '--iconbar-glyph': `${glyph()}px` }
        if (!local.style) return vars
        if (typeof local.style === 'string') {
            return `${local.style};--iconbar-glyph:${glyph()}px`
        }
        return { ...local.style, ...vars }
    }
    return (
        <IconBarContext.Provider value={{ iconSize: glyph }}>
            <div
                role="toolbar"
                aria-label={local.label}
                class={`${styles.bar} ${local.band ? styles.band : ''} ${local.layout === 'wrap' ? styles.wrap : ''} ${local.class ?? ''}`}
                style={style()}
                {...rest}
            >
                {local.children}
            </div>
        </IconBarContext.Provider>
    )
}

export default IconBar
