import { createSignal, createEffect, Show } from "solid-js";
import { api } from "./api";
import { TextButton } from "./ui/TextButton";
import { EmptyState, Loading } from "./ui/EmptyState";
import type { Card } from "../../core/src/srs/types";

/** Focused review of the flashcards in a single note. */
export function Flashcards(props: { note: string }) {
  const [cards, setCards] = createSignal<Card[]>([]);
  const [idx, setIdx] = createSignal(0);
  const [revealed, setRevealed] = createSignal(false);
  const [loading, setLoading] = createSignal(true);

  const loadCards = async () => {
    setLoading(true);
    setCards(await api.noteCards(props.note));
    setIdx(0);
    setRevealed(false);
    setLoading(false);
  };

  // Re-load whenever the target note changes (the same component instance is reused
  // when switching between two per-note flashcard tabs).
  createEffect(() => {
    props.note;
    loadCards();
  });

  const current = () => (idx() < cards().length ? cards()[idx()] : null);
  const noteName = () => props.note.split("/").pop()!.replace(/\.md$/, "");

  const grade = async (response: "hard" | "good" | "easy") => {
    const c = current();
    if (!c) return;
    await api.reviewCard(c.id, response, c.question);
    setRevealed(false);
    setIdx(idx() + 1);
  };

  return (
    <div class="flashcards-host">
      <Show when={!loading()} fallback={<Loading />}>
        <Show
          when={cards().length > 0}
          fallback={
            <EmptyState title={`No flashcards in “${noteName()}”`}>
              Add cards to this note like <code>question::answer</code>, or a multi-line card with{" "}
              <code>?</code> on its own line.
            </EmptyState>
          }
        >
          <Show
            when={current() !== null}
            fallback={
              <EmptyState title={`Done reviewing “${noteName()}”`}>
                <TextButton variant="primary" size="lg" class="card-btn" onClick={loadCards}>REVIEW AGAIN</TextButton>
              </EmptyState>
            }
          >
            <div class="review">
              <div class="review-progress">{noteName()} · {idx() + 1} / {cards().length}</div>
              <div class="card-face question">{current()!.question}</div>
              <Show
                when={revealed()}
                fallback={<TextButton variant="primary" size="lg" class="reveal-btn" onClick={() => setRevealed(true)}>SHOW ANSWER</TextButton>}
              >
                <div class="card-face answer">{current()!.answer}</div>
                <div class="grade-row">
                  <TextButton variant="primary" size="lg" class="card-btn hard" onClick={() => grade("hard")}>HARD</TextButton>
                  <TextButton variant="primary" size="lg" class="card-btn good" onClick={() => grade("good")}>GOOD</TextButton>
                  <TextButton variant="primary" size="lg" class="card-btn easy" onClick={() => grade("easy")}>EASY</TextButton>
                </div>
              </Show>
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  );
}
