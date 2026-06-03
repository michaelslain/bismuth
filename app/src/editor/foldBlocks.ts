// app/src/editor/foldBlocks.ts
//
// Notion-style collapsing for headings and bullet/task list items (markdown), and
// for indented keys (YAML, e.g. settings.yaml).
//
// Every foldable block gets a small fixed-size triangle quietly tucked into the
// left margin (absolutely positioned, so it never displaces or offsets the text).
//   • LEFT-click the triangle  → fold/unfold *ephemerally* (in-memory only, so
//     reloading the note expands everything that wasn't locked).
//   • RIGHT-click the triangle → toggle a *lock*. Locked folds persist across reload
//     / closing the tab (saved in localStorage, keyed by note path + block identity)
//     and the triangle switches from the faint code-line tint to --teal. Right-click
//     again removes the lock.
//
// Folding uses a single cross-line `Decoration.replace` per region (the idiomatic
// CM6 fold mechanism), provided from a StateField — height-changing decorations must
// come from state, not a view plugin. Nested folds inside an already-folded region
// are skipped so two replace decorations never overlap. The scroll position is held
// fixed across every toggle so collapsing never makes the view jump.

import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { type Extension, Prec, type Range, StateEffect, StateField, type Text } from "@codemirror/state";

// One nesting level of list indent, in em — mirrors LIST_STEP in livePreview.ts so
// the triangle lands just to the left of the bullet glyph at every depth.
const LIST_STEP = 1.6;

export type FoldMode = "markdown" | "yaml";

// --- foldable-block scan (pure, unit-tested) ---------------------------------

export type FoldKind = "h" | "l";

export interface FoldBlock {
  /** Stable identity across line shifts / reloads: kind + text + occurrence index. */
  id: string;
  kind: FoldKind;
  /** List/indent nesting depth (0 for top-level / headings) — drives the triangle offset. */
  depth: number;
  /** Document offset of the anchor line's start (where the triangle is placed). */
  anchorFrom: number;
  /** Document offset of the anchor line's end (where the hidden region begins). */
  anchorTo: number;
  /** Document offset of the end of the last line in the foldable region. */
  regionTo: number;
}

function indentCols(s: string): number {
  let c = 0;
  for (const ch of s) {
    if (ch === " ") c++;
    else if (ch === "\t") c += 2;
    else break;
  }
  return c;
}

