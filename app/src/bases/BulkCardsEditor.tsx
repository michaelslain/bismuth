import { For, Show, type Component } from 'solid-js'
import { TextInput } from '../ui/TextInput'
import { SegmentedToggle } from '../ui/SegmentedToggle'
import EmptyState from '../ui/EmptyState'
import Text from '../ui/Text'
import { renderMarkdown } from './markdown'
import { SEPARATORS, type ParsedCard } from './cardsEdit'
import { plural } from '../plural'
import styles from './BulkCardsEditor.module.css'

export type BulkCardsEditorProps = {
    text: string
    onText: (text: string) => void
    /** `auto`, or a SEPARATORS id. */
    delim: string
    onDelim: (id: string) => void
    /** `parseBulk(text, delim)` — the caller owns it because its footer counts the valid ones. */
    parsed: ParsedCard[]
}

const DELIM_OPTIONS = [
    { id: 'auto', label: 'auto' },
    ...SEPARATORS.map(s => ({ id: s.id, label: s.label })),
]

/** The Bulk add mode of EditCardsModal: paste many cards at once, pick (or auto-detect) the
 *  separator, and see the parsed cards — the ones without a back flagged — before adding. */
const BulkCardsEditor: Component<BulkCardsEditorProps> = props => (
    <div class={styles['cards-bulkwrap']}>
        <div class={styles['cards-bulk-toolbar']}>
            <Text as="span" size="micro" tone="faint">
                separator
            </Text>
            <SegmentedToggle
                size="sm"
                options={DELIM_OPTIONS}
                value={props.delim}
                onChange={props.onDelim}
            />
            <div class={styles.sp} />
            <Text as="span" size="ui" tone="faint" class={styles.hint}>
                One card per line // front ‹sep› back
            </Text>
        </div>
        <div class={styles['cards-bulk-grid']}>
            <div class={styles['cards-bulk-input']}>
                <Text
                    as="span"
                    size="micro"
                    tone="faint"
                    class={styles['cards-bulk-lab']}
                >
                    paste your cards
                </Text>
                <TextInput
                    multiline
                    class={styles['cards-bulk-textarea']}
                    spellcheck={false}
                    value={props.text}
                    onInput={props.onText}
                    placeholder={
                        'What is the Spanish word for "house"?    casa\ncasa :: house\nhola : hello\n\nPaste from a spreadsheet, Anki, or an Obsidian (:: / :) deck.'
                    }
                />
            </div>
            <div class={styles['cards-bulk-preview']}>
                <div class={styles['cards-pvhead']}>
                    <Text as="span" size="micro" tone="faint">
                        preview
                    </Text>
                    <Text
                        as="span"
                        size="ui"
                        tone="inherit"
                        class={styles['cards-cnt']}
                        data-testid="bulk-preview-count"
                    >
                        {plural(props.parsed.length, 'card')}
                    </Text>
                </div>
                <div class={styles['cards-pvlist']}>
                    <Show
                        when={props.parsed.length > 0}
                        fallback={
                            <EmptyState blockClass={styles['cards-pvempty']}>
                                parsed cards appear here as you paste.
                            </EmptyState>
                        }
                    >
                        <For each={props.parsed}>
                            {(c, i) => (
                                <div
                                    data-testid="bulk-preview-row"
                                    class={`${styles['cards-pvcard']} ${c.back ? '' : styles['bad']}`}
                                >
                                    <Text
                                        as="div"
                                        size="micro"
                                        tone="faint"
                                        class={styles['cards-pi']}
                                    >
                                        {i() + 1}
                                    </Text>
                                    <div>
                                        <Show
                                            when={c.front}
                                            fallback={
                                                <Text
                                                    as="div"
                                                    italic
                                                    class={styles['cards-warn-em']}
                                                >
                                                    empty
                                                </Text>
                                            }
                                        >
                                            <div
                                                class={styles['cards-pf']}
                                                innerHTML={renderMarkdown(c.front)}
                                            />
                                        </Show>
                                        <Show
                                            when={c.back}
                                            fallback={
                                                <Text
                                                    as="div"
                                                    size="micro"
                                                    class={styles['cards-warn']}
                                                    data-testid="bulk-preview-warning"
                                                >
                                                    no back // separator not found
                                                    on this line
                                                </Text>
                                            }
                                        >
                                            <div
                                                class={styles['cards-pb']}
                                                innerHTML={renderMarkdown(c.back)}
                                            />
                                        </Show>
                                    </div>
                                </div>
                            )}
                        </For>
                    </Show>
                </div>
            </div>
        </div>
    </div>
)

export default BulkCardsEditor
