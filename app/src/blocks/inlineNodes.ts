// app/src/blocks/inlineNodes.ts
// Custom INLINE ATOMS for the Milkdown visual block surface — the Obsidian-flavoured syntax
// that CommonMark doesn't model: `[[wikilink]]` (+ `#section`/`|alias`), `#tag`, inline
// `$math$`, `![[embed]]`/`![](url)`, and bare `https://…` URLs.
//
// Each atom follows the PROVEN $remark + $node + toMarkdown pattern (see the spike notes):
//   1. a `$remark` transformer tokenizes the syntax out of mdast `text` nodes into a custom
//      inline mdast node (so the ProseMirror parser receives a discrete node, not raw text);
//   2. a `$node` maps that mdast node to a ProseMirror INLINE ATOM (`atom: true`,
//      `contenteditable=false` chip) — un-editable as a unit, rendered as a styled span;
//   3. the `$node.toMarkdown` runner re-emits the atom VERBATIM.
//
// THE SERIALIZATION GOTCHA (the #1 risk): remark-stringify escapes `[`, `#`, `$` etc. in
// `text` nodes, so emitting the raw syntax as a `text` mdast node yields `\[\[Note]]`. The fix
// — verified byte-stable in milkdownSerialize.test.ts — is to emit it as an `html` mdast node,
// which mdast-util-to-markdown passes through UNTOUCHED. The chips therefore round-trip exactly
// to the source the block model stored.
//
// Atom granularity matches the per-block model: these live inside a single text-editable
// block's inline content (paragraph / heading title / list-item / task / quote text), so the
// block-level prefix (`#`, `- `, `> `, `- [ ]`) is owned by blockModel, never by Milkdown.

import type { MilkdownPlugin } from "@milkdown/ctx";
import { $remark, $node } from "@milkdown/utils";
import type { MarkdownNode } from "@milkdown/transformer";
import { escapeAttr } from "../htmlEscape";
import { renderMath, onMathReady } from "../editor/katexLoader";
import { sanitizeHtml } from "../sanitizeHtml";

// ---------------------------------------------------------------------------------------
// Generic atom factory
// ---------------------------------------------------------------------------------------

/** A custom inline-atom definition. `id` is the ProseMirror node name + mdast node type.
 *  `pattern` matches the syntax inside a text run (NO global flag — we clone it per scan).
 *  `raw(m)` returns the EXACT source slice to round-trip (defaults to the whole match).
 *  `dom(m)` builds the chip's display: a className + inner text (escaped) or innerHTML. */
interface AtomDef {
  id: string;
  pattern: RegExp;
  /** Verbatim source for the matched chip — what toMarkdown re-emits. */
  raw?: (m: RegExpExecArray) => string;
  /** The chip element spec: a CSS class + how to fill it. */
  dom: (m: RegExpExecArray, attrs: Record<string, string>) => HTMLSpanElement;
  /** Extra ProseMirror attrs to carry on the node (beyond `raw`), parsed from the match. */
  attrs?: (m: RegExpExecArray) => Record<string, string>;
}

