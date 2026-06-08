import { createSignal, createMemo, For, Show } from "solid-js";
import { Modal } from "../ui/Modal";
import { TextButton } from "../ui/TextButton";
import { IconButton } from "../ui/IconButton";
import { IconTextButton } from "../ui/IconTextButton";
import { TextInput } from "../ui/TextInput";
import { SegmentedToggle } from "../ui/SegmentedToggle";
import { Icon } from "../icons/Icon";
import { renderMarkdown } from "./markdown";
import type { Row } from "../../../core/src/bases/types";
import { api } from "../api";

type Note = Record<string, unknown>;
type Mode = "list" | "bulk";

// Bulk-add separator presets. "auto" sniffs each line for the first that matches.
const SEPARATORS: { id: string; label: string; sep: string }[] = [
  { id: "tab", label: "Tab", sep: "\t" },
  { id: "tripcolon", label: ":::", sep: ":::" },
  { id: "dblcolon", label: "::", sep: "::" },
  { id: "colon", label: ":", sep: ":" },
  { id: "pipe", label: "|", sep: "|" },
  { id: "comma", label: ",", sep: "," },
  { id: "dash", label: "–", sep: "–" },
];
// Auto-detect probes separators most-specific first so "::" beats ":".
const AUTO_ORDER = ["tab", "tripcolon", "dblcolon", "pipe", "dash", "colon", "comma"];

function splitOn(line: string, sep: string): [string, string] {
  const i = line.indexOf(sep);
  if (i < 0) return [line.trim(), ""];
  return [line.slice(0, i).trim(), line.slice(i + sep.length).trim()];
}

/** Parse pasted text into {front, back} cards using the chosen separator (or auto). */
export function parseBulk(text: string, delim: string): { front: string; back: string }[] {
  const sepOf = (id: string) => SEPARATORS.find((s) => s.id === id)!.sep;
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      if (delim === "auto") {
        for (const id of AUTO_ORDER) if (line.includes(sepOf(id))) return splitOn(line, sepOf(id));
        return [line.trim(), ""] as [string, string];
      }
      return splitOn(line, sepOf(delim));
    })
    .map(([front, back]) => ({ front, back }));
}

/** One Front/Back cell: the rendered-markdown overlay sits in normal flow and DRIVES
 *  the cell height (so there's no fragile JS auto-grow / font-load race); a transparent
 *  textarea is layered over it and reveals the raw text on focus (CSS :focus-within).
 *  Commits on blur. */
function CardCell(props: {
  value: string;
  field: "Front" | "Back";
  placeholder: string;
  onCommit: (v: string) => void;
}) {
  const [val, setVal] = createSignal(props.value);
  return (
    <div class={`cell cell-${props.field.toLowerCase()}`}>
      <div
        class="cell-md"
        innerHTML={renderMarkdown(val()) || `<span class="cell-ph">${props.placeholder}</span>`}
      />
      <textarea
        rows={1}
        value={val()}
        placeholder={props.placeholder}
        onInput={(e) => setVal(e.currentTarget.value)}
        onBlur={() => val() !== props.value && props.onCommit(val())}
      />
      <span class="cell-tag">{props.field}</span>
    </div>
  );
}

/**
 * Deck-wide card manager (the review view's "Cards" button). Two modes:
 *  • Cards — a reorderable list of Front/Back rows with live markdown, inline add, delete.
 *  • Bulk add — paste many cards at once (Tab / :: / : / | / , / – or auto-detect) with a preview.
 *
 * Built from standardized primitives (Modal, SegmentedToggle, Button family). A local
 * `cards` array (full note objects) mirrors the base 1:1 — array position IS the backend
 * row index — so edits/adds/deletes/reorders stay in lockstep with the row API without a
 * jarring refetch per keystroke. `onChanged` fires on close to refresh the review queue.
 */
