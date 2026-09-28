import { splitProps, type Component, type JSX } from 'solid-js'
import styles from './Band.module.css'

export type BandProps = {
    children?: JSX.Element
    class?: string
} & Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children' | 'class'>

/**
 * The chrome band: --h-band tall, --sp-5 side padding, a --rule-soft bottom hairline. The one
 * definition of that shape — `ViewBar` and a `band` `IconBar` both render through it, so a toolbar
 * and a view header stacked in one column share their edges. It owns the box only; the composer
 * owns layout via `class`. Every other attribute (role, aria-*, data-*, style) passes through.
 */
const Band: Component<BandProps> = props => {
    const [local, rest] = splitProps(props, ['children', 'class'])
    return (
        <div class={`${styles.band} ${local.class ?? ''}`} {...rest}>
            {local.children}
        </div>
    )
}

export default Band
