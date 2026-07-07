// app/src/editor/cellEmoji.ts
// In-cell `:emoji:` autocomplete for the editable GFM table widget (#49).
//
// A table cell is a plain contenteditable DOM island that lives OUTSIDE CodeMirror's input
// pipeline, so the editor's own `:emoji:` completion (editor/autocomplete.ts `emojiSource`) never
// runs there — the same class of gap as the in-cell wrap-on-type and list-continuation features.
// This is a lightweight, self-contained emoji autocomplete for cells: on a `:query` typed in a
// cell it shows the SAME ranked emoji suggestions the editor shows (reusing `searchEmoji` from
// emoji.ts — one data source, one ranking), is keyboard-navigable (Up/Down/Enter/Tab/Escape), and
// inserts the chosen glyph in place of the `:query` token on accept.
//
// The trigger + key decision are PURE (unit-tested without a DOM); the caret read + token
// replacement are deterministic Range operations (no execCommand — engine-agnostic, like
// insertBreakAtCaret in tableWidget.ts), unit-tested under happy-dom.
import { matchEmojiPrefix, searchEmoji, type EmojiEntry } from "./emoji";

const ZWSP = "​";
const MENU_LIMIT = 8;

// ── Pure trigger + key decision (DOM-free, unit-tested) ────────────────────────

/** Detect a `:query` emoji token immediately before the caret, given the text before the caret
 *  (may be multi-line — only the current line matters). Reuses the editor's `matchEmojiPrefix`, so
 *  the trigger rules are identical (a `:` at start-of-line or after whitespace, so `key:value` /
 *  `http://x` / `12:30` never fire). Returns the bare `query` (no colons) plus `tokenLen`, the
 *  number of characters the token occupies before the caret (`:smile` = 6, `:smile:` = 7) — what the
 *  replacement deletes back. Pure. */
export function emojiTokenBeforeCaret(beforeCaret: string): { query: string; tokenLen: number } | null {
  const line = beforeCaret.slice(beforeCaret.lastIndexOf("\n") + 1).replace(new RegExp(ZWSP, "g"), "");
  const m = matchEmojiPrefix(line);
  if (!m) return null;
  return { query: m.query, tokenLen: m.to - m.from };
}

/** What an open emoji menu should do with a keydown. Up/Down move the highlight, Enter/Tab accept,
 *  Escape closes; Left/Right/Home/End move the caret away so the menu closes; anything else falls
 *  through (`null`) to normal cell typing (which re-evaluates the menu on the resulting `input`).
 *  Pure. */
export type EmojiMenuAction = "next" | "prev" | "accept" | "close" | null;
export function emojiMenuKey(key: string): EmojiMenuAction {
  switch (key) {
    case "ArrowDown": return "next";
    case "ArrowUp": return "prev";
    case "Enter":
    case "Tab": return "accept";
    case "Escape":
    case "ArrowLeft":
    case "ArrowRight":
    case "Home":
    case "End": return "close";
    default: return null;
  }
}

// ── Caret read + token replacement (deterministic Range ops, unit-tested) ──────

/** Flatten a fragment to text, mapping each `<br>` to `\n` (the cell edit face is a flat run of
 *  text nodes + `<br>`s; a `<div>`/`<p>` wrapper under WebKit contributes its text too). */
function fragToText(node: Node): string {
  let out = "";
  node.childNodes.forEach((n) => {
    if (n.nodeName === "BR") out += "\n";
    else if (n.nodeType === Node.TEXT_NODE) out += n.textContent ?? "";
    else out += fragToText(n);
  });
  return out;
}

function selectionOf(cell: HTMLElement): Selection | null {
  const win = cell.ownerDocument.defaultView ?? (typeof window !== "undefined" ? window : null);
  return win?.getSelection?.() ?? null;
}

/** The text of the cell from its start up to the collapsed caret (with `<br>`→`\n`), or null when
 *  there's no single collapsed caret inside `cell`. The trigger reads this to find a `:query`. */
export function textBeforeCaret(cell: HTMLElement): string | null {
  const sel = selectionOf(cell);
  if (!sel || sel.rangeCount === 0) return null;
  const caret = sel.getRangeAt(0);
  if (!caret.collapsed || !cell.contains(caret.startContainer)) return null;
  const r = cell.ownerDocument.createRange();
  r.selectNodeContents(cell);
  r.setEnd(caret.startContainer, caret.startOffset);
  return fragToText(r.cloneContents());
}

/** Resolve an absolute text offset (counting text chars only; `<br>`/elements = 0) within `cell`
 *  to a concrete `{ text node, offset }`, so a Range can start there. */
function textOffsetToPoint(cell: HTMLElement, target: number): { node: Text; offset: number } | null {
  const walker = cell.ownerDocument.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
  let acc = 0;
  let last: Text | null = null;
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    if (acc + n.length >= target) return { node: n, offset: target - acc };
    acc += n.length;
    last = n;
  }
  return last ? { node: last, offset: last.length } : null;
}

/** Replace the `tokenLen` characters immediately before the collapsed caret with `replacement`
 *  (the chosen emoji glyph) and leave the caret after it. Pure Range surgery — deterministic across
 *  engines, unlike execCommand. Returns false when there's no usable caret / the token doesn't fit
 *  before it. */
