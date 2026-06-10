// app/src/editor/harper.ts
// CM6 spell + grammar checking via Harper (WASM, in-browser). App-only: never
// import this from core/ (the $bunfs WASM path bug). The pure offset/body/store
// logic lives in sibling modules and is unit-tested headless; this file is the glue.
//
// Diagnostics carry quick-fix actions; the right-click menu that surfaces them is
// the shared editorContextMenu (editor/contextMenu.ts), so spelling, grammar, and
// property menus all look identical. Hover tooltips are suppressed (tooltipFilter).
import { linter, type Diagnostic, type Action } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { WorkerLinter, Dialect, type Lint } from "harper.js";
// Harper 2.x requires a BinaryModule to construct a Linter. The `harper.js/binary`
// subpath ships a ready-made module that loads the WASM from its own URL — which is
// exactly why vite.config.ts excludes `harper.js` from pre-bundling (so the WASM
// path resolves correctly at runtime).
import { binary } from "harper.js/binary";
import { scalarToUtf16 } from "./harperOffsets";
import { loadHarperState, addWord, removeWord, addIgnoredLint, normalizeDictWord } from "./harperStore";
import { relintNeedsRefresh } from "./relint";
import { relintAllEditors } from "../editorRegistry";

// markClass per Harper diagnostic, chosen by lint kind: spelling vs grammar. Drives
// the squiggle color (red vs blue, styled in livePreview's theme).
const SPELL_MARK = "spell-mark";
const GRAMMAR_MARK = "grammar-mark";

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
      // Normalize on import too, so words saved before this fix (possibly stored
      // capitalized, hence case-sensitive) become effective for every casing.
      const dictWords = [...new Set(words.map(normalizeDictWord).filter(Boolean))];
      if (dictWords.length) await inst.importWords(dictWords);
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

/** Add a word to the personal dictionary and apply it everywhere: persist it, import
 *  it into the live linter, and re-lint every open editor so its squiggles clear at
 *  once. The single entry point for both the right-click action and the dictionary
 *  editor — keeps persistence and the live linter in lockstep on the canonical form. */
export async function addDictionaryWord(word: string): Promise<void> {
  const w = normalizeDictWord(word);
  if (!w) return;
  addWord(w);
  await ensureSetup();
  await getLinter().importWords([w]);
  relintAllEditors();
}

/** Remove a user-added word from the personal dictionary and apply it everywhere:
 *  persist the removal, re-sync the live linter, and re-lint every open editor so the
 *  word is flagged again. harper.js 2.x has no remove-single API, so the live sync is
 *  clearWords() + re-import of the survivors. Never touches the curated dictionary. */
export async function removeDictionaryWord(word: string): Promise<void> {
  removeWord(normalizeDictWord(word));
  // Normalize + dedupe the survivors the same way ensureSetup does, so re-importing
  // them can't regress a legacy capitalized entry from case-insensitive back to
  // case-sensitive (clearWords wiped the normalized form ensureSetup had loaded).
  const remaining = [...new Set(loadHarperState().words.map(normalizeDictWord).filter(Boolean))];
  await ensureSetup();
  const inst = getLinter();
  await inst.clearWords();
  if (remaining.length) await inst.importWords(remaining);
  relintAllEditors();
}

// Minimal slice of EditorView we need to re-validate a span at apply time.
// (Narrow on purpose so the guard is pure and unit-testable without a real view.)
export interface DocSlicer {
  state: { doc: { sliceString(from: number, to: number): string } };
}

/** True iff the document still holds the originally-flagged text at [from, to).
 *  Guards out-of-band quick-fixes (surfaced via the shared right-click menu, not
 *  CM's diagnostic pipeline) against stale offsets after the doc has changed: if
 *  the user edits elsewhere before applying a fix, the baked-in offsets may now
 *  point at unrelated text, so applying the change would corrupt the document. */
export function spanStillMatches(
  view: DocSlicer,
  from: number,
  to: number,
  flagged: string,
): boolean {
  const doc = view.state.doc;
  // sliceString clamps out-of-range offsets, so an offset now past EOF returns a
  // shorter string than `flagged` and correctly fails the equality check.
  return doc.sliceString(from, to) === flagged;
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
  // Spelling vs grammar/style/agreement — computed once and reused for both the
  // squiggle color (markClass) and the "Add to dictionary" gate.
  const isSpelling = /spell/i.test(lint.lint_kind());

  const actions: Action[] = [];
  for (const sug of lint.suggestions()) {
    const replacement = sug.get_replacement_text();
    actions.push({
      name: replacement === "" ? "Remove" : `→ ${replacement}`,
      apply(v: EditorView) {
        // These quick-fixes are surfaced out-of-band via the shared right-click
        // menu, so CM's diagnostic pipeline doesn't remap/clear them when the doc
        // changes between lint resolution and apply. Re-validate the span: only
        // dispatch if it still holds the originally-flagged text, else no-op.
        if (spanStillMatches(v, from, to, flagged)) {
          v.dispatch({ changes: { from, to, insert: replacement } });
        }
      },
    });
  }
  // "Add to dictionary" only for spelling lints — adding a multi-word grammar
  // phrase (e.g. "a apple") as a dictionary word is meaningless and pollutes the
  // user dictionary.
  if (isSpelling && flagged) {
    actions.push({
      name: "Add to dictionary",
      apply() {
        // Persist + import into the live linter + re-lint all open editors via the
        // shared entry point (normalizes to the canonical lowercase form internally).
        void addDictionaryWord(flagged);
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
        relintAllEditors();
      })();
    },
  });

  return {
    from,
    to,
    severity: "error",
    message: lint.message(),
    // Spelling → red, everything else Harper flags (grammar/style/agreement…) → blue.
    markClass: isSpelling ? SPELL_MARK : GRAMMAR_MARK,
    actions,
  };
}

export function harperSpellcheck(opts: HarperOpts): Extension {
  prewarmOnIdle();
  return linter(
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
      // "Add to dictionary" / "Ignore" mutate linter state without editing the doc,
      // so a doc-change can't trigger the re-lint that clears the mark. requestRelint
      // dispatches relintEffect; this predicate makes the lint plugin re-run on it.
      needsRefresh: relintNeedsRefresh,
      // No hover boxes anywhere — fixes are surfaced via the shared right-click
      // menu (editorContextMenu), so every diagnostic behaves the same way.
      tooltipFilter: () => [],
    },
  );
}
