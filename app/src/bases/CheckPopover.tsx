// app/src/bases/CheckPopover.tsx
// The popup a transcript check's warning glyph opens: the strip of the scan the line came from, the
// text that was read, why it is flagged, and the two ways out: `[ looks right ]` clears the check,
// `[ retype ]` selects the line so typing replaces it (which clears it too).
import { Show, type Component, type JSX } from 'solid-js'
import type { TranscriptCheck } from '../../../core/src/transcript'
import AnchoredPopover from '../ui/AnchoredPopover'
import Popover from '../ui/Popover'
import Text from '../ui/Text'
import { TextButton } from '../ui/TextButton'
import styles from './CheckPopover.module.css'

export type CheckPopoverProps = {
    open: boolean
    anchor: () => HTMLElement | undefined
    check?: TranscriptCheck
    /** The scan strip for the line (a CheckCrop), or nothing where the page image is not at hand. */
    crop?: JSX.Element
    onApprove: () => void
    onRetype: () => void
    onDismiss: () => void
}

/** Why the line is flagged, per level; a whole-page check says what the reader returned. */
export const checkReason = (check: TranscriptCheck): string =>
    check.line === ''
        ? 'the reader returned no text for this page, though it has writing on it'
        : check.level === 'unsure'
          ? 'not sure of this line: a word in it may be wrong'
          : 'this line read badly: most of it may be wrong'

const CheckPopover: Component<CheckPopoverProps> = props => (
    <AnchoredPopover anchor={props.anchor} open={props.open} onDismiss={props.onDismiss} panelAttrs={{ 'data-check-popover': true }}>
        <Popover tone="panel" class={styles.box}>
            <Show when={props.check}>
                {check => (
                    <div class={styles.body} data-check-level={check().level}>
                        {props.crop}
                        <Show when={check().line !== ''}>
                            <Text as="span" class={styles.read} data-check-read>
                                {check().line}
                            </Text>
                        </Show>
                        <Text as="span" size="ui" tone={check().level === 'garbled' ? 'danger' : 'muted'}>
                            {checkReason(check())}
                        </Text>
                        <div class={styles.actions}>
                            <TextButton onClick={() => props.onApprove()} data-check-approve>
                                looks right
                            </TextButton>
                            <TextButton onClick={() => props.onRetype()} data-check-retype>
                                {check().line === '' ? 'type it' : 'retype'}
                            </TextButton>
                        </div>
                    </div>
                )}
            </Show>
        </Popover>
    </AnchoredPopover>
)

export default CheckPopover
