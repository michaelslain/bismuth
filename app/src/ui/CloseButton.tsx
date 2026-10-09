import { splitProps } from 'solid-js'
import TextButton, { type TextButtonProps } from './TextButton'

export type CloseButtonProps = {
    /** Accessible name and tooltip, e.g. `close tab`. The visible text is always the letter `x`. */
    label: string
} & Omit<TextButtonProps, 'children' | 'aria-label' | 'primary'>

/** The `[x]` that closes, dismisses, removes or cancels — a modal, a tab, a toast, a list row.
 *  One register for that role everywhere: a TextButton reading the letter `x`, so it carries the
 *  same brackets as every other bracket action beside it, never a bare icon glyph. */
function CloseButton(props: CloseButtonProps) {
    const [local, rest] = splitProps(props, ['label', 'title'])
    return (
        <TextButton
            aria-label={local.label}
            title={local.title ?? local.label}
            {...rest}
        >
            x
        </TextButton>
    )
}

export default CloseButton
export { CloseButton }
