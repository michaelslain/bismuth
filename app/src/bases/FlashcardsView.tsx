import { createSignal, createMemo, For, Show } from "solid-js";
import { api } from "../api";
import { renderMarkdown } from "./markdown";
import { DEFAULT_SRS_CONFIG, resolveSrsConfig } from "../../../core/src/srs/scheduler";
import type { SrsConfig } from "../../../core/src/srs/types";
import type { BaseConfig, Row } from "../../../core/src/bases/types";

// Editable SRS params, with friendly labels and (for ease/bonus) a display scale.
const SRS_FIELDS: { key: keyof SrsConfig; label: string }[] = [
  { key: "newGoodInterval", label: "New interval · Good (days)" },
  { key: "newEasyInterval", label: "New interval · Easy (days)" },
  { key: "baseEase", label: "Starting ease (e.g. 250 = 2.5×)" },
  { key: "easeStep", label: "Ease step (±)" },
  { key: "minEase", label: "Minimum ease" },
  { key: "easyBonus", label: "Easy bonus (×)" },
  { key: "hardFactor", label: "Hard interval factor (×)" },
  { key: "maxInterval", label: "Max interval (days)" },
];

/**
 * Flashcards view over a base's rows. Cards are table rows (front/back/due/ease/interval).
 * Reviewing flips to the back (front kept as a small caption) and writes SM-2 scheduling back
 * to the row, using this deck's SRS settings. The ⚙ panel edits those settings (persisted to
 * the base's `srs:` frontmatter). Faces render markdown (Lora serif; `code` monospace).
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

  // --- SRS settings panel ---
  const [showSettings, setShowSettings] = createSignal(false);
  const [form, setForm] = createSignal<SrsConfig>(DEFAULT_SRS_CONFIG);
  const openSettings = () => {
    setForm(resolveSrsConfig(props.config.srs));
    setShowSettings(true);
  };
  const setField = (key: keyof SrsConfig, raw: string) => {
    const n = Number(raw);
    if (Number.isFinite(n)) setForm({ ...form(), [key]: n });
  };
  const saveSettings = async () => {
    if (props.basePath) await api.setProperty(props.basePath, "srs", form());
    setShowSettings(false);
    props.onReviewed();
  };

  return (
    <div class="flashcards-host">
      <div class="srs-bar">
        <Show when={props.basePath}>
          <button class="srs-gear" title="Spaced-repetition settings" onClick={openSettings}>⚙ SRS</button>
        </Show>
      </div>

      <Show when={showSettings()}>
        <div class="srs-panel">
          <h3>Spaced-repetition settings</h3>
          <div class="srs-grid">
            <For each={SRS_FIELDS}>
              {(f) => (
                <label class="srs-field">
                  <span>{f.label}</span>
                  <input
                    type="number"
                    step="any"
                    value={form()[f.key]}
                    onInput={(e) => setField(f.key, e.currentTarget.value)}
                  />
                </label>
              )}
            </For>
          </div>
          <div class="grade-row">
            <button class="card-btn" onClick={() => setForm(DEFAULT_SRS_CONFIG)}>Reset to defaults</button>
            <button class="card-btn good" onClick={saveSettings}>Save</button>
            <button class="card-btn" onClick={() => setShowSettings(false)}>Cancel</button>
          </div>
        </div>
      </Show>

      <Show when={!showSettings()}>
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
      </Show>
    </div>
  );
}
