import { createSignal, onMount, For, Show } from "solid-js";
import { api } from "./api";
import type { Card, Deck } from "../../core/src/srs/types";

export function Flashcards() {
  const [decks, setDecks] = createSignal<Deck[]>([]);
  const [session, setSession] = createSignal<Card[] | null>(null);
  const [idx, setIdx] = createSignal(0);
  const [revealed, setRevealed] = createSignal(false);

  const loadDecks = async () => setDecks(await api.decks());
  onMount(loadDecks);

  const startSession = async (deck: string) => {
    const cards = await api.dueCards(deck);
    setSession(cards);
    setIdx(0);
    setRevealed(false);
  };

  const current = () => {
    const s = session();
    return s && idx() < s.length ? s[idx()] : null;
  };

  const grade = async (response: "hard" | "good" | "easy") => {
    const c = current();
    if (!c) return;
    await api.reviewCard(c.id, response);
    setRevealed(false);
    setIdx(idx() + 1);
  };

  const exit = () => {
    setSession(null);
    loadDecks();
  };

  return (
    <div class="flashcards-host">
      <Show
        when={session() !== null}
        fallback={
          <div class="deck-list">
            <h2>Flashcard Decks</h2>
            <Show
              when={decks().length > 0}
              fallback={
                <p class="deck-empty">
                  No decks found. Tag a note with <code>#flashcards</code> and add cards like{" "}
                  <code>question::answer</code>.
                </p>
              }
            >
              <For each={decks()}>
                {(d) => (
                  <button class="deck-row" disabled={d.due === 0} onClick={() => startSession(d.name)}>
                    <span class="deck-name">{d.name || "flashcards"}</span>
                    <span class="deck-counts">
                      <span class="deck-due">{d.due} due</span>
                      <span class="deck-total">{d.total} total</span>
                    </span>
                  </button>
                )}
              </For>
            </Show>
          </div>
        }
      >
        <Show
          when={current() !== null}
          fallback={
            <div class="review-done">
              <h2>Session complete</h2>
              <button class="card-btn" onClick={exit}>Back to decks</button>
            </div>
          }
        >
          <div class="review">
            <div class="review-progress">{idx() + 1} / {session()!.length}</div>
            <div class="card-face question">{current()!.question}</div>
            <Show
              when={revealed()}
              fallback={<button class="reveal-btn" onClick={() => setRevealed(true)}>Show answer</button>}
            >
              <div class="card-face answer">{current()!.answer}</div>
              <div class="grade-row">
                <button class="card-btn hard" onClick={() => grade("hard")}>Hard</button>
                <button class="card-btn good" onClick={() => grade("good")}>Good</button>
                <button class="card-btn easy" onClick={() => grade("easy")}>Easy</button>
              </div>
            </Show>
            <button class="exit-btn" onClick={exit}>Exit session</button>
          </div>
        </Show>
      </Show>
    </div>
  );
}
