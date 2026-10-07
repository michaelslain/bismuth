// app/src/chat/ChatQuestionCard.tsx — ChatQuestionCard.module.css is the ONLY importer.
// Interactive AskUserQuestion card: each question's options as clickable buttons. A lone
// single-select question submits on click (Claude-TUI feel); multi-select or several questions
// stage picks and submit together. Every question also offers a free-text "Other". Skipping sends
// a cancel. Extracted verbatim in behaviour from ChatView.tsx's local `QuestionCard` closure.
// The surface is `ui/Card` (proposal) — it was a third copy of that recipe that even read the
// deprecated `--r-card` — and each option wears a `ui/BracketToggle` mark (`[ ]` / `[x]`), single
// select included: it used to draw Square/SquareCheck icons by hand for multi-select and no mark at
// all for single-select.
import { createStore } from 'solid-js/store'
import { For, Show, type Component } from 'solid-js'
import { Icon } from '../icons/Icon'
import Text from '../ui/Text'
import Card from '../ui/Card'
import BracketToggle from '../ui/BracketToggle'
import { TextButton } from '../ui/TextButton'
import { TextInput } from '../ui/TextInput'
import PlainButton from '../ui/PlainButton'
import type { QuestionPart } from './chatTranscriptLogic'
import { chosenLabels } from './chatQuestionAnswer'
import styles from './ChatQuestionCard.module.css'

export type ChatQuestionCardProps = {
    part: QuestionPart
    onAnswer: (answers: Record<string, string> | null) => void
    class?: string
}

