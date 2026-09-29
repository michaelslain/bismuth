import { Show, type Component } from 'solid-js'
import { TextButton } from '../ui/TextButton'
import { Icon } from '../icons/Icon'
import EmptyState from '../ui/EmptyState'
import InlineCode from '../ui/InlineCode'
import Text from '../ui/Text'
import styles from './FlashcardsSummary.module.css'

export type FlashcardsSummaryProps = {
    /** `done`: the session ended (deck / cram complete) with a recap and a restart. `empty`: there
     *  is nothing to review at all (no cards due, or no cards in the deck). */
    variant: 'done' | 'empty'
    cram: boolean
    /** Grades given this session (the raw count — cram re-reviews count each time). */
    reviewed: number
    /** How many of them were `good`. */
    good: number
    /** The session's frozen deck size (`done` in cram: how many cards were mastered). */
    total: number
    onRestart?: () => void
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

/** What the stage shows in place of a card: the end-of-session recap, or the empty-deck hint. */
const FlashcardsSummary: Component<FlashcardsSummaryProps> = props => (
    <Show
        when={props.variant === 'done'}
        fallback={
            <EmptyState
                blockClass={styles['fc-empty']}
                titleClass={styles['fc-empty-title']}
                bodyClass={styles['fc-empty-body']}
                title={props.cram ? 'No cards in this deck' : 'No cards due'}
            >
                <Show
                    when={!props.cram}
                    fallback={
                        <>
                            Add rows with <InlineCode>front</InlineCode> /{' '}
                            <InlineCode>back</InlineCode> columns.
                        </>
                    }
                >
                    Hit the{' '}
                    <Text as="span" inherit class={styles['inline-bolt']}>
                        <Icon value="Zap" />
                    </Text>{' '}
                    button to review everything anyway.
                </Show>
            </EmptyState>
        }
    >
        <div class={styles.done}>
            <EmptyState
                blockClass={styles['fc-empty']}
                titleClass={styles['fc-empty-title']}
                bodyClass={styles['fc-empty-body']}
                title={props.cram ? 'Cram complete' : 'Deck complete'}
            >
                <Show
                    when={props.cram}
                    fallback={
                        <>
                            You reviewed <Text
                                as="span"
                                inherit
                                weight="bold"
                                tone="default"
                            >
                                {props.reviewed}
                            </Text>{' '}
                            {plural(props.reviewed, 'card', 'cards')}
                            <Show when={props.good > 0}>
                                {' '}
                                //{' '}
                                <Text
                                    as="span"
                                    inherit
                                    class={styles['good-text']}
                                >
                                    good
                                </Text>{' '}
                                on most
                            </Show>
                            .
                        </>
                    }
                >
                    Every card is{' '}
                    <Text as="span" inherit class={styles['good-text']}>
                        easy
                    </Text>{' '}
                    — you mastered <Text
                        as="span"
                        inherit
                        weight="bold"
                        tone="default"
                    >
                        {props.total}
                    </Text>{' '}
                    {plural(props.total, 'card', 'cards')} in{' '}
                    <Text
                        as="span"
                        inherit
                        weight="bold"
                        tone="default"
                    >
                        {props.reviewed}
                    </Text>{' '}
                    {plural(props.reviewed, 'review', 'reviews')}.
                </Show>
            </EmptyState>
            <TextButton onClick={() => props.onRestart?.()}>
                review again
            </TextButton>
        </div>
    </Show>
)

export default FlashcardsSummary