export function replaceTokenBeforeCaret(cell: HTMLElement, tokenLen: number, replacement: string): boolean {
  const sel = selectionOf(cell);
  if (!sel || sel.rangeCount === 0) return false;
  const caret = sel.getRangeAt(0);
  if (!caret.collapsed || !cell.contains(caret.startContainer)) return false;
  const doc = cell.ownerDocument;
  // Absolute text offset of the caret within the cell (text chars only).
  const pre = doc.createRange();
  pre.selectNodeContents(cell);
  pre.setEnd(caret.startContainer, caret.startOffset);
  const absCaret = (pre.cloneContents().textContent ?? "").length;
  const target = absCaret - tokenLen;
  if (target < 0) return false;
  const start = textOffsetToPoint(cell, target);
  if (!start) return false;
  const del = doc.createRange();
  del.setStart(start.node, start.offset);
  del.setEnd(caret.startContainer, caret.startOffset);
  del.deleteContents();
  const node = doc.createTextNode(replacement);
  del.insertNode(node);
  const after = doc.createRange();
  after.setStartAfter(node);
  after.collapse(true);
  sel.removeAllRanges();
  sel.addRange(after);
  return true;
}

// ── The popup controller ───────────────────────────────────────────────────────

/** Lightweight `:emoji:` autocomplete popup driven by a cell's `input` + `keydown`. One instance
 *  per table widget (only one cell is focused at a time); `destroy()`/`close()` remove the popup.
 *  The popup is appended to `document.body` (not inside the contenteditable) so it never becomes
 *  part of the cell source or gets clobbered by the display/edit face swap. */
export class CellEmojiMenu {
  private popup: HTMLElement | null = null;
  private items: EmojiEntry[] = [];
  private active = 0;
  private tokenLen = 0;
  private cell: HTMLElement | null = null;

  isOpen(): boolean {
    return this.popup != null;
  }

  /** Currently highlighted entry (for tests / accept). */
  activeEntry(): EmojiEntry | null {
    return this.items[this.active] ?? null;
  }

  /** Re-evaluate on cell input: open/update the popup when the caret sits after a `:query` token
   *  with matches; close otherwise. */
  onInput(cell: HTMLElement): void {
    const before = textBeforeCaret(cell);
    const tok = before == null ? null : emojiTokenBeforeCaret(before);
    if (!tok) { this.close(); return; }
    const items = searchEmoji(tok.query, MENU_LIMIT);
    if (items.length === 0) { this.close(); return; }
    this.cell = cell;
    this.items = items;
    this.tokenLen = tok.tokenLen;
    this.active = 0;
    this.render(cell);
  }

  /** Handle a keydown while the menu is open. Returns true iff it consumed the key (the caller then
   *  stops it reaching the cell's own Tab/Enter/Escape handling). */
  handleKeydown(cell: HTMLElement, key: string): boolean {
    if (!this.isOpen()) return false;
    const action = emojiMenuKey(key);
    if (action === null) return false;
    if (action === "close") { this.close(); return true; }
    if (action === "accept") { this.accept(cell); return true; }
    this.active =
      action === "next"
        ? (this.active + 1) % this.items.length
        : (this.active - 1 + this.items.length) % this.items.length;
    this.paint();
    return true;
  }

  /** Insert the highlighted glyph in place of the `:query` token and close. */
  accept(cell: HTMLElement): void {
    const entry = this.items[this.active];
    if (entry) replaceTokenBeforeCaret(cell, this.tokenLen, entry.char);
    this.close();
  }

  close(): void {
    this.popup?.remove();
    this.popup = null;
    this.items = [];
    this.cell = null;
  }

  destroy(): void {
    this.close();
  }

  private render(cell: HTMLElement): void {
    const doc = cell.ownerDocument;
    if (!this.popup) {
      this.popup = doc.createElement("div");
      this.popup.className = "cm-cell-emoji-menu";
      this.popup.setAttribute("contenteditable", "false");
      doc.body.appendChild(this.popup);
    }
    this.popup.replaceChildren();
    this.items.forEach((e, i) => {
      const row = doc.createElement("div");
      row.className = "cm-cell-emoji-item" + (i === this.active ? " active" : "");
      const glyph = doc.createElement("span");
      glyph.className = "cm-cell-emoji-glyph";
      glyph.textContent = e.char;
      const name = doc.createElement("span");
      name.className = "cm-cell-emoji-name";
      name.textContent = `:${e.name}:`;
      row.appendChild(glyph);
      row.appendChild(name);
      // mousedown (not click) + preventDefault so picking an item never blurs the cell first
      // (a blur would commit + tear down the edit face before the insert).
      row.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.active = i;
        if (this.cell) this.accept(this.cell);
      });
      this.popup!.appendChild(row);
    });
    this.position(cell);
  }

  /** Repaint just the active-row highlight (no rebuild) on Up/Down. */
  private paint(): void {
    if (!this.popup) return;
    Array.from(this.popup.children).forEach((el, i) => el.classList.toggle("active", i === this.active));
    const activeEl = this.popup.children[this.active] as HTMLElement | undefined;
    activeEl?.scrollIntoView?.({ block: "nearest" });
  }

  private position(cell: HTMLElement): void {
    if (!this.popup) return;
    const sel = selectionOf(cell);
    let rect: DOMRect | null = null;
    if (sel && sel.rangeCount) {
      const rr = sel.getRangeAt(0).getBoundingClientRect();
      if (rr && (rr.width || rr.height || rr.top || rr.left)) rect = rr;
    }
    if (!rect) rect = cell.getBoundingClientRect();
    this.popup.style.position = "fixed";
    this.popup.style.left = `${Math.round(rect.left)}px`;
    this.popup.style.top = `${Math.round(rect.bottom + 2)}px`;
  }
}
