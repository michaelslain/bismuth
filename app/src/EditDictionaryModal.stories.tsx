// Visual spec for <EditDictionaryModal> — lists the user's custom Harper spellcheck
// dictionary words (right-click "Add to dictionary") and lets you remove/add one. Unlike
// the fetch-driven modals in this folder, it reads synchronously from localStorage on
// mount (`sortedWords()`, app/src/editor/harperStore.ts) — no backend round trip, no
// loading state — so the two stories below seed real state through the module's own
// public `addWord`/`removeWord` (never the raw localStorage key) before rendering.
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { EditDictionaryModal } from "./EditDictionaryModal";
import { addWord, removeWord, loadHarperState } from "./editor/harperStore";

const meta = {
  title: "Modals/EditDictionaryModal",
  component: EditDictionaryModal,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof EditDictionaryModal>;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = () => {};

/** Clears every word already in localStorage (leftover from a prior story navigation, or
 *  real local dev use of this same browser profile) so each story starts from a known state. */
function resetWords(): void {
  for (const w of loadHarperState().words) removeWord(w);
}

/** Empty dictionary — the "right-click a misspelled word, or add one below" empty state. */
export const Empty: Story = {
  render: () => {
    resetWords();
    return <EditDictionaryModal onClose={noop} />;
  },
};

/** A handful of custom words, alphabetized — the everyday populated state, each removable
 *  via its row's trash button. */
export const Populated: Story = {
  render: () => {
    resetWords();
    for (const w of ["bismuth", "milkdown", "solidjs", "wikilink"]) addWord(w);
    return <EditDictionaryModal onClose={noop} />;
  },
};
