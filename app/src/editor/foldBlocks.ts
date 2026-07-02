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

import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { type Extension, Prec, type Range, StateEffect, StateField, type Text } from "@codemirror/state";
import { isThematicBreak } from "./thematicBreak";
// One nesting level of list indent, in em — shared with livePreview (via the
// dependency-free ./listLayout leaf) so the triangle lands just to the left of the
// bullet glyph at every depth.
import { LIST_STEP } from "./listLayout";

export type FoldMode = "markdown" | "yaml";

// --- foldable-block scan (pure, unit-tested) ---------------------------------

// Hoisted regex literals — this scan runs per-line on every doc change, so avoid
// re-allocating a fresh RegExp object per line/call. All uses below are .match()
// without the `g` flag, so there's no lastIndex state to worry about across calls.
const HEADING_LINE_RE = /^(#{1,6})\s+(.*)$/;
const HEADING_PREFIX_RE = /^(#{1,6})\s+/;
const LIST_ITEM_RE = /^(\s*)(\d+[.)]|[-*+])\s+/;
const BULLET_ITEM_RE = /^(\s*)([-*+])\s+(.*)$/;

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

  // Track the indentation of the enclosing list items so nesting depth comes from
  // structure, not a fixed space-per-level guess — correct whether a note indents with 2
  // spaces (legacy) or 4 (current), and for a bullet nested under a wider numbered marker.
  const stack: number[] = [];
  const listDepth = (indent: number): number => {
    while (stack.length && stack[stack.length - 1] >= indent) stack.pop();
    const d = stack.length;
    stack.push(indent);
    return d;
  };

  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const text = line.text;
    if (isBlank(text)) continue; // blank lines never break a list

    const hm = text.match(HEADING_LINE_RE);
    if (hm) {
      stack.length = 0; // a heading ends any open list
      const level = hm[1].length;
      let last = i;
      for (let j = i + 1; j <= doc.lines; j++) {
        const jm = doc.line(j).text.match(HEADING_PREFIX_RE);
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

    if (isThematicBreak(text)) {
      stack.length = 0;
      continue;
    }

    // Every list item (bullet, numbered, or task) advances nesting depth; only bullet /
    // task items become fold anchors (numbered items aren't folded here).
    const li = text.match(LIST_ITEM_RE);
    if (li) {
      const indent = indentCols(text);
      const depth = listDepth(indent);
      const bm = text.match(BULLET_ITEM_RE);
      if (bm) {
        const { last, sawChild } = indentRegionEnd(doc, i, indent);
        if (sawChild) {
          push(`l|${bm[3].trim()}`, {
            kind: "l",
            depth,
            anchorFrom: line.from,
            anchorTo: line.to,
            regionTo: doc.line(last).to,
          });
        }
      }
      continue;
    }

    // A non-list line at the left margin ends the list; an indented continuation (e.g. a
    // wrapped paragraph inside an item) leaves the stack untouched.
    if (indentCols(text) === 0) stack.length = 0;
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

const storeKey = (path: string): string => `bismuth-folds:${path}`;

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

function buildDeco(doc: Text, mode: FoldMode, folded: Set<string>, locked: Set<string>, hasGutter: boolean): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  let coveredUntil = -1; // skip blocks whose anchor falls inside an already-folded region
  for (const b of scanFoldables(doc, mode)) {
    if (b.anchorFrom <= coveredUntil) continue;
    const isFolded = folded.has(b.id);
    // Headings vary wildly in font-size, so a fixed px offset keeps the triangle a
    // consistent small distance from the text; indented blocks use an em offset so it
    // tracks the bullet/key glyph at each depth. This positions the (wide, transparent)
    // hit-box; the triangle itself is centered inside it.
    const base = b.kind === "h" ? "-24px" : `${(b.depth * LIST_STEP - 1.45).toFixed(2)}em`;
    // When the editor shows a native line-number gutter (yaml/config files, or notes with
    // line numbers on), a depth-0 anchor's triangle would otherwise land on top of — and,
    // since the gutter sits at z-index 200 above the content, *behind* — the line numbers,
    // hiding it and stealing the click. Pull those past the gutter (measured width, so it's
    // robust to digit count) so the collapser sits clearly to the LEFT of the numbers and
    // stays clickable. Deeper (indented) anchors already clear the gutter, so leave them put.
    const left = hasGutter && b.depth === 0 ? `calc(-1 * var(--bismuth-fold-gutter-w, 0px) - 18px)` : base;
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

// --- animated height collapse/expand -----------------------------------------
//
// CM6's fold (Decoration.replace) removes the region from layout *instantly*. To
// make collapsing feel smooth we first animate the region's on-screen `.cm-line`
// elements' height/opacity to 0 (or up from 0, when expanding) over ANIM_MS, then
// commit the real fold transaction. Only viewport-visible lines exist in the DOM,
// which is exactly what the user can see; off-screen lines collapse instantly but
// unseen. The eased curve matches the app's other transitions.

const ANIM_MS = 90;
const ANIM_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

const reducedMotion = (): boolean =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Re-entrancy guard: ignore further toggles on a block while its animation runs.
const animatingIds: WeakMap<EditorView, Set<string>> = new WeakMap();
function busy(view: EditorView): Set<string> {
  let s = animatingIds.get(view);
  if (!s) animatingIds.set(view, (s = new Set()));
  return s;
}

/** Climb from a DOM node at `pos` to its enclosing `.cm-line` element. */
function lineEl(view: EditorView, pos: number): HTMLElement | null {
  const at = view.domAtPos(pos);
  let el: Node | null = at.node;
  while (el && !(el instanceof HTMLElement && el.classList.contains("cm-line"))) el = el.parentNode;
  return el as HTMLElement | null;
}

/** The on-screen `.cm-line` elements for the hidden region (lines after the anchor
 *  line through the region's last line) that currently fall inside the viewport. */
function regionLineEls(view: EditorView, anchorTo: number, regionTo: number): HTMLElement[] {
  const doc = view.state.doc;
  const startLine = doc.lineAt(anchorTo).number + 1; // first hidden line
  const endLine = doc.lineAt(regionTo).number;
  const els: HTMLElement[] = [];
  for (let n = startLine; n <= endLine && n <= doc.lines; n++) {
    const line = doc.line(n);
    const visible = view.visibleRanges.some((r) => line.from <= r.to && line.to >= r.from);
    if (!visible) continue;
    const el = lineEl(view, line.from);
    if (el) els.push(el);
  }
  return els;
}

function clearFoldStyles(el: HTMLElement): void {
  el.style.overflow = "";
  el.style.willChange = "";
}

/**
 * Animate a region's on-screen lines collapsing to / expanding from 0 height, then run
 * `done`. Uses the Web Animations API rather than CSS transitions: WAAPI takes explicit
 * from/to keyframes, so it can't suffer the transition gotcha where the 0-height start
 * value is never painted in its own frame (which made expand silently snap while only
 * opacity faded). For expand the un-fold has already been committed by the caller, so we
 * grab the lines one frame later — after CodeMirror has rendered and measured them — and
 * animate those stable elements up from 0. Falls back to an immediate `done()` when
 * nothing is on-screen or motion is reduced.
 */
function animateFold(view: EditorView, getEls: () => HTMLElement[], dir: "collapse" | "expand", done: () => void): void {
  if (reducedMotion()) {
    done();
    return;
  }
  const run = () => {
    const els = getEls();
    if (els.length === 0) {
      done();
      return;
    }
    // The native line-number gutter (if any) can't be slid in lock-step with the content
    // rows — CodeMirror renders the numbers at their final layout positions and re-measures
    // them on its own schedule, so any per-row tween we apply ends up fighting CM and leaves
    // numbers misaligned. Instead hide the whole gutter for the brief slide and fade it back
    // in once the fold has committed (CM re-lays it out). Opacity never touches CM's height
    // bookkeeping, so the numbers can't get stuck — they just reappear correctly placed.
    const gutter = view.dom.querySelector<HTMLElement>(".cm-gutters");
    if (gutter) {
      gutter.style.transition = "none";
      gutter.style.opacity = "0";
    }
    const restoreGutter = () => {
      if (gutter) {
        gutter.style.transition = "opacity 140ms ease";
        gutter.style.opacity = "1";
      }
    };
    const heights = els.map((el) => el.getBoundingClientRect().height); // current = full height
    let pending = els.length;
    let settled = false;
    // After the per-line height tween finishes we strip the inline heights, but CodeMirror's
    // height map may have sampled the transient (0…full) heights mid-animation and cached them.
    // Its line-number gutter is positioned from that map, so the numbers stay misaligned until
    // some later interaction (a click) forces a re-measure. Force one ourselves once the lines
    // are back to their natural height so the gutter realigns immediately.
    const settle = () => {
      els.forEach(clearFoldStyles);
      done();
      restoreGutter();
      view.requestMeasure();
    };
    const finish = () => {
      if (settled) return;
      if (--pending > 0) return;
      settled = true;
      settle();
    };
    els.forEach((el, i) => {
      el.style.overflow = "hidden";
      el.style.willChange = "height, opacity";
      const from = dir === "collapse" ? { height: `${heights[i]}px`, opacity: 1 } : { height: "0px", opacity: 0 };
      const to = dir === "collapse" ? { height: "0px", opacity: 0 } : { height: `${heights[i]}px`, opacity: 1 };
      // collapse holds the closed end (fill:forwards) until the caller commits the fold;
      // expand lets the line revert to its natural height when the keyframes finish.
      const anim = el.animate([from, to], { duration: ANIM_MS, easing: ANIM_EASE, fill: dir === "collapse" ? "forwards" : "none" });
      anim.onfinish = finish;
      anim.oncancel = finish;
    });
    // Safety net: if a tab is backgrounded mid-animation, onfinish can be delayed
    // indefinitely (WAAPI is throttled like rAF) — settle anyway so state stays consistent.
    setTimeout(() => {
      if (settled) return;
      settled = true;
      settle();
    }, ANIM_MS + 200);
  };
  // Expand: wait one frame so CM has finished re-rendering the just-revealed lines.
  if (dir === "expand") requestAnimationFrame(run);
  else run();
}

/**
 * Collapsible headings & bullets (markdown) or indented keys (yaml). `getPath`
 * supplies the current note path (stable for the lifetime of this editor view),
 * used as the persistence key for locked folds.
 */
export function foldBlocks(
  getPath: () => string,
  mode: FoldMode = "markdown",
  opts: { hasGutter?: boolean } = {},
): Extension {
  const path = getPath();
  const hasGutter = opts.hasGutter ?? false;

  const field = StateField.define<FoldState>({
    create(state) {
      const locked = loadLocked(path);
      return { locked, ephemeral: new Set(), deco: buildDeco(state.doc, mode, locked, locked, hasGutter) };
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
      return { locked, ephemeral, deco: buildDeco(tr.state.doc, mode, folded, locked, hasGutter) };
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
  });

  // Toggle a block's fold (left-click) or lock (right-click) with a height animation:
  // collapse animates the visible region lines to 0 *then* commits the fold; expand
  // commits first (lines re-render) then animates them up from 0. `toggleLock` always
  // lands folded, so it only animates when collapsing from an expanded block.
  const animatedToggle = (view: EditorView, id: string, which: "fold" | "lock"): void => {
    const guard = busy(view);
    if (guard.has(id)) return; // an animation for this block is already in flight
    const st = view.state.field(field);
    const folded = st.locked.has(id) || st.ephemeral.has(id);
    const effect = which === "fold" ? toggleFold.of(id) : toggleLock.of(id);
    const dir = which === "fold" ? (folded ? "expand" : "collapse") : folded ? "none" : "collapse";
    const b = scanFoldables(view.state.doc, mode).find((x) => x.id === id);

    // When collapsing a region that contains the caret/selection, pull the caret back to
    // the still-visible anchor line so it isn't stranded inside the now-hidden text.
    const sel = view.state.selection.main;
    const cursorInRegion = dir === "collapse" && !!b && sel.from <= b.regionTo && sel.to >= b.anchorTo;
    const commit = () =>
      preserveScroll(view, () =>
        view.dispatch({ effects: effect, ...(cursorInRegion ? { selection: { anchor: b!.anchorTo } } : {}) }),
      );

    if (dir === "none" || reducedMotion() || !b) {
      commit();
      return;
    }
    guard.add(id);
    const release = () => guard.delete(id);
    const getEls = () => regionLineEls(view, b.anchorTo, b.regionTo);
    if (dir === "collapse") {
      // Rotate the chevron now (it's normally driven by the fold state, which we don't
      // commit until the slide finishes — otherwise the triangle visibly lags the content).
      const escId = id.replace(/(["\\])/g, "\\$1");
      view.dom.querySelector<HTMLElement>(`.cm-fold-arrow[data-fold-id="${escId}"]`)?.classList.add("is-collapsed");
      animateFold(view, getEls, "collapse", () => {
        commit();
        release();
      });
    } else {
      commit(); // un-fold so the region's lines render again…
      animateFold(view, getEls, "expand", release); // …then slide them open
    }
  };

  // Keep `--bismuth-fold-gutter-w` (read by the depth-0 triangle's `left` calc above) in sync
  // with the live line-number gutter width, so the collapser always parks just left of the
  // numbers regardless of how many digits they grow to. Only needed when a gutter exists.
  const gutterWidthSync = ViewPlugin.fromClass(
    class {
      lastWidth = -1; // skip the style write (and any reflow) when the width hasn't changed
      constructor(view: EditorView) {
        this.measure(view);
      }
      update(u: ViewUpdate) {
        if (u.geometryChanged || u.docChanged || u.viewportChanged) this.measure(u.view);
      }
      measure(view: EditorView): void {
        view.requestMeasure({
          key: "bismuth-fold-gutter-w",
          read: (v) => (v.dom.querySelector(".cm-gutters") as HTMLElement | null)?.offsetWidth ?? 0,
          write: (w, v) => {
            if (w === this.lastWidth) return;
            this.lastWidth = w;
            v.dom.style.setProperty("--bismuth-fold-gutter-w", `${w}px`);
          },
        });
      }
    },
  );

  // Scoped to gutter editors only (so it can never make a gutter-less note's hypothetical
  // future gutter unclickable): the line-number gutter sits at z-index 200 above the content
  // layer that hosts the fold triangles. The triangles now park to its left, but make the
  // gutter ignore pointer events too — these line numbers aren't interactive, so this just
  // guarantees a click always reaches the collapser even if the two ever overlap (narrow pane).
  const gutterClickThrough = EditorView.theme({ ".cm-gutters": { "pointer-events": "none" } });

  return [
    field,
    ...(hasGutter ? [gutterWidthSync, gutterClickThrough] : []),
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
        animatedToggle(view, id, "fold");
        return true;
      },
      contextmenu: (e, view) => {
        const el = (e.target as HTMLElement).closest(".cm-fold-arrow") as HTMLElement | null;
        if (!el?.dataset.foldId) return false;
        e.preventDefault();
        e.stopPropagation();
        const id = el.dataset.foldId;
        animatedToggle(view, id, "lock");
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
      // overflow-anchor:none — see above. scrollbar-gutter:stable always reserves the
      // vertical scrollbar's width, so folding/expanding (or any height change) that adds
      // or removes the scrollbar can't shift the centered content sideways.
      ".cm-scroller": { "overflow-anchor": "none", "scrollbar-gutter": "stable" },
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
        // Centroid sits at (50%,50%) so rotating about the box center pivots in place —
        // an off-center triangle visibly drifts sideways as it turns.
        "clip-path": "polygon(27% 12%, 27% 88%, 96% 50%)",
        transform: "rotate(90deg)", // expanded → points down
        "transform-origin": "center",
        transition: "transform 90ms ease",
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