const ChatQuestionCard: Component<ChatQuestionCardProps> = props => {
    const questions = props.part.questions
    // Per-question selected option labels + free-text "Other" input, by question index.
    const [sel, setSel] = createStore<{ picks: string[][]; other: string[] }>({
        picks: questions.map(() => []),
        other: questions.map(() => ''),
    })
    const done = () => !!props.part.answered || !!props.part.cancelled
    const isPicked = (qi: number, label: string) => sel.picks[qi].includes(label)
    // An answered card shows WHICH option was taken: a lone single-select question submits straight
    // from the click and never stages a pick, so the answer map is the record, not `sel`.
    // The answer is `parts.join(', ')`, so it cannot be split back apart (an option label may itself
    // contain a comma) nor prefix-matched ("Yes" is a prefix of "Yes, do it"): walk it against the
    // question's own labels instead (chatQuestionAnswer.ts).
    const isChosen = (qi: number, label: string) =>
        isPicked(qi, label) ||
        chosenLabels(
            props.part.answered?.[questions[qi].question] ?? '',
            questions[qi].options.map(o => o.label),
        ).has(label)
    const answeredFor = (qi: number) =>
        sel.picks[qi].length > 0 || sel.other[qi].trim().length > 0
    const allAnswered = () => questions.every((_, qi) => answeredFor(qi))
    // A lone single-select question submits the instant an option is clicked (no Submit needed) —
    // but only while the user hasn't started typing an "Other" answer, which would be lost.
    const immediate = (qi: number) =>
        questions.length === 1 &&
        !questions[qi].multiSelect &&
        !sel.other[qi].trim()

    const buildAnswers = (): Record<string, string> => {
        const answers: Record<string, string> = {}
        questions.forEach((q, qi) => {
            const parts = [...sel.picks[qi]]
            const o = sel.other[qi].trim()
            if (o) parts.push(o)
            answers[q.question] = parts.join(', ') // multi-select answers are comma-joined
        })
        return answers
    }
    const submit = () => {
        if (done() || !allAnswered()) return
        props.onAnswer(buildAnswers())
    }
    const onOption = (qi: number, label: string) => {
        if (done()) return
        if (immediate(qi)) {
            props.onAnswer({ [questions[qi].question]: label })
            return
        }
        setSel('picks', qi, cur => {
            if (questions[qi].multiSelect)
                return cur.includes(label)
                    ? cur.filter(l => l !== label)
                    : [...cur, label]
            return cur.includes(label) ? [] : [label] // single-select: clicking again clears it
        })
    }

    return (
        <Card
            variant="proposal"
            class={[
                styles['chat-question'],
                done() ? styles['answered'] : '',
                props.class ?? '',
            ]
                .filter(Boolean)
                .join(' ')}
        >
            <div class={styles['chat-question-head']}>
                <Icon
                    value="ListChecks"
                    class={styles['chat-question-icon']}
                />
                <Text as="span" weight="bold" class={styles['chat-question-title']}>
                    {questions.length > 1
                        ? `${questions.length} questions`
                        : 'Question'}
                </Text>
            </div>
            <For each={questions}>
                {(q, qi) => (
                    <div class={styles['chat-question-block']}>
                        <div class={styles['chat-question-prompt']}>
                            <Show when={q.header}>
                                <Text
                                    as="span"
                                    eyebrow
                                    size="micro"
                                    tone="muted"
                                    weight="bold"
                                    class={styles['chat-question-chip']}
                                >
                                    {q.header?.toLowerCase()}
                                </Text>
                            </Show>
                            <Text as="span" class={styles['chat-question-text']}>
                                {q.question}
                            </Text>
                            <Show when={q.multiSelect}>
                                <Text
                                    as="span"
                                    size="ui"
                                    tone="muted"
                                    italic
                                    class={styles['chat-question-multi']}
                                >
                                    select all that apply
                                </Text>
                            </Show>
                        </div>
                        <div class={styles['chat-question-options']}>
                            <For each={q.options}>
                                {opt => (
                                    <PlainButton
                                        class={styles['chat-question-option']}
                                        classList={{
                                            [styles['picked']]: isChosen(
                                                qi(),
                                                opt.label,
                                            ),
                                        }}
                                        aria-pressed={isChosen(qi(), opt.label)}
                                        disabled={done()}
                                        onClick={() => onOption(qi(), opt.label)}
                                    >
                                        <Text
                                            as="span"
                                            inherit
                                            class={
                                                styles['chat-question-option-main']
                                            }
                                        >
                                            <BracketToggle
                                                checked={isChosen(qi(), opt.label)}
                                            />
                                            <Text
                                                as="span"
                                                class={
                                                    styles[
                                                        'chat-question-option-label'
                                                    ]
                                                }
                                            >
                                                {opt.label}
                                            </Text>
                                        </Text>
                                        <Show when={opt.description}>
                                            <Text
                                                as="span"
                                                size="ui"
                                                tone="muted"
                                                class={
                                                    styles[
                                                        'chat-question-option-desc'
                                                    ]
                                                }
                                            >
                                                {opt.description}
                                            </Text>
                                        </Show>
                                    </PlainButton>
                                )}
                            </For>
                        </div>
                        <Show when={!done()}>
                            <TextInput
                                class={styles['chat-question-other']}
                                placeholder="Other… (type a custom answer)"
                                value={sel.other[qi()]}
                                onInput={v => setSel('other', qi(), v)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault()
                                        submit()
                                    }
                                }}
                            />
                        </Show>
                    </div>
                )}
            </For>
            <Show
                when={!done()}
                fallback={
                    <div
                        class={styles['chat-question-outcome']}
                        data-testid="chat-question-outcome"
                    >
                        <Show
                            when={props.part.answered}
                            fallback={
                                <div class={styles['chat-question-answer']}>
                                    <Icon value="Ban" /> Skipped
                                </div>
                            }
                        >
                            {ans => (
                                <For each={questions}>
                                    {q => (
                                        <Show when={ans()[q.question]}>
                                            <div
                                                class={
                                                    styles['chat-question-answer']
                                                }
                                            >
                                                <Icon value="Check" />
                                                <Show when={q.header}>
                                                    <Text
                                                        as="span"
                                                        eyebrow
                                                        size="micro"
                                                        tone="muted"
                                                        weight="bold"
                                                        class={
                                                            styles[
                                                                'chat-question-chip'
                                                            ]
                                                        }
                                                    >
                                                        {q.header?.toLowerCase()}
                                                    </Text>
                                                </Show>
                                                <Text
                                                    as="span"
                                                    inherit
                                                >
                                                    {ans()[q.question]}
                                                </Text>
                                            </div>
                                        </Show>
                                    )}
                                </For>
                            )}
                        </Show>
                    </div>
                }
            >
                <div class={styles['chat-question-actions']}>
                    <TextButton
                        primary
                        disabled={!allAnswered()}
                        onClick={submit}
                    >
                        submit
                    </TextButton>
                    <TextButton onClick={() => props.onAnswer(null)}>
                        skip
                    </TextButton>
                </div>
            </Show>
        </Card>
    )
}

export default ChatQuestionCard