export function EditCardsModal(props: {
  rows: Row[];
  basePath: string;
  frontField: string;
  backField: string;
  deckName?: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const ff = props.frontField;
  const bf = props.backField;

  const [cards, setCards] = createSignal<Note[]>(props.rows.map((r) => ({ ...r.note })));
  const [mode, setMode] = createSignal<Mode>("list");
  const [busy, setBusy] = createSignal(false);
  let dirty = false;

  const close = () => {
    if (dirty) props.onChanged();
    props.onClose();
  };

  const text = (n: Note, field: string) => String(n[field] ?? "");

  // ── List-mode mutations (array position === backend row index) ────────
  const commitCell = async (index: number, field: string, value: string) => {
    if (busy()) return;
    setBusy(true);
    try {
      const next = cards().map((n, i) => (i === index ? { ...n, [field]: value } : n));
      setCards(next);
      await api.rowUpdate(props.basePath, index, next[index]);
      dirty = true;
    } finally {
      setBusy(false);
    }
  };

  const removeCard = async (index: number) => {
    if (busy()) return;
    setBusy(true);
    try {
      await api.rowDelete(props.basePath, index);
      setCards(cards().filter((_, i) => i !== index));
      dirty = true;
    } finally {
      setBusy(false);
    }
  };

  // ── Inline add (draft row) ────────────────────────────────────────────
  const [draftFront, setDraftFront] = createSignal("");
  const [draftBack, setDraftBack] = createSignal("");
  const addDraft = async () => {
    const front = draftFront().trim();
    const back = draftBack().trim();
    if ((!front && !back) || busy()) return;
    setBusy(true);
    try {
      const note: Note = { [ff]: front, [bf]: back };
      await api.rowCreate(props.basePath, note);
      setCards([...cards(), note]);
      setDraftFront("");
      setDraftBack("");
      dirty = true;
    } finally {
      setBusy(false);
    }
  };

  // ── Drag reorder via the row-number handle ────────────────────────────
  const [dragFrom, setDragFrom] = createSignal<number | null>(null);
  const [dropTo, setDropTo] = createSignal<number | null>(null);
  const doDrop = async (to: number) => {
    const from = dragFrom();
    setDragFrom(null);
    setDropTo(null);
    if (from === null || from === to || busy()) return;
    setBusy(true);
    try {
      const arr = [...cards()];
      const [moved] = arr.splice(from, 1);
      arr.splice(to, 0, moved);
      setCards(arr);
      await api.rowReorder(props.basePath, from, to);
      dirty = true;
    } finally {
      setBusy(false);
    }
  };

  // ── Bulk mode ─────────────────────────────────────────────────────────
  const [bulkText, setBulkText] = createSignal("");
  const [delim, setDelim] = createSignal("auto");
  const parsed = createMemo(() => parseBulk(bulkText(), delim()));
  const validCount = () => parsed().filter((c) => c.front).length;
  const addBulk = async () => {
    const valid = parsed().filter((c) => c.front);
    if (!valid.length || busy()) return;
    setBusy(true);
    try {
      const added: Note[] = [];
      for (const c of valid) {
        const note: Note = { [ff]: c.front, [bf]: c.back };
        await api.rowCreate(props.basePath, note);
        added.push(note);
      }
      setCards([...cards(), ...added]);
      setBulkText("");
      dirty = true;
      setMode("list");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={close} class="cards-modal">
      <div class="cards-head">
        <h2 class="cards-title">Edit cards</h2>
        <Show when={props.deckName}>
          <span class="cards-meta"><span class="dot">·</span> {props.deckName}</span>
        </Show>
        <div class="sp" />
        <IconButton icon="X" label="Close" onClick={close} />
      </div>

      <div class="cards-modebar">
        <SegmentedToggle
          value={mode()}
          onChange={setMode}
          size="sm"
          options={[
            { id: "list", label: <><Icon value="List" size={13} /> CARDS</> },
            { id: "bulk", label: <><Icon value="LayoutGrid" size={13} /> BULK ADD</> },
          ]}
        />
        <div class="sp" />
        <Show when={mode() === "list"}>
          <span class="cards-hint"><span class="key">&crarr;</span> adds a card · drag # to reorder</span>
        </Show>
      </div>

      {/* ── Cards (list) ── */}
      <Show when={mode() === "list"}>
        <div class="cards-listwrap">
          <div class="cards-collbl"><span>#</span><span>Front</span><span>Back</span><span /></div>
          <For each={cards()}>
            {(n, i) => (
              <div
                class={`cards-row ${dropTo() === i() ? "dropbefore" : ""} ${dragFrom() === i() ? "dragging" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDropTo(i());
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  void doDrop(i());
                }}
              >
                <div
                  class="cards-num"
                  title="Drag to reorder"
                  draggable={true}
                  onDragStart={() => setDragFrom(i())}
                  onDragEnd={() => {
                    setDragFrom(null);
                    setDropTo(null);
                  }}
                >
                  {i() + 1}
                </div>
                <CardCell value={text(n, ff)} field="Front" placeholder="Front…" onCommit={(v) => commitCell(i(), ff, v)} />
                <CardCell value={text(n, bf)} field="Back" placeholder="Back…" onCommit={(v) => commitCell(i(), bf, v)} />
                <div class="cards-del">
                  <IconButton icon="Trash2" label="Delete card" iconSize={15} danger disabled={busy()} onClick={() => removeCard(i())} />
                </div>
              </div>
            )}
          </For>

          {/* draft add row */}
          <div class="cards-row cards-draft">
            <div class="cards-num cards-num-add">+</div>
            <div class="cell cell-front">
              <textarea
                rows={1}
                value={draftFront()}
                placeholder="Front of new card…"
                onInput={(e) => setDraftFront(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    (e.currentTarget.closest(".cards-draft")!.querySelector(".cell-back textarea") as HTMLTextAreaElement | null)?.focus();
                  }
                }}
              />
            </div>
            <div class="cell cell-back">
              <textarea
                rows={1}
                value={draftBack()}
                placeholder="Back…"
                onInput={(e) => setDraftBack(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void addDraft();
                  }
                }}
              />
            </div>
            <div class="cards-del" />
          </div>
          <div class="cards-addrow">
            <span class="cards-lefthint">Type above, then <span class="key">&crarr;</span> to add — keeps going for fast entry.</span>
            <IconTextButton icon="Plus" iconSize={14} variant="unselected" disabled={busy()} onClick={addDraft}>
              ADD CARD
            </IconTextButton>
          </div>
        </div>
      </Show>

      {/* ── Bulk add ── */}
      <Show when={mode() === "bulk"}>
        <div class="cards-bulkwrap">
          <div class="cards-bulk-toolbar">
            <span class="cards-lab">Separator</span>
            <div class="cards-chiprow">
              <TextButton size="sm" variant={delim() === "auto" ? "selected" : "unselected"} onClick={() => setDelim("auto")}>AUTO</TextButton>
              <For each={SEPARATORS}>
                {(s) => (
                  <TextButton size="sm" variant={delim() === s.id ? "selected" : "unselected"} onClick={() => setDelim(s.id)}>
                    {s.label.toUpperCase()}
                  </TextButton>
                )}
              </For>
            </div>
            <div class="sp" />
            <span class="cards-hint">One card per line · front ‹sep› back</span>
          </div>
          <div class="cards-bulk-grid">
            <div class="cards-bulk-input">
              <label>Paste your cards</label>
              <TextInput
                multiline
                class="cards-bulk-textarea"
                spellcheck={false}
                value={bulkText()}
                onInput={setBulkText}
                placeholder={'What is the Spanish word for "house"?    casa\ncasa :: house\nhola : hello\n\nPaste from a spreadsheet, Anki, or an Obsidian (:: / :) deck.'}
              />
            </div>
            <div class="cards-bulk-preview">
              <div class="cards-pvhead">
                <span class="cards-lab">Preview</span>
                <span class="cards-cnt">{parsed().length} {parsed().length === 1 ? "card" : "cards"}</span>
              </div>
              <div class="cards-pvlist">
                <Show
                  when={parsed().length > 0}
                  fallback={<div class="cards-pvempty">Parsed cards appear here as you paste.</div>}
                >
                  <For each={parsed()}>
                    {(c, i) => (
                      <div class={`cards-pvcard ${c.back ? "" : "bad"}`}>
                        <div class="cards-pi">{i() + 1}</div>
                        <div>
                          <div class="cards-pf" innerHTML={c.front ? renderMarkdown(c.front) : '<em class="cards-warn-em">empty</em>'} />
                          <Show
                            when={c.back}
                            fallback={<div class="cards-warn">no back — separator not found on this line</div>}
                          >
                            <div class="cards-pb" innerHTML={renderMarkdown(c.back)} />
                          </Show>
                        </div>
                      </div>
                    )}
                  </For>
                </Show>
              </div>
            </div>
          </div>
        </div>
      </Show>

      <div class="cards-foot">
        <span class="cards-count"><b>{cards().length}</b> {cards().length === 1 ? "card" : "cards"} in deck</span>
        <div class="sp" />
        <Show
          when={mode() === "bulk"}
          fallback={<TextButton variant="selected" onClick={close}>DONE</TextButton>}
        >
          <TextButton onClick={() => setMode("list")}>CANCEL</TextButton>
          <TextButton variant="selected" disabled={busy() || validCount() === 0} onClick={addBulk}>
            ADD {validCount()} CARDS
          </TextButton>
        </Show>
      </div>
    </Modal>
  );
}
