// Shared per-line in-block line numbers for code-like blocks in the editor:
// fenced ``` code (livePreview), the YAML frontmatter block (livePreview), and the
// revealed ```query source (queryBlock). A numbered body line carries its 1-based
// in-block number in `data-codeline`; the gutter number is drawn by the
// `.cm-code-numbered::before` rule, hung in the editor's left padding so it adds no
// layout shift to the code text. (The base-file Source textarea uses its own DOM
// gutter — see BaseView — since a <textarea> can't carry per-line ::before.)
import { Decoration, EditorView } from "@codemirror/view";

// Cached per (class, number) so repeated renders reuse instances.
const cache = new Map<string, Decoration>();

/** A line decoration giving a `cls` line its 1-based in-block number `n`. */
export function numberedLine(cls: string, n: number): Decoration {
  const key = `${cls}:${n}`;
  let d = cache.get(key);
  if (!d) {
    d = Decoration.line({ class: `${cls} cm-code-numbered`, attributes: { "data-codeline": String(n) } });
    cache.set(key, d);
  }
  return d;
}

// The gutter-number style. Lives here (not inline in livePreview) so queryBlock —
// which loads even when livePreview is off — stays self-contained.
export const codeLineNumberTheme = EditorView.theme({
  ".cm-code-numbered": { position: "relative" },
  ".cm-code-numbered::before": {
    content: "attr(data-codeline)",
    position: "absolute",
    left: "-2.7em",
    width: "2em",
    "text-align": "right",
    color: "color-mix(in srgb, var(--fg) 28%, transparent)",
    "font-variant-numeric": "tabular-nums",
    "-webkit-user-select": "none",
    "user-select": "none",
    "pointer-events": "none",
  },
});
