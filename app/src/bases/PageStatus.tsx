// app/src/bases/PageStatus.tsx
// The status cell at the right end of a page's divider: which reader produced the page's text, that
// it waits or is being read, why it failed (with `[ retry ]`), or that it was never transcribed
// (with `[ transcribe ]`). Parts are joined with `//`.
import { Show, type Component } from 'solid-js'
import type { TranscribePageState } from '../../../core/src/transcribeJobTypes'
import type { TranscriptEngine } from '../../../core/src/transcript'
import Text from '../ui/Text'
import { TextButton } from '../ui/TextButton'
import styles from './PageStatus.module.css'

export type PageStatusProps = {
    state?: TranscribePageState
    /** the page has no text and no job covers it */
    empty?: boolean
    onRetry?: () => void
    className?: string
}

/** Engine names as the UI says them: never `marker`. */
const ENGINE: Record<TranscriptEngine, string> = { 'on-device': 'on-device', marker: 'math reader', ai: 'ai' }

/** The longest failure reason shown; longer ones end in an ellipsis. */
export const REASON_MAX = 60

export const shortReason = (s: string): string => (s.length > REASON_MAX ? `${s.slice(0, REASON_MAX - 1).trimEnd()}…` : s)

const PageStatus: Component<PageStatusProps> = props => {
    const status = () => props.state?.status
    const engine = () => (props.state?.engine ? ENGINE[props.state.engine] : undefined)
    return (
        <Text as="span" inherit class={[styles['page-status'], props.className].filter(Boolean).join(' ')} data-page-status={status() ?? (props.empty ? 'empty' : 'idle')}>
            <Show when={status() === 'failed'}>
                <Text as="span" size="ui" tone="danger" class={styles['page-status-reason']} data-page-status-reason>
                    {`failed // ${shortReason(props.state?.error ?? 'unknown error')}`}
                </Text>
                <Show when={props.onRetry}>
                    <TextButton class={styles['page-status-action']} onClick={() => props.onRetry?.()}>
                        retry
                    </TextButton>
                </Show>
            </Show>
            <Show when={status() === 'queued'}>
                <Text as="span" size="ui" tone="muted">
                    queued
                </Text>
            </Show>
            <Show when={status() === 'reading'}>
                <Text as="span" size="ui" tone="muted">
                    {engine() ? `reading // ${engine()}` : 'reading'}
                </Text>
            </Show>
            <Show when={status() === 'done' && engine()}>
                <Text as="span" size="ui" tone="muted">
                    {engine()}
                </Text>
            </Show>
            <Show when={!status() && props.empty}>
                <Text as="span" size="ui" tone="muted">
                    not transcribed
                </Text>
                <Show when={props.onRetry}>
                    <TextButton class={styles['page-status-action']} onClick={() => props.onRetry?.()}>
                        transcribe
                    </TextButton>
                </Show>
            </Show>
        </Text>
    )
}

export default PageStatus
