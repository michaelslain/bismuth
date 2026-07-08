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
import { createPopoverIcon } from "../ui/popover/rowDom";
import { completionIcon } from "../ui/popover/iconMap";

const ZWSP = "​";
// Match the editor's own emoji popup: searchEmoji's default cap (50). The list scrolls inside
// the shared `.cm-tooltip-autocomplete > ul` max-height, exactly like the editor's does.
const MENU_LIMIT = 50;

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
 *
 *  VISUAL PARITY with the editor's own completion popup is structural, not re-created (#49
 *  re-bounce: "looks completely different than the other emoji list"): the popup carries
 *  CodeMirror's exact tooltip classes + DOM shape — `.cm-tooltip.cm-tooltip-autocomplete >
 *  ul[role=listbox] > li[role=option]([aria-selected]) > span.cm-completionLabel` — and is
 *  appended INSIDE the editor root (`host` = view.dom), where BOTH CM's base autocomplete theme
 *  and the app's `completionTheme` (editor/completionDisplay.ts, the single source of completion
 *  styling) are scoped. Every rule that styles the editor's popup styles this one identically —
 *  container, row metrics, selected wash, label typography — so future theme changes hit both.
 *  The row content matches the editor's emoji entries exactly: one `.cm-completionLabel` with
 *  `${char}  :${name}:` (the editor's emoji completions render no icon — completionDisplayConfig
 *  sets `icons:false` and emoji rows have no `type`/`lucideIcon`, so no icon span here either).
 *  Being outside the contenteditable cell, it never becomes cell source or gets clobbered by the
 *  display/edit face swap. */
export class CellEmojiMenu {
  private popup: HTMLElement | null = null;
  private list: HTMLElement | null = null;
  private items: EmojiEntry[] = [];
  private active = 0;
  private tokenLen = 0;
  private cell: HTMLElement | null = null;
  /** The editor root (view.dom) the popup mounts into so CM-scoped themes apply; a null host
   *  (tests / detached usage) falls back to the cell's document body. */
  constructor(private readonly host: HTMLElement | null = null) {}

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
    this.list = null;
    this.items = [];
    this.cell = null;
  }

  destroy(): void {
    this.close();
  }

  private render(cell: HTMLElement): void {
    const doc = cell.ownerDocument;
    if (!this.popup) {
      // CodeMirror's exact tooltip container classes + a marker class for our own wiring/tests.
      // Mounted inside the editor root so the CM-scoped completion theme applies (see class doc).
      this.popup = doc.createElement("div");
      this.popup.className = "cm-tooltip cm-tooltip-autocomplete cm-cell-emoji-menu";
      this.popup.setAttribute("contenteditable", "false");
      const list = doc.createElement("ul");
      list.setAttribute("role", "listbox");
      list.setAttribute("aria-expanded", "true");
      this.popup.appendChild(list);
      this.list = list;
      (this.host ?? doc.body).appendChild(this.popup);
    }
    const list = this.list!;
    list.replaceChildren();
    this.items.forEach((e, i) => {
      const row = doc.createElement("li");
      row.setAttribute("role", "option");
      if (i === this.active) row.setAttribute("aria-selected", "true");
      // The editor's completionDisplayConfig prepends a row icon via createPopoverIcon —
      // emoji options carry no `type`, so completionIcon(undefined) yields the ChevronRight
      // default every editor emoji row shows. Same builder, same icon → identical rows.
      const iconName = completionIcon(undefined);
      if (iconName) row.appendChild(createPopoverIcon(iconName));
      const label = doc.createElement("span");
      label.className = "cm-completionLabel";
      // EXACTLY the editor's emoji option label (autocomplete.ts): glyph, two spaces, :shortcode:.
      label.textContent = `${e.char}  :${e.name}:`;
      row.appendChild(label);
      // mousedown (not click) + preventDefault so picking an item never blurs the cell first
      // (a blur would commit + tear down the edit face before the insert).
      row.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.active = i;
        if (this.cell) this.accept(this.cell);
      });
      list.appendChild(row);
    });
    this.position(cell);
  }

  /** Repaint just the active-row highlight (no rebuild) on Up/Down — the same `[aria-selected]`
   *  attribute CM's own popup marks its selected row with (the shared theme keys off it). */
  private paint(): void {
    if (!this.list) return;
    Array.from(this.list.children).forEach((el, i) => {
      if (i === this.active) el.setAttribute("aria-selected", "true");
      else el.removeAttribute("aria-selected");
    });
    const activeEl = this.list.children[this.active] as HTMLElement | undefined;
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
    // Fixed positioning, like CM's own tooltip default — viewport coords straight from the caret.
    this.popup.style.position = "fixed";
    this.popup.style.zIndex = "100"; // CM's .cm-tooltip z-index
    this.popup.style.left = `${Math.round(rect.left)}px`;
    this.popup.style.top = `${Math.round(rect.bottom + 2)}px`;
  }
}
