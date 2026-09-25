// app/src/daemon/DaemonIdentity.tsx
// The daemon's name, with its personality tucked behind it. At rest this renders ONLY the name —
// a plain-text focusable trigger, not a bracket button. Hovering or keyboard-focusing it reveals a
// small card beneath, holding the one-line blurb and the `[ edit ]` button that opens the identity
// note (`onEdit`, forwarded from the host's `onEditIdentity`). The reveal is CSS-only
// (`:hover`/`:focus-within` on the wrapper) — no signal, so nothing else in the column ever moves
// when the card appears; it's absolutely positioned over whatever sits below.
import { createUniqueId, Show, type Component } from 'solid-js'
import Text from '../ui/Text'
import PlainButton from '../ui/PlainButton'
import { TextButton } from '../ui/TextButton'
import styles from './DaemonIdentity.module.css'

export type DaemonIdentityProps = {
    name: string
    blurb: string
    onEdit: () => void
    class?: string
}

const DaemonIdentity: Component<DaemonIdentityProps> = props => {
    const blurbId = createUniqueId()

    // A `<span>` root, not a `<div>`: DaemonHub hands this whole component to DaemonFace's
    // `caption` slot, which wraps it in a `<Text as="p">` — a block element here would force the
    // browser to implicitly close that `<p>` early and pop this out as a sibling, losing the
    // caption's own centering/spacing rules.
    return (
        <Text as="span" size="inherit" tone="inherit" class={`${styles.wrap} ${props.class ?? ''}`}>
            <PlainButton
                class={styles.nameTrigger}
                aria-describedby={props.blurb ? blurbId : undefined}
            >
                {props.name}
            </PlainButton>
            <div class={styles.card} data-testid="daemon-identity-card">
                <Show when={props.blurb}>
                    <Text
                        as="span"
                        size="ui"
                        tone="muted"
                        id={blurbId}
                        class={styles.blurb}
                        data-testid="daemon-identity-blurb"
                    >
                        {props.blurb}
                    </Text>
                </Show>
                <TextButton onClick={props.onEdit}>
                    edit
                </TextButton>
            </div>
        </Text>
    )
}

export default DaemonIdentity
