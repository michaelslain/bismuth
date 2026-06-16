// app/src/editor/katexLoader.ts
//
// Lazy KaTeX loader + the single shared math-render config for the whole app.
// KaTeX (JS + CSS, ~280KB) is only needed when a note actually contains math, so we
// defer it out of the entry chunk and load it on first use.
//
// CodeMirror widget `toDOM()` is synchronous, so we can't await the import there.
// Instead: the first math render kicks off the dynamic import; until it resolves
// `renderMath` returns an empty string (the widget shows nothing for a frame), and
// every interested widget registers via `onMathReady` so it can re-render the moment
// KaTeX lands. Once loaded, `renderMath` is fully synchronous.
//
// Obsidian parity: Obsidian renders math with MathJax 3 + mhchem + a user preamble.
// To match it as closely as KaTeX allows we (a) side-effect-import mhchem so `\ce`/`\pu`
// work, (b) run KaTeX in lenient mode (`strict: false`) so unicode-in-math and `\\` in
// display mode don't error, (c) allow `\href`/`\url` links via a narrow `trust` fn,
// (d) seed a long-lived `macros` object from the `editor.mathMacros` preamble setting
// (mirroring Obsidian's preamble.sty) and register no-op macros for MathJax-isms KaTeX
// lacks (`\require`/`\label`/…) so Obsidian-authored notes don't render as red errors.

import type { KatexOptions, TrustContext } from "katex";
import { settings } from "../settings";
import { parseMathMacros } from "./mathMacros";

type KatexModule = typeof import("katex");

let katex: KatexModule["default"] | null = null;
let loading: Promise<void> | null = null;
const readyCbs = new Set<() => void>();

// A KaTeX function macro: receives the macro expander and returns its expansion. The
// expander type isn't exported by katex, so `context` is loosely typed (which also keeps
// the macro map assignable to KaTeX's `macros` option). `gobbleArg` swallows ONE `{…}`
// argument and expands to `replace` — a plain "" string macro is zero-argument, so e.g.
// `\label{eq:1}` would otherwise leave "eq:1" rendering as stray math.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MacroFn = (context: any) => string;
const gobbleArg = (replace: string): MacroFn => (context) => { context.consumeArgs(1); return replace; };

// MathJax-isms KaTeX has no equivalent for → neutralized so notes authored for Obsidian
// don't render as red error text. `\require` is unneeded (mhchem is static-imported
// below); the numbering/label/cross-ref commands have no document-wide registry in KaTeX
// (each render is an isolated parse) so they degrade rather than erroring. Passed on
// every render; with globalGroup off, KaTeX never mutates this object.
const NOOP_MACROS: Record<string, string | MacroFn> = {
  "\\nonumber": "", //          (no argument)
  "\\notag": "", //             (no argument)
  "\\require": gobbleArg(""), //   \require{pkg}  — swallow the package name
  "\\label": gobbleArg(""), //     \label{id}     — no label registry in KaTeX
  "\\eqref": gobbleArg("(?)"), //  \eqref{id}     — no cross-refs; show a placeholder
  "\\ref": gobbleArg("(?)"),
};

// User macros from the `editor.mathMacros` preamble (Obsidian preamble.sty style),
// parsed into a KaTeX macros object. Passed via the `macros` OPTION rather than in-band
// \newcommand because the option silently OVERRIDES builtins (e.g. \R) with no
// redefinition error — matching MathJax/Obsidian. Read at RENDER time (not seeded once)
// so it reflects the live setting regardless of whether the settings store has hydrated
// from the server by the time KaTeX first loads; cached so we only re-parse when the
// preamble string actually changes (edits otherwise apply on the next render).
let _macrosRaw: string | null = null;
let _macrosParsed: Record<string, string> = {};
function userMacros(): Record<string, string> {
  // Trimmed so a whitespace-only settings edit doesn't bust the cache (parseMathMacros
  // ignores surrounding whitespace anyway).
  const raw = (settings.editor?.mathMacros ?? "").trim();
  if (raw !== _macrosRaw) {
    _macrosRaw = raw;
    _macrosParsed = parseMathMacros(raw);
  }
  return _macrosParsed;
}

