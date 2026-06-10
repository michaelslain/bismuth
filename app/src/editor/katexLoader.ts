// app/src/editor/katexLoader.ts
//
// Lazy KaTeX loader. KaTeX (JS + CSS, ~280KB) is only needed when a note actually
// contains math, so we defer it out of the entry chunk and load it on first use.
//
// CodeMirror widget `toDOM()` is synchronous, so we can't await the import there.
// Instead: the first math render kicks off the dynamic import; until it resolves
// `renderMath` returns an empty string (the widget shows nothing for a frame), and
// every interested widget registers via `onMathReady` so it can re-render the moment
// KaTeX lands. Once loaded, `renderMath` is fully synchronous (identical output to the
// previous static `katex.renderToString`).

type KatexModule = typeof import("katex");

let katex: KatexModule["default"] | null = null;
let loading: Promise<void> | null = null;
const readyCbs = new Set<() => void>();

function ensureLoaded(): void {
  if (katex || loading) return;
  loading = Promise.all([
    import("katex"),
    // Load the stylesheet from the same async chunk so glyph fonts/metrics render
    // correctly (previously imported eagerly in index.tsx).
    import("katex/dist/katex.min.css"),
  ]).then(([mod]) => {
    katex = mod.default;
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
    return katex.renderToString(expr, { throwOnError: false, displayMode });
  }
  ensureLoaded();
  return "";
}

/**
 * Run `cb` once KaTeX has loaded (immediately if already loaded). Returns an
 * unsubscribe function: call it (e.g. from a widget's `destroy()`) to drop a still-
 * pending callback so it can't fire on a node that's already been torn down. When
 * KaTeX is already loaded the callback runs synchronously and the returned function
 * is a no-op.
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
