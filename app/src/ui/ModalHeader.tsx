// app/src/ui/ModalHeader.tsx
// The header row every modal in the app repeats: a title, an optional `// subtitle`, and a close
// control pushed to the trailing edge — drawn as ONE continuous top-rule hairline broken only by
// that text and the close control, so it reads as the frame's own top edge rather than a banner
// sitting above the frame.
//
// Extracted because SIX components (the four calendar modals + bases/BaseSettings +
// bases/QueryBuilder) each hand-rolled this markup against one shared calendar/Calendar.module.css
// — the repo's own "a shared stylesheet means a missing component" smell. The duplication had
// already drifted: BaseSettings used a `<div role="button">` for close, which with no tabindex is
// not keyboard focusable at all. The close control here is a real IconButton, so it is focusable,
// labelled and styled like every other icon button in the app.
//
// Redrawn for the modal-redesign (2026-09-23 plan): the old anatomy was an icon mark + Title Case
// text + a boxed ✕, floating above a separately-bordered panel. This header renders no mark at
// all. Instead ModalHeader IS exactly `--row-h` tall and draws the top rule itself, as line segments either
// side of the title/subtitle/close, at the row's vertical center — the same y FormModal's own
// frame (`FormModal.module.css`'s `.panel::before`) is inset from the top by, so the two pieces
// read as one hairline across the whole panel width. No background box masks the text — that
// would need to match `--pop-bg-strong` exactly and would stop reading correctly the moment a
// caller layers a translucent fill under it, so the rule is drawn only where there is no text: two
// short edge segments plus a flexible segment between the subtitle and the close control.
import { Show, createEffect, type Component } from 'solid-js'
import IconButton from './IconButton'
import { warnLabelCase } from './devWarn'
import styles from './ModalHeader.module.css'

export type ModalHeaderProps = {
    title: string
    subtitle?: string
    onClose: () => void
    /** Destructive tone — the title takes --danger instead of --fg. A delete dialog whose own
     *  title is painted the ordinary neutral tells the reader nothing about what it does, which is
     *  where the destructive signal belongs: on the modal, not on each of its choices. */
    tone?: 'default' | 'danger'
    class?: string
}

const ModalHeader: Component<ModalHeaderProps> = props => {
    if (import.meta.env?.DEV) {
        createEffect(() => warnLabelCase('ModalHeader', props.title))
    }
    return (
        <div
            class={styles['modal-head']}
            classList={{
                [styles['danger']!]: props.tone === 'danger',
                [props.class ?? '']: !!props.class,
            }}
        >
            <span class={styles['rule-lead']} />
            <span class={styles['title']}>{props.title}</span>
            <Show when={props.subtitle}>
                {s => (
                    <>
                        <span class={styles['sep']}>{'//'}</span>
                        <span class={styles['sub']}>{s()}</span>
                    </>
                )}
            </Show>
            <span class={styles['rule-fill']} />
            <IconButton
                icon="x"
                label="Close"
                data-modal-close
                class={styles['close']}
                onClick={props.onClose}
            />
            <span class={styles['rule-trail']} />
        </div>
    )
}

export default ModalHeader
export { ModalHeader }
