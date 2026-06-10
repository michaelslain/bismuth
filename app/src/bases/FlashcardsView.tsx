import { createSignal, createMemo, onMount, onCleanup, Show, For } from "solid-js";
import { api } from "../api";
import { TextButton } from "../ui/TextButton";
import { IconButton } from "../ui/IconButton";
import { IconTextButton } from "../ui/IconTextButton";
import { Icon } from "../icons/Icon";
import { EmptyState } from "../ui/EmptyState";
import { Modal } from "../ui/Modal";
import { TextInput } from "../ui/TextInput";
import { renderMarkdown } from "./markdown";
import { EditCardsModal } from "./EditCardsModal";
import type { BaseConfig, Row } from "../../../core/src/bases/types";
import { fileBasename } from "../../../core/src/pathUtils";
import { todayISO } from "../../../core/src/dates";

// Pure review-queue logic lives in its own module so it can be unit-tested headlessly
// without importing this component (lucide-solid icons, Solid client-only code). Import
// for local use, and re-export to preserve the existing `./FlashcardsView` public surface.
import { buildQueue, nextPosAfterGrade, backField as revScheduleCol, type QueueItem, type CardDir } from "./flashcardsQueue";
export { buildQueue, nextPosAfterGrade, type QueueItem, type CardDir };

/** Grade → digit shown on the key badge / bound to the number keys (1-3). */
const GRADE_KEYS: { response: "hard" | "good" | "easy"; key: string; cls: string }[] = [
  { response: "hard", key: "1", cls: "hard" },
  { response: "good", key: "2", cls: "good" },
  { response: "easy", key: "3", cls: "easy" },
];

