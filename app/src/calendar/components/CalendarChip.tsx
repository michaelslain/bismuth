import { splitProps, type Component, type JSX } from 'solid-js'
import { isActivateKey, isMenuKey } from '../../ui/widgetKeys'
import styles from './CalendarChip.module.css'

export type CalendarChipProps = {
    /** Accessible name — the chip is a role=button, so this is what a screen reader announces. */
    label: string
    /** Click, or Enter/Space while the chip itself is focused. */
    onOpen: () => void
    /** Right-click, or Shift+F10 / the ContextMenu key: where to anchor the chip's menu. */
    onMenu?: (x: number, y: number) => void
    /** Replaces the default Enter/Space/menu-key handling (TaskChip's Space toggles, not opens). */
    onKeyDown?: (e: KeyboardEvent) => void
    children?: JSX.Element
} & Omit<
    JSX.HTMLAttributes<HTMLDivElement>,
    'onClick' | 'onKeyDown' | 'onContextMenu' | 'role' | 'tabindex' | 'aria-label' | 'children'
>

/**
 * The one shell for a calendar chip: a focusable `role="button"` that opens on click / Enter /
 * Space and asks for its menu on right-click / Shift+F10. It claims its own events, so the day
 * cell it sits in (which opens a composer on click) never sees them. A key that landed on a
 * control INSIDE the chip (the link button) is that control's, not the chip's.
 */
const CalendarChip: Component<CalendarChipProps> = props => {
    const [own, rest] = splitProps(props, [
        'label',
        'onOpen',
        'onMenu',
        'onKeyDown',
        'children',
        'class',
        'ref',
    ])
    let el: HTMLDivElement | undefined
    const menuAtBox = () => {
        const r = el!.getBoundingClientRect()
        own.onMenu?.(r.left, r.bottom)
    }
    return (
        <div
            {...rest}
            ref={r => {
                el = r
                const fwd = own.ref as ((e: HTMLDivElement) => void) | undefined
                fwd?.(r)
            }}
            class={`${styles.chip} ${own.class ?? ''}`.trim()}
            role="button"
            tabindex={0}
            aria-label={own.label}
            onClick={e => {
                e.stopPropagation()
                own.onOpen()
            }}
            onContextMenu={e => {
                if (!own.onMenu) return
                e.preventDefault()
                e.stopPropagation()
                own.onMenu(e.clientX, e.clientY)
            }}
            onKeyDown={e => {
                if (own.onKeyDown) return own.onKeyDown(e)
                if (e.target !== e.currentTarget) return
                if (isActivateKey(e)) {
                    e.preventDefault()
                    e.stopPropagation()
                    own.onOpen()
                } else if (own.onMenu && isMenuKey(e)) {
                    e.preventDefault()
                    e.stopPropagation()
                    menuAtBox()
                }
            }}
        >
            {own.children}
        </div>
    )
}

export default CalendarChip
