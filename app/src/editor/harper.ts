// app/src/editor/harper.ts
// CM6 spell + grammar checking via Harper (WASM, in-browser). App-only: never
// import this from core/ (the $bunfs WASM path bug). The pure offset/body/store
// logic lives in sibling modules and is unit-tested headless; this file is the glue.
import { linter, forEachDiagnostic, forceLinting, type Diagnostic, type Action } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

// markClass per Harper diagnostic, chosen by lint kind: spelling vs grammar. It
// drives the squiggle color (red vs blue, styled in livePreview's theme) and lets
// the right-click menu + tooltip filter recognise Harper marks (their suggestions
// live in the menu, so Harper's hover box is suppressed).
const SPELL_MARK = "spell-mark";
const GRAMMAR_MARK = "grammar-mark";
const HARPER_MARKS = new Set<string>([SPELL_MARK, GRAMMAR_MARK]);
import { WorkerLinter, Dialect, type Lint } from "harper.js";
// Harper 2.x requires a BinaryModule to construct a Linter. The `harper.js/binary`
// subpath ships a ready-made module that loads the WASM from its own URL — which is
// exactly why vite.config.ts excludes `harper.js` from pre-bundling (so the WASM
// path resolves correctly at runtime).
import { binary } from "harper.js/binary";
import { scalarToUtf16 } from "./harperOffsets";
import { loadHarperState, addWord, addIgnoredLint } from "./harperStore";

export interface HarperOpts {
  // Returns the document char range of the prose body (frontmatter skipped).
  getBodyRange: (doc: string) => { from: number; to: number };
}

// Module-level singleton: one WorkerLinter for the whole app. Created lazily and
// prewarmed during idle so the first lint isn't paying WASM init latency inline.
let linterInstance: WorkerLinter | null = null;
let setupPromise: Promise<void> | null = null;

function getLinter(): WorkerLinter {
  if (!linterInstance) {
    // Harper 2.x: WorkerLinter takes a LinterInit { binary, dialect? }. (The older
    // `{ dialect }`-only signature in early docs no longer type-checks against the
    // shipped index.d.ts — `binary` is required.)
    linterInstance = new WorkerLinter({ binary, dialect: Dialect.American });
  }
  return linterInstance;
}

// Idempotent: ensures setup() has run and the persisted dictionary / ignored
// lints are loaded into the linter. Safe to await repeatedly.
function ensureSetup(): Promise<void> {
  if (!setupPromise) {
    const inst = getLinter();
    setupPromise = (async () => {
      await inst.setup();
      const { words, ignoredLints } = loadHarperState();
      if (words.length) await inst.importWords(words);
      for (const blob of ignoredLints) {
        try {
          await inst.importIgnoredLints(blob);
        } catch {
          // a stale/incompatible ignore blob shouldn't break linting
        }
      }
    })();
  }
  return setupPromise;
}

// Kick off WASM init during browser idle (falls back to a short timeout). Never
// blocks the first keystroke — the linter's {delay} also guards against that.
function prewarmOnIdle(): void {
  const start = () => void ensureSetup();
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void) => void })
    .requestIdleCallback;
  if (ric) ric(start);
  else setTimeout(start, 600);
}

/** Map one Harper Lint (scalar-indexed, relative to the linted body slice) to a
 *  CM Diagnostic at absolute document offsets, with quick-fix + dict/ignore actions. */
function lintToDiagnostic(
  view: EditorView,
  bodyText: string,
  bodyFrom: number,
  lint: Lint,
): Diagnostic {
  const span = lint.span();
  // Harper offsets are Unicode scalars relative to bodyText; remap to UTF-16,
  // then shift by the body's absolute start offset in the full document.
  const from = bodyFrom + scalarToUtf16(bodyText, span.start);
  const to = bodyFrom + scalarToUtf16(bodyText, span.end);
  const flagged = view.state.doc.sliceString(from, to);

  const actions: Action[] = [];
  for (const sug of lint.suggestions()) {
    const replacement = sug.get_replacement_text();
    actions.push({
      name: replacement === "" ? "Remove" : `→ ${replacement}`,
      apply(v: EditorView) {
        v.dispatch({ changes: { from, to, insert: replacement } });
      },
    });
  }
  // "Add to dictionary" for misspellings: persist the word and re-import live.
  if (flagged) {
    actions.push({
      name: "Add to dictionary",
      apply() {
        addWord(flagged);
        void getLinter().importWords([flagged]);
      },
    });
  }
  // "Ignore" this specific lint: persist its exported ignore blob.
  actions.push({
    name: "Ignore",
    apply() {
      const inst = getLinter();
      void (async () => {
        await inst.ignoreLint(bodyText, lint);
        addIgnoredLint(await inst.exportIgnoredLints());
      })();
    },
  });

  return {
    from,
    to,
    severity: "error",
    message: lint.message(),
    // Spelling → red, everything else Harper flags (grammar/style/agreement…) → blue.
    markClass: /spell/i.test(lint.lint_kind()) ? SPELL_MARK : GRAMMAR_MARK,
    actions,
  };
}

