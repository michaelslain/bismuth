import { createSignal, For, Show } from "solid-js";
import { Modal } from "../ui/Modal";
import { TextButton } from "../ui/TextButton";
import { IconButton } from "../ui/IconButton";
import type { Row } from "../../../core/src/bases/types";
import { api } from "../api";

/**
 * Card-management modal for a flashcard deck: edit, delete, and add cards in one
 * place (distinct from the deck's Bases settings). Operates directly on the
 * base's rows via the row API; each mutation calls `onChanged` so the parent
 * refetches and the list (and the underlying review queue) stay in sync.
 *
 * The list is driven straight off the reactive `rows` prop and the row's
 * positional index — the same stable index the review queue and the row API use
 * (rowUpdate/rowDelete are positional). Field edits commit on blur.
 */
export function EditCardsModal(props: {
  rows: Row[];
  basePath: string;
  frontField: string;
  backField: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = createSignal(false);
  const [draftFront, setDraftFront] = createSignal("");
  const [draftBack, setDraftBack] = createSignal("");

  const fieldText = (r: Row, field: string) => String(r.note[field] ?? "");

  // Commit one edited field if it actually changed. Index is the row's position
  // in the base (matches the review queue's stable index).
  const commit = async (r: Row, index: number, field: string, value: string) => {
    if (value === fieldText(r, field) || busy()) return;
    setBusy(true);
    try {
      await api.rowUpdate(props.basePath, index, { ...r.note, [field]: value });
      props.onChanged();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (index: number) => {
    if (busy()) return;
    setBusy(true);
    try {
      await api.rowDelete(props.basePath, index);
      props.onChanged();
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const front = draftFront().trim();
    const back = draftBack().trim();
    if ((!front && !back) || busy()) return;
    setBusy(true);
    try {
      await api.rowCreate(props.basePath, { [props.frontField]: front, [props.backField]: back });
      setDraftFront("");
      setDraftBack("");
      props.onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={props.onClose} class="cards-modal">
      <div class="cards-modal-head">
        <h2>Edit cards</h2>
        <IconButton icon="X" label="Close" onClick={props.onClose} />
      </div>

      <div class="cards-modal-list">
        <Show
          when={props.rows.length > 0}
          fallback={<p class="cards-modal-empty">No cards yet — add one below.</p>}
        >
          <For each={props.rows}>
            {(r, i) => (
              <div class="card-edit-row">
                <span class="card-edit-num">{i() + 1}</span>
                <div class="card-edit-fields">
                  <textarea
                    class="card-edit-field"
                    value={fieldText(r, props.frontField)}
                    placeholder="Front / prompt…"
                    onBlur={(e) => commit(r, i(), props.frontField, e.currentTarget.value)}
                  />
                  <textarea
                    class="card-edit-field"
                    value={fieldText(r, props.backField)}
                    placeholder="Back / answer…"
                    onBlur={(e) => commit(r, i(), props.backField, e.currentTarget.value)}
                  />
                </div>
                <IconButton
                  icon="Trash2"
                  label="Delete card"
                  danger
                  disabled={busy()}
                  onClick={() => remove(i())}
                />
              </div>
            )}
          </For>
        </Show>
      </div>

      <div class="cards-modal-add">
        <div class="card-edit-fields">
          <textarea
            class="card-edit-field"
            value={draftFront()}
            placeholder="New card front…"
            onInput={(e) => setDraftFront(e.currentTarget.value)}
          />
          <textarea
            class="card-edit-field"
            value={draftBack()}
            placeholder="New card back…"
            onInput={(e) => setDraftBack(e.currentTarget.value)}
          />
        </div>
        <TextButton size="lg" onClick={add} disabled={busy()}>
          ADD CARD
        </TextButton>
      </div>
    </Modal>
  );
}
