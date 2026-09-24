import { splitProps, type Component, type JSX } from 'solid-js'

// SEAM STUB (toolbar-iconbar plan, pre-wave). The props type below is final; the body is a
// pass-through that plan Task 1 replaces with the real bar (context, layout, band chrome).
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
    /** Glyph px for every IconButton inside. Default toolbarIconSize(). Stories pass it; app code never does. */
    iconSize?: number
    class?: string
} & Omit<
    JSX.HTMLAttributes<HTMLDivElement>,
    'children' | 'class' | 'role' | 'aria-label'
>

const IconBar: Component<IconBarProps> = props => {
    const [local, rest] = splitProps(props, [
        'children',
        'label',
        'layout',
        'band',
        'iconSize',
        'class',
    ])
    return (
        <div role="toolbar" aria-label={local.label} class={local.class} {...rest}>
            {local.children}
        </div>
    )
}

export default IconBar
