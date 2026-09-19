// app/src/chat/ChatQuestionCard.tsx — ChatQuestionCard.module.css is the ONLY importer.
// Interactive AskUserQuestion card: each question's options as clickable buttons. A lone
// single-select question submits on click (Claude-TUI feel); multi-select or several questions
// stage picks and submit together. Every question also offers a free-text "Other". Skipping sends
// a cancel. Extracted verbatim in behaviour from ChatView.tsx's local `QuestionCard` closure.
import { createStore } from 'solid-js/store'
import { For, Show } from 'solid-js'
import { Icon } from '../icons/Icon'
import Text from '../ui/Text'
import { TextButton } from '../ui/TextButton'
import { TextInput } from '../ui/TextInput'
import PlainButton from '../ui/PlainButton'
import type { QuestionPart } from '../chatTranscript'
import styles from './ChatQuestionCard.module.css'

export type ChatQuestionCardProps = {
    part: QuestionPart
    onAnswer: (answers: Record<string, string> | null) => void
    class?: string
}

export default function ChatQuestionCard(props: ChatQuestionCardProps) {
    const questions = props.part.questions
    // Per-question selected option labels + free-text "Other" input, by question index.
    const [sel, setSel] = createStore<{ picks: string[][]; other: string[] }>({
        picks: questions.map(() => []),
        other: questions.map(() => ''),
    })
    const done = () => !!props.part.answered || !!props.part.cancelled
    const isPicked = (qi: number, label: string) => sel.picks[qi].includes(label)
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
        <div
            class={`${styles['chat-question']} ${props.class ?? ''}`}
            classList={{ [styles['answered']]: done() }}
        >
            <div class={styles['chat-question-head']}>
                <Icon
                    value="ListChecks"
                    size={14}
                    class={styles['chat-question-icon']}
                />
                <Text
                    as="span"
                    weight="bold"
                    class={styles['chat-question-title']}
                >
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
                                            [styles['picked']]: isPicked(
                                                qi(),
                                                opt.label,
                                            ),
                                        }}
                                        disabled={done()}
                                        onClick={() => onOption(qi(), opt.label)}
                                    >
                                        <Text
                                            as="span"
                                            size="inherit"
                                            tone="inherit"
                                            weight="inherit"
                                            class={
                                                styles['chat-question-option-main']
                                            }
                                        >
                                            <Show when={q.multiSelect}>
                                                <Icon
                                                    value={
                                                        isPicked(qi(), opt.label)
                                                            ? 'SquareCheck'
                                                            : 'Square'
                                                    }
                                                    size={13}
                                                    class={
                                                        styles[
                                                            'chat-question-check'
                                                        ]
                                                    }
                                                />
                                            </Show>
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
                        classList={{
                            [styles['cancelled']]: !props.part.answered,
                        }}
                    >
                        <Show
                            when={props.part.answered}
                            fallback={
                                <>
                                    <Icon value="Ban" size={13} /> Skipped
                                </>
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
                                                <Icon value="Check" size={13} />
                                                <Show when={q.header}>
                                                    <Text
                                                        as="span"
                                                        size="inherit"
                                                        tone="inherit"
                                                        weight="inherit"
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
                                                    size="inherit"
                                                    tone="inherit"
                                                    weight="inherit"
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
                        variant="selected"
                        size="sm"
                        disabled={!allAnswered()}
                        onClick={submit}
                    >
                        SUBMIT
                    </TextButton>
                    <TextButton size="sm" onClick={() => props.onAnswer(null)}>
                        SKIP
                    </TextButton>
                </div>
            </Show>
        </div>
    )
}
