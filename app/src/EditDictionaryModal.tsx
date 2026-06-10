// app/src/EditDictionaryModal.tsx
// Edit the user's CUSTOM Harper spellcheck dictionary: list the words you've added
// (via right-click "Add to dictionary") and remove ones you no longer want suppressed,
// or add a new one. Only the user's words are ever listed or editable — Harper's
// built-in curated dictionary is never exposed (loadHarperState().words holds only the
// user's words; harper.js exportWords() likewise excludes the curated set).
import { createSignal, For, Show } from "solid-js";
import { Modal } from "./ui/Modal";
import { Icon } from "./icons/Icon";
import { IconButton } from "./ui/IconButton";
import { IconTextButton } from "./ui/IconTextButton";
import { TextButton } from "./ui/TextButton";
import { TextInput } from "./ui/TextInput";
import { loadHarperState, normalizeDictWord } from "./editor/harperStore";
import { addDictionaryWord, removeDictionaryWord } from "./editor/harper";
import "./EditDictionaryModal.css";

/** The user's custom words, alphabetized for a stable, scannable list. */
const sortedWords = (): string[] =>
  loadHarperState().words.slice().sort((a, b) => a.localeCompare(b));

export function EditDictionaryModal(props: { onClose: () => void }) {
  const [words, setWords] = createSignal<string[]>(sortedWords());
  const [draft, setDraft] = createSignal("");

  const remove = (w: string): void => {
    void removeDictionaryWord(w); // persist + re-sync live linter + re-lint open notes
    setWords(sortedWords());
  };

  const add = (): void => {
    const w = normalizeDictWord(draft());
    if (!w) return;
    void addDictionaryWord(w); // persist + import into linter + re-lint open notes
    setDraft("");
    setWords(sortedWords());
  };

  return (
    <Modal onClose={props.onClose} class="dict-modal">
      <div class="dict-head">
        <div class="dict-mark"><Icon value="BookOpen" size={18} /></div>
        <div class="dict-htext">
          <div class="dict-title">Custom Dictionary</div>
          <div class="dict-sub">
            Words you've added are never flagged as misspelled. Remove one to spellcheck it again.
          </div>
        </div>
        <div class="dict-x" role="button" aria-label="Close" onClick={props.onClose}>
          <Icon value="x" size={16} />
        </div>
      </div>

      <div class="dict-body">
        <Show
          when={words().length}
          fallback={
            <div class="dict-empty">
              No custom words yet — right-click a misspelled word, or add one below.
            </div>
          }
        >
          <div class="dict-list">
            <For each={words()}>
              {(w) => (
                <div class="dict-row">
                  <span class="dict-word">{w}</span>
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

        <div class="dict-add">
          <TextInput
            placeholder="Add a word…"
            value={draft()}
            onInput={setDraft}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <IconTextButton icon="Plus" size="sm" variant="selected" onClick={add} disabled={!draft().trim()}>
            ADD
          </IconTextButton>
        </div>
      </div>

      <div class="dict-foot">
        <span class="dict-hint"><b>esc</b> to close</span>
        <div class="dict-sp" />
        <TextButton size="sm" variant="selected" onClick={props.onClose}>DONE</TextButton>
      </div>
    </Modal>
  );
}
