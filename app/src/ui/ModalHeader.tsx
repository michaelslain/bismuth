// app/src/ui/ModalHeader.tsx
// The header strip every modal in the app repeats: an accent icon mark, a title, an optional
// subtitle, and a close control pushed to the trailing edge.
//
// Extracted because SIX components (the four calendar modals + bases/BaseSettings +
// bases/QueryBuilder) each hand-rolled this markup against one shared calendar/Calendar.module.css
// — the repo's own "a shared stylesheet means a missing component" smell. The duplication had
// already drifted: BaseSettings used a `<div role="button">` for close, which with no tabindex is
// not keyboard focusable at all. The close control here is a real IconButton, so it is focusable,
// labelled and styled like every other icon button in the app.
//
// `compact` centres the mark against a single-line title — three of the six needed a per-call-site
// CSS override to do that, which is now a prop.
import { Show, type Component } from 'solid-js'
import { Icon } from '../icons/Icon'
import IconButton from './IconButton'
import styles from './ModalHeader.module.css'

export type ModalHeaderProps = {
    /** Icon name from the icon registry — not a literal glyph or emoji. */
    icon: string
    title: string
    subtitle?: string
    onClose: () => void
    /** Centre the mark with the title. Use when there is no subtitle. */
    compact?: boolean
    class?: string
}

const ModalHeader: Component<ModalHeaderProps> = props => (
    <div
        class={styles['modal-head']}
        classList={{
            [styles['compact']!]: !!props.compact,
            [props.class ?? '']: !!props.class,
        }}
    >
        <div class={styles['modal-mark']}>
            <Icon value={props.icon} size={18} />
        </div>
        <div class={styles['modal-htext']}>
            <div class={styles['modal-title']}>{props.title}</div>
            <Show when={props.subtitle}>
                {s => <div class={styles['modal-sub']}>{s()}</div>}
            </Show>
        </div>
        <IconButton
            icon="x"
            label="Close"
            iconSize={16}
            class={styles['modal-x']}
            onClick={props.onClose}
        />
    </div>
)

export default ModalHeader
export { ModalHeader }
