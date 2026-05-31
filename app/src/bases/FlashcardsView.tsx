import { createSignal, createMemo, Show } from "solid-js";
import { api } from "../api";
import { renderMarkdown } from "./markdown";
import type { BaseConfig, Row } from "../../../core/src/bases/types";

/**
 * Flashcards view over a base's rows. Cards are table rows (front/back/due/ease/interval).
 * Reviewing flips the card to the back (with the front kept as a small caption) and writes
 * SM-2 scheduling back to the base file. Card faces render markdown (Lora serif; `code` mono).
 *
 * Operates on raw rows in table order (index === array position) so write-back targets the
 * right row without threading an identity through runView.
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
  const frontHtml = (r: Row) => renderMarkdown(String(r.note[frontField()] ?? ""));
  const backHtml = (r: Row) => renderMarkdown(String(r.note[backField()] ?? ""));

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

            {/* Click the card to flip; flipped face shows the back, with the front as a small caption. */}
            <div
              class={`flip-card ${revealed() ? "flipped" : ""}`}
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
