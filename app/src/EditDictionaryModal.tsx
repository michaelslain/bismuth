// app/src/EditDictionaryModal.tsx
// Edit the user's CUSTOM Harper spellcheck dictionary: list the words you've added
// (via right-click "Add to dictionary") and remove ones you no longer want suppressed,
// or add a new one. Only the user's words are ever listed or editable — Harper's
// built-in curated dictionary is never exposed (loadHarperState().words holds only the
// user's words; harper.js exportWords() likewise excludes the curated set).
import { createSignal, For, Show } from 'solid-js'
import FormModal from './ui/FormModal'
import ModalHeader from './ui/ModalHeader'
import ModalBody from './ui/ModalBody'
import ModalFooter from './ui/ModalFooter'
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
        <FormModal width={460} label="custom dictionary" onClose={props.onClose}>
            <ModalHeader
                title="custom dictionary"
                subtitle="won't be flagged as misspelled"
                onClose={props.onClose}
            />

            <ModalBody>
                <Show
                    when={words().length}
                    fallback={
                        <Text as="div" size="ui" tone="faint" class={styles['dict-empty']}>
                            no custom words yet — right-click a misspelled word,
                            or add one below
                        </Text>
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
                        class={styles['dict-input']}
                        placeholder="add a word…"
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
                        primary
                        onClick={add}
                        disabled={!draft().trim()}
                    >
                        add
                    </IconTextButton>
                </div>
            </ModalBody>

            <ModalFooter hint="close">
                <TextButton onClick={props.onClose}>done</TextButton>
            </ModalFooter>
        </FormModal>
    )
}
