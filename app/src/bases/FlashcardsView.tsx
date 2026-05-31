import { createSignal, createMemo, Show, For } from "solid-js";
import { api } from "../api";
import { renderMarkdown } from "./markdown";
import type { BaseConfig, Row } from "../../../core/src/bases/types";

/**
 * Flashcards view over a base's rows. Cards are table rows (front/back/due/ease/interval).
 * Reviewing flips to the back (front kept as a small caption) and writes fixed-SM-2 scheduling
 * back to the row. Cram mode reviews ALL cards ignoring due dates and never changes scheduling.
 * Faces render markdown (Lora serif; `code` monospace).
 *
 * Animation: the 3D flip (rotateY) only plays when revealing the SAME card (front -> back on
 * "Show answer"). Advancing to a NEW card remounts the card element (keyed by row index), so it
 * resets to the front instantly and plays a crisp scale+fade entrance instead of flipping backward.
 */
export function FlashcardsView(props: {
  rows: Row[];
  config: BaseConfig;
  basePath?: string;
  onReviewed: () => void;
}) {
  const view = () => props.config.views[0] ?? { type: "flashcards", name: "" };
  const frontField = () => view().frontField ?? "front";
  const backField = () => view().backField ?? "back";
  const dueField = () => view().dueField ?? "due";
  const today = new Date().toISOString().slice(0, 10);

  const [cram, setCram] = createSignal(false);

  // The review queue: due cards normally; ALL cards in cram mode (order preserved).
  const queue = createMemo(() => {
    const all = props.rows.map((r, index) => ({ r, index }));
    if (cram()) return all;
    return all.filter(({ r }) => {
      const d = r.note[dueField()];
      return d == null || d === "" || String(d) <= today;
    });
  });

  const [pos, setPos] = createSignal(0);
  const [revealed, setRevealed] = createSignal(false);

  const current = () => (pos() < queue().length ? queue()[pos()] : null);
  const frontHtml = (r: Row) => renderMarkdown(String(r.note[frontField()] ?? ""));
  const backHtml = (r: Row) => renderMarkdown(String(r.note[backField()] ?? ""));

  const grade = async (response: "hard" | "good" | "easy") => {
    const c = current();
    if (!c) return;
    // Cram mode never writes scheduling — it's practice, not review.
    if (!cram() && props.basePath) await api.reviewCardRow(props.basePath, c.index, response);
    setRevealed(false);
    setPos(pos() + 1);
    if (!cram()) props.onReviewed();
  };

  const restart = () => {
    setPos(0);
    setRevealed(false);
    if (!cram()) props.onReviewed();
  };

  const toggleCram = () => {
    setCram(!cram());
    setPos(0);
    setRevealed(false);
  };

  // ── Add / delete card UI ──────────────────────────────────────────────
  const [adding, setAdding] = createSignal(false);
  const [draftFront, setDraftFront] = createSignal("");
  const [draftBack, setDraftBack] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  const openAdd = () => {
    setDraftFront("");
    setDraftBack("");
    setAdding(true);
  };

  const saveAdd = async () => {
    if (!props.basePath || busy()) return;
    const front = draftFront().trim();
    const back = draftBack().trim();
    if (!front && !back) {
      setAdding(false);
      return;
    }
    setBusy(true);
    try {
      await api.rowCreate(props.basePath, { [frontField()]: front, [backField()]: back });
      setAdding(false);
      props.onReviewed();
    } finally {
      setBusy(false);
    }
  };

  const deleteCurrent = async () => {
    const c = current();
    if (!c || !props.basePath || busy()) return;
    if (!confirm("Delete this card?")) return;
    setBusy(true);
    try {
      await api.rowDelete(props.basePath, c.index);
      setRevealed(false);
      // Stay at the same position; the queue shifts the next card into place.
      props.onReviewed();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="flashcards-host">
      <div class="srs-bar">
        <Show when={props.basePath}>
          <button class="srs-icon-btn" title="Add a card" onClick={openAdd} disabled={busy()}>
            + Add card
          </button>
          <Show when={current() !== null}>
            <button
              class="srs-icon-btn danger"
              title="Delete the current card"
              onClick={deleteCurrent}
              disabled={busy()}
            >
              ✕
            </button>
          </Show>
        </Show>
        <button
          class={`cram-toggle ${cram() ? "on" : ""}`}
          title="Cram: review every card, no scheduling changes"
          onClick={toggleCram}
        >
          {cram() ? "● Cram mode" : "Cram"}
        </button>
      </div>

      <Show when={adding()}>
        <div class="card-add-form">
          <label class="card-add-field">
            <span>Front</span>
            <textarea
              autofocus
              value={draftFront()}
              onInput={(e) => setDraftFront(e.currentTarget.value)}
              placeholder="Question / prompt…"
            />
          </label>
          <label class="card-add-field">
            <span>Back</span>
            <textarea
              value={draftBack()}
              onInput={(e) => setDraftBack(e.currentTarget.value)}
              placeholder="Answer…"
            />
          </label>
          <div class="card-add-actions">
            <button class="card-btn" onClick={() => setAdding(false)} disabled={busy()}>
              Cancel
            </button>
            <button class="card-btn good" onClick={saveAdd} disabled={busy()}>
              Save card
            </button>
          </div>
        </div>
      </Show>

      <Show
        when={queue().length > 0}
        fallback={
          <div class="review-done">
            <h2>{cram() ? "No cards in this deck" : "No cards due"}</h2>
            <p class="deck-empty">
              <Show when={!cram()} fallback={<>Add rows with <code>front</code> / <code>back</code> columns.</>}>
                Nothing due — hit <strong>Cram</strong> above to review everything anyway.
              </Show>
            </p>
          </div>
        }
      >
        <Show
          when={current() !== null}
          fallback={
            <div class="review-done">
              <h2>{cram() ? "Cram complete" : "Done reviewing"}</h2>
              <button class="card-btn" onClick={restart}>Review again</button>
            </div>
          }
        >
          <div class="review">
            <div class="review-progress">
              {pos() + 1} / {queue().length}
              <Show when={cram()}> · cram (not scheduled)</Show>
            </div>

            {/*
              Keyed by the row index via <For> over a single-element array: <For> reconciles by
              item value, so when the current card's index changes the element is disposed and a
              fresh one is created (instant reset to front + entrance anim). When only the row data
              refreshes (same index) the value is unchanged, so it does NOT remount. The flip is a
              transform transition on the persistent element, so it only animates when toggling
              `revealed` on the SAME (already-mounted) card — never a backward flip between cards.
            */}
            <For each={[current()!.index]}>
              {() => (
                <div
                  class={`flip-card card-appear ${revealed() ? "flipped" : ""}`}
                  onClick={() => !revealed() && setRevealed(true)}
                >
                  <div class="flip-inner">
                    <div class="flip-face flip-front">
                      <div class="card-md" innerHTML={frontHtml(current()!.r)} />
                    </div>
                    <div class="flip-face flip-back">
                      <div class="card-front-label" innerHTML={frontHtml(current()!.r)} />
                      <div class="card-md" innerHTML={backHtml(current()!.r)} />
                    </div>
                  </div>
                </div>
              )}
            </For>

            <Show
              when={revealed()}
              fallback={<button class="reveal-btn" onClick={() => setRevealed(true)}>Show answer</button>}
            >
              <div class="grade-row">
                <button class="card-btn hard" onClick={() => grade("hard")}>Hard</button>
                <button class="card-btn good" onClick={() => grade("good")}>Good</button>
                <button class="card-btn easy" onClick={() => grade("easy")}>Easy</button>
              </div>
            </Show>
          </div>
        </Show>
      </Show>
    </div>
  );
}
