// app/src/preview/CodeFindBar.tsx — CodeFindBar.tsx is the ONLY importer of CodeFindBar.module.css.
// The find popover floated over a preview's body (Cmd/Ctrl+F). `mode="code"` is the live find field
// over a code/text file; `mode="pdf"` is the one informational note ("not available yet") that
// shares the same floating chrome — one component owning the chrome, not two importing it.
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
            classList={{ [styles['preview-find-note']]: props.mode === 'pdf' }}
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
                        icon="CaseSensitive"
                        label="Match case"
                        variant={props.caseSensitive ? 'selected' : 'unselected'}
                        aria-pressed={!!props.caseSensitive}
                        onClick={() => {
                            props.onToggleCase?.()
                            refocus()
                        }}
                    />
                    <CloseButton label="Close (Esc)" onClick={props.onClose} />
                </SearchBar>
            </Show>
        </div>
    )
}

export default CodeFindBar