/** Build the [`$remark` tokenizer, `$node` schema] plugin pair for one inline atom. */
function makeAtom(def: AtomDef): MilkdownPlugin[] {
  const { id, pattern } = def;
  const rawOf = def.raw ?? ((m: RegExpExecArray) => m[0]);

  // (1) Tokenize: walk the mdast tree, splitting every `text` node on the pattern into
  // alternating text + custom-atom nodes. The atom node carries `raw` (verbatim source) +
  // any extra attrs. Runs on BOTH parse directions' shared remark instance.
  const remarkPlugin = $remark(`oaInline_${id}`, () => () => (tree: unknown) => {
    visit(tree as MarkdownNode);
  });

  function visit(node: MarkdownNode): void {
    if (!node.children) return;
    const out: MarkdownNode[] = [];
    for (const child of node.children) {
      if (child.type === "text" && typeof child.value === "string" && matches(child.value)) {
        out.push(...split(child.value as string));
      } else {
        // Recurse into inline containers that wrap free prose (emphasis/strong), but NOT into
        // other atoms — and NOT into LINK-like nodes. A `link`/`image`'s text child is the
        // link LABEL (and its url lives in `node.url`), not free prose: tokenizing it would (a)
        // turn a bare-url label into an `oaUrl` chip, which breaks mdast's autolink detection
        // (`formatLinkAsAutolink` requires the sole child to be a `text` node) so an explicit
        // `<https://x>` would be rewritten to `[https://x](https://x)`, and (b) is semantically
        // wrong — the label isn't a standalone wikilink/tag/math token. So skip them entirely.
        if (child.type !== id && !isLinkLike(child.type)) visit(child);
        out.push(child);
      }
    }
    node.children = out;
  }

  function matches(value: string): boolean {
    // Fresh, non-global regex so `.test` isn't stateful across calls.
    return new RegExp(pattern.source, pattern.flags.replace("g", "")).test(value);
  }

  function split(value: string): MarkdownNode[] {
    const rx = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
    const out: MarkdownNode[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(value))) {
      // Some patterns capture a leading boundary char (whitespace) in group 0; the chip should
      // start at the captured token, so honour an optional `index` offset via group prefix.
      const tokenStart = m.index + leadingOffset(m);
      if (tokenStart > last) out.push({ type: "text", value: value.slice(last, tokenStart) });
      const node: MarkdownNode = { type: id, raw: rawOf(m), ...(def.attrs ? def.attrs(m) : {}) };
      out.push(node);
      last = m.index + m[0].length;
      if (m.index === rx.lastIndex) rx.lastIndex++; // guard against zero-width matches
    }
    if (last < value.length) out.push({ type: "text", value: value.slice(last) });
    return out;
  }

  // If group 1 exists and the match begins with a non-token boundary (e.g. the `\s` before a
  // #tag), skip that boundary so the chip covers only the token. We detect it by re-finding the
  // token via `rawOf`. Simpler: patterns that need this set `raw` to the token and we align by
  // searching for it. To stay robust, compute the offset of `rawOf(m)` within `m[0]`.
  function leadingOffset(m: RegExpExecArray): number {
    const token = rawOf(m);
    const idx = m[0].indexOf(token);
    return idx > 0 ? idx : 0;
  }

  // (2)+(3) The ProseMirror inline atom node + its verbatim (html-emit) toMarkdown.
  const nodePlugin = $node(id, () => ({
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,
    // `raw` is the verbatim source (round-trip truth). Extra display attrs ride alongside.
    attrs: { raw: { default: "" }, attrs: { default: {} } },
    parseDOM: [
      {
        tag: `span[data-oa-atom="${id}"]`,
        getAttrs: (dom: unknown) => {
          const el = dom as HTMLElement;
          return {
            raw: el.getAttribute("data-oa-raw") ?? el.textContent ?? "",
            attrs: safeParseAttrs(el.getAttribute("data-oa-attrs")),
          };
        },
      },
    ],
    toDOM: (node) => {
      // Re-run the pattern on the raw so the chip's display matches the source exactly.
      const raw = (node.attrs.raw as string) ?? "";
      const extra = (node.attrs.attrs as Record<string, string>) ?? {};
      const m = new RegExp(pattern.source, pattern.flags.replace("g", "")).exec(raw);
      const span = def.dom(m ?? ([raw] as unknown as RegExpExecArray), extra);
      span.setAttribute("data-oa-atom", id);
      span.setAttribute("data-oa-raw", raw);
      span.setAttribute("contenteditable", "false");
      return span;
    },
    parseMarkdown: {
      match: (node: MarkdownNode) => node.type === id,
      runner: (state, node, type) => {
        state.addNode(type, {
          raw: (node.raw as string) ?? "",
          attrs: filterExtraAttrs(node as unknown as Record<string, unknown>),
        });
      },
    },
    toMarkdown: {
      // Emit as an `html` mdast node so mdast-util-to-markdown passes it through VERBATIM
      // (a `text` node would be escaped: `\[\[Note]]`, `\#tag`, `\$x\$`). This is the
      // round-trip linchpin — see milkdownSerialize.test.ts.
      match: (node) => node.type.name === id,
      runner: (state, node) => {
        state.addNode("html", undefined, (node.attrs.raw as string) ?? "");
      },
    },
  }));

  return [remarkPlugin as unknown as MilkdownPlugin, nodePlugin];
}

