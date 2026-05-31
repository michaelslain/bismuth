import { createSignal, createMemo, Show } from "solid-js";
import { api } from "../api";
import type { BaseConfig, Row } from "../../../core/src/bases/types";

/**
 * Flashcards view over a base's rows. Reads front/back/due from each row by the
 * view's field bindings (defaults front/back/due) and reviews due cards via SM-2,
 * writing scheduling columns back to the base file by table-row index.
 *
 * Operates on the raw rows in table order (index === array position), so review
 * write-back targets the correct row without threading an identity through runView.
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

  // Due = no due date yet, or due on/before today. Keep the original table index.
  const due = createMemo(() =>
    props.rows
      .map((r, index) => ({ r, index }))
      .filter(({ r }) => {
        const d = r.note[dueField()];
        return d == null || d === "" || String(d) <= today;
      }),
  );

  const [pos, setPos] = createSignal(0);
  const [revealed, setRevealed] = createSignal(false);

  const current = () => (pos() < due().length ? due()[pos()] : null);
  const frontOf = (r: Row) => String(r.note[frontField()] ?? "");
  const backOf = (r: Row) => String(r.note[backField()] ?? "");

  const grade = async (response: "hard" | "good" | "easy") => {
    const c = current();
    if (!c || !props.basePath) return;
    await api.reviewCardRow(props.basePath, c.index, response);
    setRevealed(false);
    setPos(pos() + 1);
    props.onReviewed();
  };

  const restart = () => {
    setPos(0);
    setRevealed(false);
    props.onReviewed();
  };

  return (
    <div class="flashcards-host">
      <Show
        when={due().length > 0}
        fallback={
          <div class="review-done">
            <h2>No cards due</h2>
            <p class="deck-empty">Add rows with <code>front</code> / <code>back</code> columns to this base.</p>
          </div>
        }
      >
        <Show
          when={current() !== null}
          fallback={
            <div class="review-done">
              <h2>Done reviewing</h2>
              <button class="card-btn" onClick={restart}>Review again</button>
            </div>
          }
        >
          <div class="review">
            <div class="review-progress">{pos() + 1} / {due().length}</div>
            <div class="card-face question">{frontOf(current()!.r)}</div>
            <Show
              when={revealed()}
              fallback={<button class="reveal-btn" onClick={() => setRevealed(true)}>Show answer</button>}
            >
              <div class="card-face answer">{backOf(current()!.r)}</div>
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
