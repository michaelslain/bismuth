import { createSignal, Show, type Component } from 'solid-js'
import { TextInput } from '../ui/TextInput'
import { isConfirmKey } from '../ui/widgetKeys'
import { renderMarkdown } from './markdown'
import cardCellPlaceholder from './cardCellPlaceholder'
import styles from './CardCell.module.css'

export type CardCellProps = {
    /** Which side of the card this cell edits. Emitted as `data-cell` — the hook stories and CSS
     *  read, in place of the old bare `cell-front` class. */
    field: 'front' | 'back'
    placeholder: string
    value: string
    /** Row variant: commits on blur, only when the text changed. */
    onCommit?: (value: string) => void
    /** Draft variant: a plain controlled field with no markdown overlay. */
    draft?: boolean
    onInput?: (value: string) => void
    /** Draft variant: the confirm key (Enter, not Shift+Enter) was pressed in the field. */
    onEnter?: () => void
    inputRef?: (el: HTMLTextAreaElement) => void
    class?: string
}

/** One Front/Back cell. The row variant layers a transparent textarea over its rendered-markdown
 *  overlay: the overlay sits in normal flow and DRIVES the cell height (no fragile JS auto-grow or
 *  font-load race), and the textarea reveals the raw text on focus (CSS :focus-within). */
const CardCell: Component<CardCellProps> = props => {
    const [val, setVal] = createSignal(props.value)
    return (
        <div
            class={`${styles.cell} ${props.draft ? styles.draft : ''} ${props.class ?? ''}`}
            data-cell={props.field}
        >
            <Show when={!props.draft}>
                <div
                    class={styles['cell-md']}
                    innerHTML={
                        // trim: renderMarkdown ends every block with "\n", which `.cell-md`'s
                        // pre-wrap would paint as an extra blank line under the card text.
                        renderMarkdown(val()).trim() ||
                        cardCellPlaceholder(
                            styles['cell-ph'],
                            props.placeholder,
                        )
                    }
                />
            </Show>
            <TextInput
                multiline
                plain
                ref={el => props.inputRef?.(el)}
                value={props.draft ? props.value : val()}
                placeholder={props.placeholder}
                onInput={v => (props.draft ? props.onInput?.(v) : setVal(v))}
                onKeyDown={e => {
                    if (props.draft && isConfirmKey(e)) {
                        e.preventDefault()
                        props.onEnter?.()
                    }
                }}
                onBlur={() =>
                    !props.draft &&
                    val() !== props.value &&
                    props.onCommit?.(val())
                }
            />
        </div>
    )
}

export default CardCell