/** mdast node types whose `children` are a link/image LABEL (not free prose), so the atom
 *  tokenizers must not descend into them — preserves autolink round-tripping + link semantics. */
function isLinkLike(type: string): boolean {
  return type === "link" || type === "linkReference" || type === "image" || type === "imageReference";
}

/** Carry only the non-structural extra attrs of an mdast atom node onto the PM node. */
function filterExtraAttrs(node: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === "type" || k === "raw" || k === "children" || k === "position" || k === "value") continue;
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

function safeParseAttrs(json: string | null): Record<string, string> {
  if (!json) return {};
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Build the chip `<span>` with a class + escaped text content. */
function chip(className: string, text: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  return span;
}

// ---------------------------------------------------------------------------------------
// The concrete atoms
// ---------------------------------------------------------------------------------------

// `[[target#heading|alias]]` — matched filename-based, displayed as alias || basename (the
// same display rule the CodeMirror live preview + renderNoteBody use). Round-trips verbatim.
const WIKILINK_RE = /\[\[([^\]\n]+)\]\]/;
const wikilink = makeAtom({
  id: "oaWikilink",
  pattern: WIKILINK_RE,
  dom: (m) => {
    const inner = m[1] ?? "";
    const display = wikilinkDisplay(inner);
    const span = chip("oa-wikilink", display);
    span.setAttribute("data-href", wikilinkTarget(inner));
    span.title = inner;
    return span;
  },
});

// `![[Embed Note]]` / `![[image.png]]` / `![](https://…)` — a transclusion / image embed,
// rendered as an opaque chip (no live render in the surface; the source round-trips). MUST be
// tested before the wikilink/markdown-image patterns since `![[` starts with `!`.
const EMBED_WIKI_RE = /!\[\[([^\]\n]+)\]\]/;
const embedWiki = makeAtom({
  id: "oaEmbedWiki",
  pattern: EMBED_WIKI_RE,
  dom: (m) => {
    const inner = m[1] ?? "";
    const span = chip("oa-embed", "▦ " + (inner.split("|")[0].split("#")[0] || inner));
    span.title = m[0];
    return span;
  },
});

const EMBED_IMG_RE = /!\[([^\]\n]*)\]\(([^)\n]*)\)/;
const embedImg = makeAtom({
  id: "oaEmbedImg",
  pattern: EMBED_IMG_RE,
  dom: (m) => {
    const alt = m[1] || m[2] || "";
    const span = chip("oa-embed", "▦ " + alt);
    span.title = m[0];
    return span;
  },
});

// `#tag` (incl. nested `#a/b`, `-`). Requires start-of-line or whitespace before the `#` so it
// doesn't match a markdown heading (`# `, which has a space) or `C#`. Matches editor/tag.ts.
const TAG_RE = /(?:^|\s)#[\w/-]+/;
const tag = makeAtom({
  id: "oaTag",
  pattern: TAG_RE,
  // The match may include a leading space; the chip + raw cover only the `#tag` token.
  raw: (m) => m[0].slice(m[0].indexOf("#")),
  dom: (m) => chip("oa-tag", m[0].slice(m[0].indexOf("#"))),
});

// Inline `$math$` (single `$`, non-empty, no embedded `$` or newline; not `$$`). Rendered via
// the SAME shared KaTeX renderer the CodeMirror live-preview + renderNoteBody use (renderMath /
// onMathReady), so the chip shows typeset math — not a raw `$…$` placeholder. KaTeX loads
// lazily (~280KB), so if it isn't ready yet we paint the source as a `.oa-math` placeholder
// carrying `data-math` and schedule an upgrade pass that fills every still-empty placeholder the
// moment the chunk lands (mirrors bases/markdown.ts). The atom's `raw` is the verbatim `$…$`, so
// it round-trips byte-stable regardless of whether KaTeX has rendered.
const MATH_RE = /\$(?!\s)([^$\n]+?)(?<!\s)\$/;
const math = makeAtom({
  id: "oaMath",
  pattern: MATH_RE,
  dom: (m) => {
    const expr = m[1] ?? "";
    const span = document.createElement("span");
    span.className = "oa-math";
    const html = renderMath(expr, false); // inline (non-display) — KaTeX if loaded, else ""
    if (html) {
      span.innerHTML = sanitizeHtml(html);
    } else {
      // Not loaded yet: carry the source for the upgrade pass + show the raw `$…$` meanwhile.
      span.setAttribute("data-math", escapeAttr(expr));
      span.textContent = m[0];
      scheduleMathUpgrade();
    }
    return span;
  },
});

