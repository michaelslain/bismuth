// app/src/preview/CodeFindBar.tsx — CodeFindBar.tsx is the ONLY importer of CodeFindBar.module.css.
// The find popover floated over a preview's body (Cmd/Ctrl+F). `mode="code"` is the live find field
// over a code/text file; `mode="pdf"` is the one informational note ("not available yet") that
// shares the same floating chrome — one component owning the chrome, not two importing it.
// Code mode also carries the ai answer (PreviewView: `editor.findAsksAi`): a muted `↵ ask` hint after
// a `no results` count, and the answer as a row UNDER the field, part of the bar and its width — the
// preview twin of the note find bar's `.bismuth-find-answer` (editor/findPanel.ts).
import { Show, type Component } from 'solid-js'
import { Icon } from '../icons/Icon'
import { IconButton } from '../ui/IconButton'
import SearchBar from '../ui/SearchBar'
import Text from '../ui/Text'
import { isConfirmBackKey, isConfirmKey, isDismissKey } from '../ui/widgetKeys'
import styles from './CodeFindBar.module.css'
import CloseButton from '../ui/CloseButton'

export type CodeFindBarProps = {
    /** 'code' (default): the find field. 'pdf': a note that in-app PDF search does not exist yet. */
    mode?: 'code' | 'pdf'
    /** Code mode: the query, and its edit. */
    query?: string
    onQuery?: (value: string) => void
    /** Code mode: "2/3" / "No results" / '' — already worded by the caller. */
    count?: string
    /** Code mode: a non-empty query that matched nothing (the count reads danger, steppers disable). */
    noResults?: boolean
    /** Code mode: Enter on a query with no match may ask the ai, so the bar is wide enough for a
     *  question beside `no results ↵ ask`. */
    canAsk?: boolean
    /** Code mode: a muted hint after the count ('↵ ask' when Enter would ask the ai). */
    hint?: string
    /** Code mode: the ai's answer row under the bar (`asking…`, the answer, or why it could not);
     *  absent → no row. */
    answer?: string
    /** The answer row's tone: 'muted' for a status line, 'danger' for a refusal, absent for an answer. */
    answerTone?: 'muted' | 'danger'
    matchCount?: number
    caseSensitive?: boolean
    onToggleCase?: () => void
    /** Enter / Shift+Enter / the chevrons. */
    onStep?: (dir: 1 | -1) => void
    onClose: () => void
    /** The text input, for the caller's focus-on-open. */
    inputRef?: (el: HTMLInputElement) => void
}

const CodeFindBar: Component<CodeFindBarProps> = props => {
    let inputEl: HTMLInputElement | undefined
    const refocus = () => inputEl?.focus()
    return (
        // stopPropagation on this wrapper (not SearchBar itself — its onKeyDown prop reaches only the
        // input) is what keeps the app's capture-phase global keydown handler from seeing ANY key
        // pressed anywhere in the find bar, including the trailing buttons.
        <div
            class={styles['preview-find']}
            classList={{
                [styles['preview-find-note']]: props.mode === 'pdf',
                [styles['preview-find-asks']]: props.mode !== 'pdf' && !!props.canAsk,
            }}
            onKeyDown={e => e.stopPropagation()}
        >
            <Show
                when={props.mode !== 'pdf'}
                fallback={
                    <>
                        {/* PdfPages renders pdf.js's text layer (selectable/copyable per page), but
                            there is no find-bar UI over it yet — say so plainly rather than
                            pretending to search. */}
                        <Icon value="Search" />
                        <Text
                            as="span"
                            inherit
                            class={styles['preview-find-note-text']}
                        >
                            In-app PDF search isn't available yet.
                        </Text>
                        <CloseButton label="Dismiss" onClick={props.onClose} />
                    </>
                }
            >
                <SearchBar
                    size="compact"
                    placeholder="find"
                    aria-label="Find in file"
                    value={props.query ?? ''}
                    onInput={value => props.onQuery?.(value)}
                    onKeyDown={e => {
                        if (isConfirmBackKey(e)) {
                            e.preventDefault()
                            props.onStep?.(-1)
                        } else if (isConfirmKey(e)) {
                            e.preventDefault()
                            props.onStep?.(1)
                        } else if (isDismissKey(e)) {
                            e.preventDefault()
                            props.onClose()
                        }
                    }}
                    inputRef={el => {
                        inputEl = el
                        props.inputRef?.(el)
                    }}
                >
                    <Text
                        as="span"
                        inherit
                        class={styles['preview-find-count']}
                        classList={{
                            [styles['is-empty']]: !!props.noResults,
                        }}
                    >
                        {props.count}
                        <Show when={props.hint}>
                            {' '}
                            <Text
                                as="span"
                                inherit
                                class={styles['preview-find-hint']}
                                title="Press Enter to ask ai about this file"
                            >
                                {props.hint}
                            </Text>
                        </Show>
                    </Text>
                    <IconButton
                        icon="ChevronUp"
                        label="Previous match (Shift+Enter)"
                        disabled={(props.matchCount ?? 0) === 0}
                        onClick={() => {
                            props.onStep?.(-1)
                            refocus()
                        }}
                    />
                    <IconButton
                        icon="ChevronDown"
                        label="Next match (Enter)"
                        disabled={(props.matchCount ?? 0) === 0}
                        onClick={() => {
                            props.onStep?.(1)
                            refocus()
                        }}
                    />
                    <IconButton
                        glyph="Aa"
                        label="Match case"
                        variant={props.caseSensitive ? 'selected' : 'unselected'}
                        onClick={() => {
                            props.onToggleCase?.()
                            refocus()
                        }}
                    />
                    <CloseButton label="Close (Esc)" onClick={props.onClose} />
                </SearchBar>
                <Show when={props.answer}>
                    <Text
                        as="div"
                        size={props.answerTone ? 'ui' : 'body'}
                        tone={props.answerTone ?? 'default'}
                        register={props.answerTone ? 'chrome' : 'prose'}
                        class={styles['preview-find-answer']}
                        aria-live="polite"
                        data-testid="find-answer"
                    >
                        {props.answer}
                    </Text>
                </Show>
            </Show>
        </div>
    )
}

export default CodeFindBar
