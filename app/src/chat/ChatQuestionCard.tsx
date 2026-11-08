// app/src/chat/ChatQuestionCard.tsx — ChatQuestionCard.module.css is the ONLY importer.
// Interactive AskUserQuestion card: each question's options as clickable buttons. A lone
// single-select question submits on click (Claude-TUI feel); multi-select or several questions
// stage picks and submit together. Every question also offers a free-text "other". Skipping sends
// a cancel. No surface: it sits on the transcript's own ground like ChatToolRow, and each option
// wears a `ui/BracketToggle` mark (`[ ]` / `[x]`), the "other" row included, so every answer sits on
// one column.
//
// TWO REGISTERS (DESIGN.md's three-registers rule). The head line and every `meta` run are
// mechanism: chrome, `--fs-ui`, like ChatPermissionCard's head and ChatToolRow's line. The question,
// the options and a typed "other" are words, so they take the prose face: the question at the chat
// message's own `--prose-font-size`, the option rows at `--fs-ui-prose`, the size for words inside
// chrome.
import { createStore } from 'solid-js/store'
import { For, Show, type Component } from 'solid-js'
import { Icon } from '../icons/Icon'
import Text from '../ui/Text'
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

/** The chrome line naming a question: its short header and, on a multi-select, the instruction. */
const questionMeta = (q: QuestionPart['questions'][number]): string =>
    [q.header?.toLowerCase(), q.multiSelect ? 'select all that apply' : '']
        .filter(Boolean)
        .join(' // ')

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
    // A lone question's meta IS the head line; several questions count in the head and name
    // themselves one block at a time.
    const headLabel = () =>
        questions.length > 1
            ? `${questions.length} questions`
            : questionMeta(questions[0]) || 'question'

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
                <Text as="span" inherit tone="muted">
                    {headLabel()}
                </Text>
            </div>
            <For each={questions}>
                {(q, qi) => (
                    <div class={styles['chat-question-block']}>
                        <Show when={questions.length > 1 && questionMeta(q)}>
                            <Text
                                as="div"
                                inherit
                                tone="muted"
                                class={styles['chat-question-meta']}
                            >
                                {questionMeta(q)}
                            </Text>
                        </Show>
                        <Text
                            as="div"
                            inherit
                            register="prose"
                            class={styles['chat-question-text']}
                        >
                            {q.question}
                        </Text>
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
                                        <BracketToggle
                                            class={styles['chat-question-mark']}
                                            checked={isChosen(qi(), opt.label)}
                                        />
                                        <Text
                                            as="span"
                                            inherit
                                            register="prose"
                                            class={
                                                styles['chat-question-option-label']
                                            }
                                        >
                                            {opt.label}
                                        </Text>
                                        <Show when={opt.description}>
                                            <Text
                                                as="span"
                                                inherit
                                                register="prose"
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
                            <Show when={!done()}>
                                <div class={styles['chat-question-other-row']}>
                                    <BracketToggle
                                        class={styles['chat-question-mark']}
                                        checked={!!sel.other[qi()].trim()}
                                    />
                                    <TextInput
                                        class={styles['chat-question-other']}
                                        placeholder="other…"
                                        value={sel.other[qi()]}
                                        onInput={v => setSel('other', qi(), v)}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault()
                                                submit()
                                            }
                                        }}
                                    />
                                </div>
                            </Show>
                        </div>
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
                                                <Show
                                                    when={
                                                        questions.length > 1 &&
                                                        q.header
                                                    }
                                                >
                                                    <Text
                                                        as="span"
                                                        inherit
                                                        tone="muted"
                                                    >
                                                        {q.header?.toLowerCase()}
                                                    </Text>
                                                </Show>
                                                <Text
                                                    as="span"
                                                    inherit
                                                    register="prose"
                                                    class={
                                                        styles[
                                                            'chat-question-answer-text'
                                                        ]
                                                    }
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
        </div>
    )
}

export default ChatQuestionCard