// Once KaTeX lands, fill every still-empty `.oa-math[data-math]` chip this surface painted.
// Scoped to OUR chips (cleared `data-math` once upgraded so it runs at most once per chip);
// idempotent + cheap (skips chips that already have rendered children). One shared schedule flag
// dedupes concurrent block surfaces; the callback resets it so later renders re-schedule. No-op when
// there's no document (headless tests). If KaTeX never resolves the flag stays set, but that's moot:
// no math renders at all then, so there's nothing for a re-schedule to upgrade.
let mathUpgradeScheduled = false;
function scheduleMathUpgrade(): void {
  if (mathUpgradeScheduled || typeof document === "undefined") return;
  mathUpgradeScheduled = true;
  onMathReady(() => {
    mathUpgradeScheduled = false;
    for (const el of document.querySelectorAll<HTMLElement>(".oa-block-milkdown span.oa-math[data-math]")) {
      if (el.childElementCount > 0) continue; // already upgraded
      const rendered = renderMath(el.getAttribute("data-math") ?? "", false);
      if (!rendered) continue;
      el.innerHTML = sanitizeHtml(rendered);
      el.removeAttribute("data-math");
    }
  });
}

// Bare `https://…` URLs (typed without `[text](url)` markdown). Mirrors editor/urls.ts: stop at
// whitespace + delimiters; trailing sentence punctuation isn't captured by the pattern itself.
const BARE_URL_RE = /https?:\/\/[^\s<>"'`\])}]+/;
const bareUrl = makeAtom({
  id: "oaUrl",
  pattern: BARE_URL_RE,
  dom: (m) => {
    const span = chip("oa-bareurl", m[0]);
    span.setAttribute("data-href", m[0]);
    return span;
  },
});

/** All custom inline-atom plugins, ORDERED so longer/prefixed patterns tokenize first:
 *  embeds (`![[`, `![](`) before wikilinks (`[[`) and images, so `![[x]]` isn't half-eaten by
 *  the `[[x]]` matcher. $remark plugins run in registration order on the shared tree. */
export const inlineAtoms: MilkdownPlugin[] = [
  ...embedWiki,
  ...embedImg,
  ...wikilink,
  ...tag,
  ...math,
  ...bareUrl,
];

// ---------------------------------------------------------------------------------------
// Display helpers (pure — shared with the chip renderers + tests)
// ---------------------------------------------------------------------------------------

/** The visible label for a `[[inner]]` wikilink: alias if present, else the target basename.
 *  Mirrors editor/wikilink.ts parseWikilink display logic. */
export function wikilinkDisplay(inner: string): string {
  const pipe = inner.indexOf("|");
  if (pipe !== -1) return inner.slice(pipe + 1).trim();
  const hash = inner.indexOf("#");
  const target = (hash === -1 ? inner : inner.slice(0, hash)).trim();
  const basename = target.slice(target.lastIndexOf("/") + 1);
  return basename || target;
}

/** The link target (path/basename, before `#`/`|`) of a `[[inner]]` wikilink. */
export function wikilinkTarget(inner: string): string {
  const pipe = inner.indexOf("|");
  const beforeAlias = pipe === -1 ? inner : inner.slice(0, pipe);
  const hash = beforeAlias.indexOf("#");
  return (hash === -1 ? beforeAlias : beforeAlias.slice(0, hash)).trim();
}

// Re-export the patterns so the round-trip test + the editor host can reuse the exact regexes.
export const INLINE_PATTERNS = {
  wikilink: WIKILINK_RE,
  embedWiki: EMBED_WIKI_RE,
  embedImg: EMBED_IMG_RE,
  tag: TAG_RE,
  math: MATH_RE,
  bareUrl: BARE_URL_RE,
};
