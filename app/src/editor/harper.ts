// app/src/editor/harper.ts
// CM6 spell + grammar checking via Harper (WASM, in-browser). App-only: never
// import this from core/ (the $bunfs WASM path bug). The pure offset/body/store
// logic lives in sibling modules and is unit-tested headless; this file is the glue.
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
    markClass: "harper-error",
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
    { delay: 400 },
  );
}