// ---- right-click suggestions menu -------------------------------------------
// Spellcheck suggestions are shown ONLY on right-click (not on hover), in a small
// styled menu — the default lint hover tooltip is suppressed via tooltipFilter.

let openMenu: HTMLElement | null = null;

function closeHarperMenu(): void {
  if (openMenu) {
    openMenu.remove();
    openMenu = null;
  }
  document.removeEventListener("mousedown", onDocMouseDown, true);
  document.removeEventListener("keydown", onKeyDown, true);
  window.removeEventListener("scroll", closeHarperMenu, true);
  window.removeEventListener("resize", closeHarperMenu, true);
}

function onDocMouseDown(e: MouseEvent): void {
  if (openMenu && !openMenu.contains(e.target as Node)) closeHarperMenu();
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === "Escape") closeHarperMenu();
}

function menuItem(label: string, onClick: () => void): HTMLButtonElement {
  const item = document.createElement("button");
  item.className = "harper-menu-item";
  item.textContent = label;
  item.addEventListener("click", onClick);
  return item;
}

function showHarperMenu(
  view: EditorView,
  x: number,
  y: number,
  message: string,
  from: number,
  to: number,
  actions: readonly Action[],
): void {
  closeHarperMenu();
  const menu = document.createElement("div");
  menu.className = "harper-menu";

  if (message) {
    const header = document.createElement("div");
    header.className = "harper-menu-header";
    header.textContent = message;
    menu.appendChild(header);
  }

  const run = (action: Action) => () => {
    action.apply(view, from, to);
    closeHarperMenu();
    // Suggestions edit the doc (re-lints automatically); dict/ignore don't, so
    // nudge a re-lint to clear the squiggle once the async update lands.
    setTimeout(() => forceLinting(view), 50);
    view.focus();
  };

  const isSuggestion = (a: Action) => a.name.startsWith("→") || a.name === "Remove";
  const suggestions = actions.filter(isSuggestion);
  const meta = actions.filter((a) => !isSuggestion(a));

  if (suggestions.length) {
    for (const a of suggestions) menu.appendChild(menuItem(a.name, run(a)));
  } else {
    const none = document.createElement("div");
    none.className = "harper-menu-empty";
    none.textContent = "No suggestions";
    menu.appendChild(none);
  }

  if (meta.length) {
    const sep = document.createElement("div");
    sep.className = "harper-menu-sep";
    menu.appendChild(sep);
    for (const a of meta) menu.appendChild(menuItem(a.name, run(a)));
  }

  document.body.appendChild(menu);
  // Keep the menu inside the viewport.
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;

  openMenu = menu;
  document.addEventListener("mousedown", onDocMouseDown, true);
  document.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("scroll", closeHarperMenu, true);
  window.addEventListener("resize", closeHarperMenu, true);
}

/** Right-click over a Harper mark → show the suggestions menu (suppresses the
 *  native context menu only there; elsewhere the default menu is untouched). */
function harperContextMenu(): Extension {
  return EditorView.domEventHandlers({
    contextmenu(event, view) {
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos == null) return false;
      const hits: { from: number; to: number; d: Diagnostic }[] = [];
      forEachDiagnostic(view.state, (d, from, to) => {
        if (d.markClass && HARPER_MARKS.has(d.markClass) && pos >= from && pos <= to) {
          hits.push({ from, to, d });
        }
      });
      if (hits.length === 0) return false;
      event.preventDefault();
      // Stop the event reaching the pane's onContextMenu (PaneTree.tsx), which
      // would otherwise pop the app's editor context menu on top of ours.
      event.stopPropagation();
      const { from, to, d } = hits[hits.length - 1];
      showHarperMenu(view, event.clientX, event.clientY, d.message, from, to, d.actions ?? []);
      return true;
    },
  });
}

export function harperSpellcheck(opts: HarperOpts): Extension {
  prewarmOnIdle();
  return [
    linter(
      async (view): Promise<Diagnostic[]> => {
        await ensureSetup();
        const doc = view.state.doc.toString();
        const { from, to } = opts.getBodyRange(doc);
        if (to <= from) return [];
        const bodyText = doc.slice(from, to);
        const lints = await getLinter().lint(bodyText, { language: "markdown" });
        return lints.map((l) => lintToDiagnostic(view, bodyText, from, l));
      },
      {
        delay: 400,
        // No hover box for Harper marks — their suggestions live in the
        // right-click menu. Other linters' tooltips (e.g. property type
        // errors) pass through untouched.
        tooltipFilter: (diagnostics) =>
          diagnostics.filter((d) => !(d.markClass && HARPER_MARKS.has(d.markClass))),
      },
    ),
    harperContextMenu(),
  ];
}
