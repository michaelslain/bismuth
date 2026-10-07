import { Show, type Component } from 'solid-js'
import type { StatusSegment as StatusSegmentData } from '../../../core/src/statusBarEval'
import Text from '../ui/Text'
import TextButton from '../ui/TextButton'
import PlainButton from '../ui/PlainButton'
import { Icon } from '../icons/Icon'
import styles from './StatusSegment.module.css'

export type StatusSegmentProps = {
    segment: StatusSegmentData
    onRunCommand?: (id: string) => void
    onTrust?: (command: string) => void
    className?: string
}

// An untrusted command is shown truncated: the bar is 18px tall and nowrap, and the full text is
// in the tooltip, which is where the owner reads what they are about to approve.
const UNTRUSTED_MAX = 24

// A tone name is a design token, never a colour: `faint`/`muted` are the two neutrals with
// their own names, every other tone (fg, accent, warning, danger, success and the category
// swatches) is `--<name>` verbatim.
function toneVar(tone: string): string {
    if (tone === 'muted') return 'var(--text-muted)'
    return `var(--${tone})`
}

/**
 * One non-builtin status bar segment — a templated readout, an untrusted `run:` awaiting
 * approval, or a failed query. Reads as one more `label: value` readout in the bar's row: the
 * whole text `--text-muted` (inherited from the bar) unless a `tone` is set, same size, no separator
 * glyph and no box. Renders NOTHING for an empty text with no untrusted/error state, so an
 * emptied segment leaves no stray gap.
 */
const StatusSegment: Component<StatusSegmentProps> = props => {
    const cls = () => [styles['status-segment'], props.className].filter(Boolean).join(' ')
    const seg = () => props.segment
    const toneStyle = () => (seg().tone ? { color: toneVar(seg().tone!) } : undefined)
    const run = () => {
        const id = seg().command
        if (id) props.onRunCommand?.(id)
    }
    const body = () => (
        <>
            <Show when={seg().icon}>
                <Icon value={seg().icon!} />
            </Show>
            {seg().text}
        </>
    )
    return (
        <Show
            when={seg().untrusted}
            fallback={
                <Show
                    when={seg().error !== undefined}
                    fallback={
                        <Show when={seg().text}>
                            <Show
                                when={seg().command}
                                fallback={
                                    <Text
                                        as="span"
                                        inherit
                                        class={cls()}
                                        style={toneStyle()}
                                        title={seg().tooltip}
                                    >
                                        {body()}
                                    </Text>
                                }
                            >
                                <PlainButton
                                    class={`${cls()} ${styles['status-segment--click']}`}
                                    style={{
                                        '--segment-tone': seg().tone
                                            ? toneVar(seg().tone!)
                                            : 'inherit',
                                    }}
                                    title={seg().tooltip}
                                    onClick={run}
                                >
                                    {body()}
                                </PlainButton>
                            </Show>
                        </Show>
                    }
                >
                    <Text
                        as="span"
                        inherit
                        class={`${cls()} ${styles['status-segment--error']}`}
                        title={seg().error}
                    >
                        err
                    </Text>
                </Show>
            }
        >
            {untrusted => (
                <Text
                    as="span"
                    inherit
                    class={`${cls()} ${styles['status-segment--untrusted']}`}
                    title={`this vault wants to run: ${untrusted().command} // allow on this machine?`}
                >
                    {untrusted().command.length > UNTRUSTED_MAX
                        ? `${untrusted().command.slice(0, UNTRUSTED_MAX)}…`
                        : untrusted().command}
                    <TextButton
                        primary
                        class={styles['status-segment-allow']}
                        onClick={() => props.onTrust?.(untrusted().command)}
                    >
                        allow
                    </TextButton>
                </Text>
            )}
        </Show>
    )
}

export default StatusSegment
