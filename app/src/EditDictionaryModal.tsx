// app/src/EditDictionaryModal.tsx
// Edit the user's CUSTOM Harper spellcheck dictionary: list the words you've added
// (via right-click "Add to dictionary") and remove ones you no longer want suppressed,
// or add a new one. Only the user's words are ever listed or editable — Harper's
// built-in curated dictionary is never exposed (loadHarperState().words holds only the
// user's words; harper.js exportWords() likewise excludes the curated set).
import { createSignal, For, Show } from 'solid-js'
import { Modal } from './ui/Modal'
import { Icon } from './icons/Icon'
import { IconButton } from './ui/IconButton'
import { IconTextButton } from './ui/IconTextButton'
import { TextButton } from './ui/TextButton'
import { TextInput } from './ui/TextInput'
import Text from './ui/Text'
import { loadHarperState, normalizeDictWord } from './editor/harperStore'
import { addDictionaryWord, removeDictionaryWord } from './editor/harper'
import { isConfirmKey } from './ui/widgetKeys'
import styles from './EditDictionaryModal.module.css'

/** The user's custom words, alphabetized for a stable, scannable list. */
const sortedWords = (): string[] =>
    loadHarperState()
        .words.slice()
        .sort((a, b) => a.localeCompare(b))

export function EditDictionaryModal(props: { onClose: () => void }) {
    const [words, setWords] = createSignal<string[]>(sortedWords())
    const [draft, setDraft] = createSignal('')

    const remove = (w: string): void => {
        void removeDictionaryWord(w) // persist + re-sync live linter + re-lint open notes
        setWords(sortedWords())
    }

    const add = (): void => {
        const w = normalizeDictWord(draft())
        if (!w) return
        void addDictionaryWord(w) // persist + import into linter + re-lint open notes
        setDraft('')
        setWords(sortedWords())
    }

    return (
        <Modal onClose={props.onClose} class={styles['dict-modal']}>
            <div class={styles['dict-head']}>
                <div class={styles['dict-mark']}>
                    <Icon value="BookOpen" size={18} />
                </div>
                <div class={styles['dict-htext']}>
                    <div class={styles['dict-title']}>Custom Dictionary</div>
                    <div class={styles['dict-sub']}>
                        Words you've added are never flagged as misspelled.
                        Remove one to spellcheck it again.
                    </div>
                </div>
                <IconButton
                    class={styles['dict-x']}
                    icon="X"
                    label="Close"
                    size="sm"
                    onClick={props.onClose}
                />
            </div>

            <div class={styles['dict-body']}>
                <Show
                    when={words().length}
                    fallback={
                        <div class={styles['dict-empty']}>
                            No custom words yet — right-click a misspelled word,
                            or add one below.
                        </div>
                    }
                >
                    <div class={styles['dict-list']}>
                        <For each={words()}>
                            {w => (
                                <div class={styles['dict-row']}>
                                    <Text
                                        as="span"
                                        size="inherit"
                                        tone="inherit"
                                        weight="inherit"
                                        class={styles['dict-word']}
                                    >
                                        {w}
                                    </Text>
                                    <IconButton
                                        icon="Trash2"
                                        label={`Remove “${w}”`}
                                        danger
                                        size="sm"
                                        iconSize={15}
                                        onClick={() => remove(w)}
                                    />
                                </div>
                            )}
                        </For>
                    </div>
                </Show>

                <div class={styles['dict-add']}>
                    <TextInput
                        placeholder="Add a word…"
                        value={draft()}
                        onInput={setDraft}
                        onKeyDown={e => {
                            if (isConfirmKey(e)) {
                                e.preventDefault()
                                add()
                            }
                        }}
                    />
                    <IconTextButton
                        icon="Plus"
                        size="sm"
                        variant="selected"
                        onClick={add}
                        disabled={!draft().trim()}
                    >
                        ADD
                    </IconTextButton>
                </div>
            </div>

            <div class={styles['dict-foot']}>
                <Text
                    as="span"
                    size="inherit"
                    tone="inherit"
                    weight="inherit"
                    class={styles['dict-hint']}
                >
                    <b>esc</b> to close
                </Text>
                <div class={styles['dict-sp']} />
                <TextButton
                    size="sm"
                    variant="selected"
                    onClick={props.onClose}
                >
                    DONE
                </TextButton>
            </div>
        </Modal>
    )
}