// A narrow trust function: allow ONLY `\href`/`\url` with http/https/relative protocols.
// Everything else KaTeX gates behind `trust` (`\includegraphics`, the raw `\html*`
// class/id/style injectors) stays blocked. On non-editor surfaces the output also passes
// through sanitizeHtml (DOMPurify) as a second layer.
function trust(ctx: TrustContext): boolean {
  if (ctx.command !== "\\href" && ctx.command !== "\\url") return false;
  const p = ctx.protocol;
  return p === "http" || p === "https" || p === "_relative";
}

/** The shared KaTeX options. `displayMode` is the only per-call variant. */
function options(displayMode: boolean): KatexOptions {
  return {
    throwOnError: false, // unsupported command → red source text, never throws
    displayMode, //          $$ = display block, $ = inline (per-call)
    strict: false, //        MathJax/Obsidian leniency: unicode in math, `\\` in display,
    //                       unknown unicode symbols; also silences console.warn spam
    // User preamble macros (override builtins, no redefine error) + MathJax-ism no-ops.
    // Fresh object each render so an in-expr `\gdef` can't mutate the shared sources.
    macros: { ...NOOP_MACROS, ...userMacros() },
    trust, //                links only; arbitrary html / includegraphics stay blocked
    maxSize: 100, //         cap \rule / \Huge blowups now that trust + macros are on
    maxExpand: 1000, //      guard \def loops (default; do NOT raise to Infinity)
    minRuleThickness: 0.06, // keep fraction bars / radicals crisp at editor zoom
    fleqn: false, //         center display math (Obsidian default; editor CSS left-aligns)
  };
}

function ensureLoaded(): void {
  if (katex || loading) return;
  loading = Promise.all([
    import("katex"),
    // Load the stylesheet from the same async chunk so glyph fonts/metrics render
    // correctly (previously imported eagerly in index.tsx).
    import("katex/dist/katex.min.css"),
  ])
    .then(([mod]) => {
      katex = mod.default;
      // mhchem (\ce, \pu) is a SIDE-EFFECT import that mutates the katex singleton, so it
      // MUST run AFTER `katex` is assigned (katex#3758) — chained here, not in the
      // Promise.all above. Returning the promise keeps `loading` pending until it lands,
      // so the first render already supports \ce.
      return import("katex/contrib/mhchem");
    })
    .then(() => {
      // Notify every mounted math widget so it can re-render now that KaTeX exists.
      for (const cb of readyCbs) {
        try { cb(); } catch { /* ignore a single widget's re-render failure */ }
      }
      readyCbs.clear();
    });
}

/**
 * Render a math expression to an HTML string. Returns the rendered KaTeX once the
 * library is loaded; before that it triggers the lazy load and returns "" (the
 * caller should also subscribe via `onMathReady` to re-render when it's ready).
 */
export function renderMath(expr: string, displayMode: boolean): string {
  if (katex) {
    return katex.renderToString(expr, options(displayMode));
  }
  ensureLoaded();
  return "";
}

/**
 * Run `cb` once KaTeX has loaded (immediately if already loaded). Returns an
 * unsubscribe function: call it (e.g. from a widget's `destroy()`) to drop a still-
 * pending callback so it can't fire on a node that's already been torn down. When
 * KaTeX is already loaded the callback runs synchronously and the returned function
 * is a no-op. Also used to warm the lazy chunk (e.g. at app boot) so non-editor
 * surfaces that render synchronously (cards, transclusion) have KaTeX ready.
 */
export function onMathReady(cb: () => void): () => void {
  if (katex) {
    cb();
    return () => {};
  }
  ensureLoaded();
  readyCbs.add(cb);
  return () => {
    readyCbs.delete(cb);
  };
}

/**
 * Resolve once KaTeX (+ mhchem) has loaded, triggering the lazy load if needed. For
 * callers that produce a STATIC HTML snapshot which can't be progressively upgraded —
 * notably the exporters, whose output string / off-screen iframe the live-document
 * `onMathReady` re-render can't reach. Await this, then (re-)render so math isn't blank.
 */
export function whenMathReady(): Promise<void> {
  return new Promise((resolve) => onMathReady(resolve));
}

/** True once KaTeX has loaded — lets a caller skip the async wait on the warm path. */
export function isMathLoaded(): boolean {
  return katex !== null;
}