/**
 * Flashcards view over a base's rows. Cards are table rows (front/back/due/ease/interval).
 * Reviewing flips to the back (front kept as a small italic caption) and writes fixed-SM-2
 * scheduling back to the row. Cram mode reviews ALL cards ignoring due dates and never changes
 * scheduling. Faces render markdown (Lora serif; `code` monospace).
 *
 * Layout follows the "claude-design" handoff: a header strip with a gradient progress bar +
 * GOOD/HARD session tally and deck controls (edit cards, cram), then a centered stage holding
 * the flip card and a per-grade-accented grade row. Keyboard: Space reveals, 1/2/3 grade.
 *
 * Animation: the 3D flip (rotateY) only plays when revealing the SAME card (front -> back on
 * "Show answer"). Advancing to a NEW card remounts the card element (keyed by row index + dir),
 * so it resets to the front instantly and plays a crisp scale+fade entrance instead of flipping
 * backward.
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
  const easeField = () => view().easeField ?? "ease";
  const intervalField = () => view().intervalField ?? "interval";
  const bidirectional = () => !!view().bidirectional;

  const [cram, setCram] = createSignal(false);

  // The review queue: due cards normally; ALL cards in cram mode (order preserved).
  // Bidirectional decks emit a forward + reverse entry per row (see flashcardsQueue).
  // `today` is derived inside the memo via todayISO() so it's the LOCAL date and is
  // re-evaluated on every recompute (not captured once at mount, in UTC).
  const queue = createMemo(() => buildQueue(props.rows, dueField(), todayISO(), cram(), bidirectional()));

  const [pos, setPos] = createSignal(0);
  const [revealed, setRevealed] = createSignal(false);

  // Per-session tally for the header strip. GOOD = good|easy presses, HARD = hard presses.
  const [goodCount, setGoodCount] = createSignal(0);
  const [hardCount, setHardCount] = createSignal(0);

  const current = () => (pos() < queue().length ? queue()[pos()] : null);
  // Progress through the deck for this session: how many graded so far over the
  // starting due count. The queue shrinks as cards are scheduled out, so anchor the
  // total to graded + remaining.
  const graded = () => goodCount() + hardCount();
  const total = () => graded() + queue().length;
  const progressPct = () => {
    const t = total();
    return t === 0 ? 0 : (graded() / t) * 100;
  };

  // Prompt = the side being asked; answer = the side revealed. For a reverse card the
  // back column is the prompt and the front column is the answer.
  const promptCol = (it: QueueItem) => (it.dir === "fwd" ? frontField() : backField());
  const answerCol = (it: QueueItem) => (it.dir === "fwd" ? backField() : frontField());
  const promptHtml = (it: QueueItem) => renderMarkdown(String(it.r.note[promptCol(it)] ?? ""));
  const answerHtml = (it: QueueItem) => renderMarkdown(String(it.r.note[answerCol(it)] ?? ""));

  // Which scheduling columns a direction advances: forward uses the base triple,
  // reverse uses the `*Back` companions so each direction is scheduled independently.
  const scheduleFields = (dir: CardDir) =>
    dir === "fwd"
      ? { due: dueField(), ease: easeField(), interval: intervalField() }
      : { due: revScheduleCol(dueField()), ease: revScheduleCol(easeField()), interval: revScheduleCol(intervalField()) };

  const grade = async (response: "hard" | "good" | "easy") => {
    const c = current();
    if (!c || !revealed()) return;
    setRevealed(false);
    if (response === "hard") setHardCount((n) => n + 1);
    else setGoodCount((n) => n + 1);
    // Cram mode never writes scheduling — it's practice, not review.
    const persisted = !cram() && !!props.basePath;
    // Track the card by its stable row index (c.index), not the positional queue
    // offset: reviewCardRow pushes the card's due date forward so it drops out of
    // the due-only queue on the onReviewed refetch. The shorter queue shifts the
    // next card into the current pos, so we stay put (mirrors deleteCurrent)
    // rather than incrementing into a queue whose membership just changed.
    if (persisted) await api.reviewCardRow(props.basePath!, c.index, response, scheduleFields(c.dir));
    setPos(nextPosAfterGrade(pos(), { cram: cram(), persisted }));
    if (!cram()) props.onReviewed();
  };

  const restart = () => {
    setPos(0);
    setRevealed(false);
    setGoodCount(0);
    setHardCount(0);
    if (!cram()) props.onReviewed();
  };

  const toggleCram = () => {
    setCram(!cram());
    setPos(0);
    setRevealed(false);
    setGoodCount(0);
    setHardCount(0);
  };

  // ── Deck-wide "Cards" modal (browse / add / edit / delete every card) ──
  const [editing, setEditing] = createSignal(false);

  // ── Per-card actions, on the card itself: edit this card / delete this card ──
  const [editingCard, setEditingCard] = createSignal(false);
  const [cardFront, setCardFront] = createSignal("");
  const [cardBack, setCardBack] = createSignal("");

  const openCardEdit = () => {
    const c = current();
    if (!c) return;
    setCardFront(String(c.r.note[frontField()] ?? ""));
    setCardBack(String(c.r.note[backField()] ?? ""));
    setEditingCard(true);
  };

  const saveCardEdit = async () => {
    const c = current();
    if (!c || !props.basePath) return;
    await api.rowUpdate(props.basePath, c.index, { ...c.r.note, [frontField()]: cardFront(), [backField()]: cardBack() });
    setEditingCard(false);
    props.onReviewed();
  };

  // Delete the current card and advance: rowDelete drops it from the base, the
  // onReviewed refetch shrinks the queue, and the next card shifts into this pos
  // (so we stay put — same as grading a card out of the due queue).
  const deleteCurrent = async () => {
    const c = current();
    if (!c || !props.basePath) return;
    setRevealed(false);
    await api.rowDelete(props.basePath, c.index);
    props.onReviewed();
  };

  // Edit/delete icons rendered on BOTH card faces so they flip with the card.
  // stopPropagation keeps a click on them from triggering the card's reveal flip.
  const cardActions = () => (
    <div class="card-actions" onClick={(e) => e.stopPropagation()}>
      <IconButton icon="Pencil" label="Edit this card" iconSize={13} onClick={openCardEdit} />
      <IconButton icon="Trash2" label="Delete this card" iconSize={13} onClick={deleteCurrent} />
    </div>
  );

  // ── Keyboard: Space reveals, 1/2/3 grade. Ignored while the edit modal is
  // open or focus is in a text field, so it never fights typing. ──────────
  const onKey = (e: KeyboardEvent) => {
    if (editing() || editingCard()) return;
    const el = e.target as HTMLElement | null;
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
    if (!current()) return;
    if (e.code === "Space") {
      e.preventDefault();
      if (!revealed()) setRevealed(true);
      return;
    }
    if (revealed()) {
      const g = GRADE_KEYS.find((x) => x.key === e.key);
      if (g) {
        e.preventDefault();
        void grade(g.response);
      }
    }
  };
  onMount(() => window.addEventListener("keydown", onKey));
  onCleanup(() => window.removeEventListener("keydown", onKey));

  return (
    <div class="flashcards-host">
      <div class="revhead">
        <div class="progress">
          <div class="count">
            <b>{Math.min(graded() + 1, total())}</b> / {total()}
            <Show when={bidirectional() && current()}>
              {" · "}
              <span class="card-dir">{current()!.dir === "fwd" ? "front → back" : "back → front"}</span>
            </Show>
            <Show when={cram()}> · cram</Show>
          </div>
          <div class="fcbar">
            <i style={{ width: `${progressPct()}%` }} />
          </div>
          <div class="tally">
            <span class="g">GOOD <b>{goodCount()}</b></span>
            <span class="a">HARD <b>{hardCount()}</b></span>
          </div>
        </div>

        <div class="deckctrls">
          <Show when={props.basePath}>
            <IconTextButton
              icon="Layers"
              iconSize={13}
              variant="unselected"
              title="Browse, add, edit, and delete every card in this deck"
              onClick={() => setEditing(true)}
            >
              CARDS
            </IconTextButton>
          </Show>
          <IconTextButton
            icon="Zap"
            iconSize={13}
            variant={cram() ? "selected" : "unselected"}
            title="Cram: review every card, no scheduling changes"
            onClick={toggleCram}
          >
            CRAM
          </IconTextButton>
        </div>
      </div>

      <Show when={editing() && props.basePath}>
        <EditCardsModal
          rows={props.rows}
          basePath={props.basePath!}
          deckName={fileBasename(props.basePath!)}
          frontField={frontField()}
          backField={backField()}
          onClose={() => setEditing(false)}
          onChanged={() => props.onReviewed()}
        />
      </Show>

      <div class="stage">
        <Show
          when={queue().length > 0}
          fallback={
            <EmptyState title={cram() ? "No cards in this deck" : "No cards due"}>
              <Show when={!cram()} fallback={<>Add rows with <code>front</code> / <code>back</code> columns.</>}>
                Hit the <span class="inline-bolt"><Icon value="Zap" size={14} /></span> button to review everything anyway.
              </Show>
            </EmptyState>
          }
        >
          <Show
            when={current() !== null}
            fallback={
              <div class="done">
                <div class="big">{cram() ? "Cram complete" : "Deck complete"}</div>
                <div class="sub">
                  You reviewed <b>{graded()}</b> {graded() === 1 ? "card" : "cards"}
                  <Show when={goodCount() > 0}> · <span class="good-text">good</span> on most</Show>.
                </div>
                <TextButton size="lg" onClick={restart}>REVIEW AGAIN</TextButton>
              </div>
            }
          >
            <div class="cardwrap">
              {/*
                Keyed by row index + direction via <For> over a single-element array: <For> reconciles
                by item value, so when the current card's index OR direction changes the element is
                disposed and a fresh one is created (instant reset to front + entrance anim). Keying on
                direction too means a bidirectional row's forward→reverse hand-off remounts cleanly
                instead of flipping backward. When only the row data refreshes (same index+dir) the
                value is unchanged, so it does NOT remount. The flip is a transform transition on the
                persistent element, so it only animates when toggling `revealed` on the SAME card.
              */}
              <For each={[`${current()!.index}:${current()!.dir}`]}>
                {() => (
                  <div
                    class={`flip-card card-appear ${revealed() ? "flipped" : ""}`}
                    onClick={() => !revealed() && setRevealed(true)}
                  >
                    <div class="flip-inner">
                      <div class="flip-face flip-front">
                        <Show when={props.basePath}>{cardActions()}</Show>
                        <div class="card-md" innerHTML={promptHtml(current()!)} />
                        <div class="fliphint"><span class="key">Space</span> to reveal answer</div>
                      </div>
                      <div class="flip-face flip-back">
                        <Show when={props.basePath}>{cardActions()}</Show>
                        <div class="qcaption" innerHTML={promptHtml(current()!)} />
                        <div class="fcdiv" />
                        <div class="card-md abody" innerHTML={answerHtml(current()!)} />
                      </div>
                    </div>
                  </div>
                )}
              </For>
            </div>

            <Show when={revealed()}>
              <div class="grade-row">
                <For each={GRADE_KEYS}>
                  {(g) => (
                    <button class={`grade ${g.cls}`} onClick={() => grade(g.response)}>
                      <span class="g-key">{g.key}</span>
                      <span class="g-name">{g.response}</span>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </Show>
      </div>

      <Show when={editingCard() && props.basePath}>
        <Modal onClose={() => setEditingCard(false)} class="cards-modal card-edit-one">
          <div class="cards-head">
            <h2 class="cards-title">Edit card</h2>
            <div class="sp" />
            <IconButton icon="X" label="Close" onClick={() => setEditingCard(false)} />
          </div>
          <div class="card-edit-one-body">
            <label class="card-edit-labeled">
              <span>Front</span>
              <TextInput
                multiline
                class="card-edit-field"
                value={cardFront()}
                placeholder="Front / prompt…"
                onInput={setCardFront}
              />
            </label>
            <label class="card-edit-labeled">
              <span>Back</span>
              <TextInput
                multiline
                class="card-edit-field"
                value={cardBack()}
                placeholder="Back / answer…"
                onInput={setCardBack}
              />
            </label>
            <div class="card-edit-one-actions">
              <TextButton onClick={() => setEditingCard(false)}>CANCEL</TextButton>
              <TextButton variant="selected" onClick={saveCardEdit}>SAVE</TextButton>
            </div>
          </div>
        </Modal>
      </Show>
    </div>
  );
}