const isBlank = (s: string): boolean => s.trim() === "";
// A thematic break (--- / *** / ___) also starts with a marker; never treat it as a bullet.
const isThematicBreak = (s: string): boolean => /^\s*([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(s);

/** Collect the run of more-indented lines beneath line `i` (blank lines extend the
 *  region only when a deeper line follows). Returns the last region line, or `i`. */
function indentRegionEnd(doc: Text, i: number, indent: number): { last: number; sawChild: boolean } {
  let last = i;
  let sawChild = false;
  for (let j = i + 1; j <= doc.lines; j++) {
    const jt = doc.line(j).text;
    if (isBlank(jt)) continue;
    if (indentCols(jt) > indent) {
      last = j;
      sawChild = true;
    } else break;
  }
  return { last, sawChild };
}

function scanMarkdown(doc: Text): FoldBlock[] {
  const out: FoldBlock[] = [];
  const occ = new Map<string, number>();
  const push = (key: string, b: Omit<FoldBlock, "id">) => {
    const n = occ.get(key) ?? 0;
    occ.set(key, n + 1);
    out.push({ ...b, id: `${key}|${n}` });
  };

  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const text = line.text;

    const hm = text.match(/^(#{1,6})\s+(.*)$/);
    if (hm) {
      const level = hm[1].length;
      let last = i;
      for (let j = i + 1; j <= doc.lines; j++) {
        const jm = doc.line(j).text.match(/^(#{1,6})\s+/);
        if (jm && jm[1].length <= level) break; // next sibling/parent heading ends the region
        last = j;
      }
      while (last > i && isBlank(doc.line(last).text)) last--; // trim trailing blanks
      if (last > i) {
        push(`h|${level}|${hm[2].trim()}`, {
          kind: "h",
          depth: 0,
          anchorFrom: line.from,
          anchorTo: line.to,
          regionTo: doc.line(last).to,
        });
      }
      continue;
    }

    if (isThematicBreak(text)) continue;
    const bm = text.match(/^(\s*)([-*+])\s+(.*)$/);
    if (bm) {
      const indent = indentCols(text);
      const { last, sawChild } = indentRegionEnd(doc, i, indent);
      if (sawChild) {
        push(`l|${bm[3].trim()}`, {
          kind: "l",
          depth: Math.floor(indent / 2),
          anchorFrom: line.from,
          anchorTo: line.to,
          regionTo: doc.line(last).to,
        });
      }
    }
  }
  return out;
}

function scanYaml(doc: Text): FoldBlock[] {
  const out: FoldBlock[] = [];
  const occ = new Map<string, number>();
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const text = line.text;
    if (isBlank(text) || text.trim().startsWith("#")) continue; // skip blanks & comment anchors
    const indent = indentCols(text);
    const { last, sawChild } = indentRegionEnd(doc, i, indent);
    if (sawChild) {
      const key = `y|${text.trim()}`;
      const n = occ.get(key) ?? 0;
      occ.set(key, n + 1);
      out.push({
        id: `${key}|${n}`,
        kind: "l",
        depth: Math.floor(indent / 2),
        anchorFrom: line.from,
        anchorTo: line.to,
        regionTo: doc.line(last).to,
      });
    }
  }
  return out;
}

/** Scan a document for every block that has collapsible content beneath it. */
export function scanFoldables(doc: Text, mode: FoldMode = "markdown"): FoldBlock[] {
  return mode === "yaml" ? scanYaml(doc) : scanMarkdown(doc);
}

// --- persistence (localStorage, per note path) -------------------------------

const storeKey = (path: string): string => `oa-folds:${path}`;

function loadLocked(path: string): Set<string> {
  try {
    const raw = localStorage.getItem(storeKey(path));
    if (raw) return new Set<string>(JSON.parse(raw));
  } catch {
    /* ignore malformed/unavailable storage */
  }
  return new Set();
}

function saveLocked(path: string, locked: Set<string>): void {
  try {
    if (locked.size === 0) localStorage.removeItem(storeKey(path));
    else localStorage.setItem(storeKey(path), JSON.stringify([...locked]));
  } catch {
    /* ignore quota/unavailable storage */
  }
}

// --- triangle widget ---------------------------------------------------------

class FoldArrowWidget extends WidgetType {
  constructor(
    private readonly id: string,
    private readonly collapsed: boolean,
    private readonly locked: boolean,
    private readonly left: string,
  ) {
    super();
  }

  eq(other: FoldArrowWidget): boolean {
    return (
      other.id === this.id &&
      other.collapsed === this.collapsed &&
      other.locked === this.locked &&
      other.left === this.left
    );
  }

  toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = "cm-fold-arrow";
    if (this.collapsed) el.classList.add("is-collapsed");
    if (this.locked) el.classList.add("is-locked");
    el.dataset.foldId = this.id;
    // Sits just left of the heading text / bullet glyph, in the margin. Anchored to
    // the line's padding box so it scales with indent and shifts nothing.
    el.style.left = this.left;
    return el;
  }

  ignoreEvent(): boolean {
    // Must be false so mousedown/contextmenu on the triangle reach our domEventHandlers
    // (CM swallows events on widgets that ignore them). Our handlers preventDefault, so
    // the click never falls through to cursor placement — same pattern as the checkbox.
    return false;
  }
}

// --- fold state field --------------------------------------------------------

const toggleFold = StateEffect.define<string>(); // left-click: fold ⇄ unfold (ephemeral)
const toggleLock = StateEffect.define<string>(); // right-click: lock ⇄ unlock (persisted)

interface FoldState {
  locked: Set<string>; // persisted (right-click) — implies folded
  ephemeral: Set<string>; // session-only (left-click) — lost on reload
  deco: DecorationSet;
}

const foldableLine = Decoration.line({ class: "cm-foldable-line" });

function buildDeco(doc: Text, mode: FoldMode, folded: Set<string>, locked: Set<string>): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  let coveredUntil = -1; // skip blocks whose anchor falls inside an already-folded region
  for (const b of scanFoldables(doc, mode)) {
    if (b.anchorFrom <= coveredUntil) continue;
    const isFolded = folded.has(b.id);
    // Headings vary wildly in font-size, so a fixed px offset keeps the triangle a
    // consistent small distance from the text; indented blocks use an em offset so it
    // tracks the bullet/key glyph at each depth. This positions the (wide, transparent)
    // hit-box; the triangle itself is centered inside it.
    const left = b.kind === "h" ? "-24px" : `${(b.depth * LIST_STEP - 1.45).toFixed(2)}em`;
    ranges.push(foldableLine.range(b.anchorFrom));
    ranges.push(
      Decoration.widget({
        widget: new FoldArrowWidget(b.id, isFolded, locked.has(b.id), left),
        side: -1,
      }).range(b.anchorFrom),
    );
    if (isFolded) {
      ranges.push(Decoration.replace({}).range(b.anchorTo, b.regionTo));
      coveredUntil = Math.max(coveredUntil, b.regionTo);
    }
  }
  return Decoration.set(ranges, true);
}

const withAdded = (s: Set<string>, id: string): Set<string> => new Set(s).add(id);
function without(s: Set<string>, id: string): Set<string> {
  const n = new Set(s);
  n.delete(id);
  return n;
}

/** Run `mutate` (which dispatches a fold transaction) while holding the scroll
 *  position fixed, so collapsing/expanding never makes the viewport jump. */
function preserveScroll(view: EditorView, mutate: () => void): void {
  const top = view.scrollDOM.scrollTop;
  mutate();
  view.scrollDOM.scrollTop = top;
  // Reassert after CM re-measures the (now shorter/taller) content.
  view.requestMeasure({ read: () => top, write: (t) => { view.scrollDOM.scrollTop = t; } });
}

/**
 * Collapsible headings & bullets (markdown) or indented keys (yaml). `getPath`
 * supplies the current note path (stable for the lifetime of this editor view),
 * used as the persistence key for locked folds.
 */
export function foldBlocks(getPath: () => string, mode: FoldMode = "markdown"): Extension {
  const path = getPath();

  const field = StateField.define<FoldState>({
    create(state) {
      const locked = loadLocked(path);
      return { locked, ephemeral: new Set(), deco: buildDeco(state.doc, mode, locked, locked) };
    },
    update(value, tr) {
      let { locked, ephemeral } = value;
      let changed = false;

      for (const e of tr.effects) {
        if (e.is(toggleFold)) {
          const id = e.value;
          if (locked.has(id) || ephemeral.has(id)) {
            // Expand: clear from both sets (left-clicking a locked block also unlocks it).
            if (ephemeral.has(id)) ephemeral = without(ephemeral, id);
            if (locked.has(id)) locked = without(locked, id);
          } else {
            ephemeral = withAdded(ephemeral, id);
          }
          changed = true;
        } else if (e.is(toggleLock)) {
          const id = e.value;
          if (locked.has(id)) {
            // Unlock but stay collapsed (demote to ephemeral) so it doesn't jump open.
            locked = without(locked, id);
            ephemeral = withAdded(ephemeral, id);
          } else {
            // Lock: ensure folded and pin it.
            locked = withAdded(locked, id);
            ephemeral = without(ephemeral, id);
          }
          changed = true;
        }
      }

      if (tr.docChanged) changed = true;
      // Selection-only transactions don't touch folds — reuse the prior decorations
      // (positions are unchanged), which keeps cursor movement cheap.
      if (!changed) return value;

      const folded = new Set<string>([...locked, ...ephemeral]);
      return { locked, ephemeral, deco: buildDeco(tr.state.doc, mode, folded, locked) };
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
  });

  return [
    field,
    // Highest precedence so a click/right-click on the chevron is handled here FIRST —
    // before editorContextMenu (which would otherwise open the spell/grammar menu for a
    // squiggle under the heading, since the chevron's margin position maps to that text).
    Prec.highest(
      EditorView.domEventHandlers({
      mousedown: (e, view) => {
        const el = (e.target as HTMLElement).closest(".cm-fold-arrow") as HTMLElement | null;
        if (!el?.dataset.foldId) return false;
        // Swallow non-left mousedown on the triangle (a right-click fires mousedown THEN
        // contextmenu; we let contextmenu handle the lock and must not also toggle the fold).
        if (e.button !== 0) {
          e.preventDefault();
          return true;
        }
        e.preventDefault();
        e.stopPropagation();
        const id = el.dataset.foldId;
        preserveScroll(view, () => view.dispatch({ effects: toggleFold.of(id) }));
        return true;
      },
      contextmenu: (e, view) => {
        const el = (e.target as HTMLElement).closest(".cm-fold-arrow") as HTMLElement | null;
        if (!el?.dataset.foldId) return false;
        e.preventDefault();
        e.stopPropagation();
        const id = el.dataset.foldId;
        preserveScroll(view, () => view.dispatch({ effects: toggleLock.of(id) }));
        return true;
      },
      }),
    ),
    // Persist locked folds whenever a fold/lock toggle changes them.
    EditorView.updateListener.of((u) => {
      if (u.transactions.some((tr) => tr.effects.some((e) => e.is(toggleFold) || e.is(toggleLock)))) {
        saveLocked(path, u.state.field(field).locked);
      }
    }),
    EditorView.theme({
      // Disable browser scroll-anchoring: when we expand a fold the browser would
      // otherwise pin some element *below* the fold and let everything above slide up.
      // We control scroll ourselves (preserveScroll), so the clicked line stays put and
      // the content *below* it moves instead.
      ".cm-scroller": { "overflow-anchor": "none" },
      // The anchor line becomes the positioning context for its triangle.
      ".cm-foldable-line": { position: "relative" },
      // The arrow is a WIDE, transparent hit-box (generous click target) that centers a
      // small fixed-size triangle drawn via ::before. Only the triangle's visibility is
      // toggled (via the box's opacity); the box stays clickable so you can grab it even
      // when faint. The triangle is a fixed size regardless of heading font-size.
      ".cm-fold-arrow": {
        position: "absolute",
        top: "50%",
        transform: "translateY(-50%)",
        width: "22px",
        height: "1.4em",
        "min-height": "18px",
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
        // Faint, matching the code-block line-number tint, until hovered/collapsed/locked.
        color: "color-mix(in srgb, var(--fg) 36%, transparent)",
        cursor: "pointer",
        opacity: "0",
        transition: "opacity 120ms ease, color 120ms ease",
      },
      ".cm-fold-arrow::before": {
        content: "''",
        width: "11px",
        height: "11px",
        background: "currentColor",
        "clip-path": "polygon(18% 8%, 18% 92%, 88% 50%)",
        transform: "rotate(90deg)", // expanded → points down
        "transform-origin": "center",
        transition: "transform 120ms ease",
      },
      // Collapsed → triangle points right; box stays visible.
      ".cm-fold-arrow.is-collapsed": { opacity: "1" },
      ".cm-fold-arrow.is-collapsed::before": { transform: "rotate(0deg)" },
      // Reveal whenever the pointer is anywhere over the line.
      ".cm-foldable-line:hover .cm-fold-arrow": { opacity: "1" },
      ".cm-fold-arrow:hover": { color: "var(--fg)" },
      // Locked: a fixed theme color so pinned collapses read at a glance.
      ".cm-fold-arrow.is-locked": { opacity: "1", color: "var(--teal)" },
      ".cm-fold-arrow.is-locked:hover": { color: "var(--teal)" },
    }),
  ];
}
