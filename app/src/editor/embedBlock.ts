// Renders `![[file]]` and `![](url)` EMBEDS inline in the editor: images (with `|width`
// or `|WxH`), PDFs (with `#page=N`), audio, video, and `.md` note transclusion. Like
// queryBlock.ts, block decorations come from a StateField (CodeMirror forbids them from
// view plugins). A standalone embed on its own line becomes a block widget; an inline
// `![[icon|18]]` becomes an inline widget; when the cursor enters the embed the raw source
// is revealed for editing. Media bytes come from GET /asset (resolved FILENAME-FIRST
// server-side), so the frontend passes the bare target — no path lookup needed.
import { Decoration, type DecorationSet, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import { StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import { resolveNotePath, type NoteCandidate } from "./wikilink";
import { stripCode } from "../../../core/src/wikilinks";
import { api } from "../api";
import { renderMarkdown } from "../bases/markdown";
import { stripFrontmatter } from "../bases/cardBodySplit";
import { MONO_FONT } from "./livePreview";
import {
  type EmbedKind,
  type EmbedSpec,
  computeSizeEdit,
  specForMarkdownImage,
  specForWikiEmbed,
} from "./embedSpec";

// Kinds whose box can be drag-resized (and the new size persisted as `|WxH`).
const RESIZABLE_KINDS = new Set<EmbedKind>(["image", "pdf", "video", "html"]);

interface EmbedCtx {
  getNotes: () => NoteCandidate[];
  /** Persist a drag-resize back into the `![[file|size]]` source at the widget's position. */
  commitResize: (dom: HTMLElement, size: string) => void;
}

class EmbedWidget extends WidgetType {
  constructor(
    private readonly spec: EmbedSpec,
    private readonly inline: boolean,
    private readonly resizable: boolean,
    private readonly ctx: EmbedCtx,
  ) {
    super();
  }

  eq(other: EmbedWidget): boolean {
    return this.inline === other.inline && this.resizable === other.resizable
      && JSON.stringify(this.spec) === JSON.stringify(other.spec);
  }

  toDOM(): HTMLElement {
    const s = this.spec;
    const wrap = document.createElement(this.inline ? "span" : "div");
    wrap.className = `cm-embed ${this.inline ? "cm-embed-inline" : "cm-embed-block"}`;

    if (s.kind === "image" && s.src) {
      const img = document.createElement("img");
      img.className = "cm-embed-img";
      img.src = s.src;
      img.alt = s.alt ?? "";
      img.addEventListener("error", () => this.fail(wrap, `can't load image: ${s.alt ?? ""}`));
      wrap.appendChild(img);
      if (this.resizable) {
        // Aspect-locked resize via a CUSTOM corner handle (not native CSS resize): I set width
        // AND height together every frame, so the browser never fights the height-lock — that
        // fight is what caused flicker. The box always hugs the image; the size persists as `|W`.
        this.makeAspectResizable(wrap, () => (img.naturalWidth ? img.naturalWidth / img.naturalHeight : 0));
        if (s.width) wrap.style.width = `${s.width}px`;
        img.addEventListener("load", () => {
          if (!img.naturalWidth) return;
          const w = s.width ?? Math.min(img.naturalWidth, wrap.parentElement?.clientWidth || img.naturalWidth);
          wrap.style.width = `${w}px`;
          wrap.style.height = `${Math.round(w * img.naturalHeight / img.naturalWidth)}px`;
        }, { once: true });
      } else {
        if (s.width) img.style.width = `${s.width}px`;
        if (s.height) img.style.height = `${s.height}px`;
        // A sizeless inline image would render at its full natural size mid-paragraph, blowing
        // up the line box and breaking text flow. Cap its height so it flows like an inline icon
        // (a sized `![[icon|18]]` keeps its explicit dimensions and is never capped).
        if (this.inline && !s.width && !s.height) img.style.maxHeight = "1.4em";
      }
    } else if (s.kind === "pdf" && s.src) {
      const frame = document.createElement("iframe");
      frame.className = "cm-embed-pdf";
      // PDF open-parameters: hide the browser viewer's toolbar + nav/thumbnail sidebar
      // (otherwise the thumbnail pane dominates a small inline embed). Keep #page if set.
      const params = [s.page, "toolbar=0", "navpanes=0", "view=FitH"].filter(Boolean);
      frame.src = `${s.src}#${params.join("&")}`;
      wrap.appendChild(frame);
      if (this.resizable) {
        this.makeResizable(wrap); // a PDF viewport isn't tied to a fixed aspect
        wrap.style.width = s.width ? `${s.width}px` : "100%";
        wrap.style.height = `${s.height ?? 520}px`;
      }
    } else if (s.kind === "html" && s.src) {
      // Live, interactive HTML artifact (e.g. a self-contained inline-`<script>` force-directed
      // SVG). An iframe is the ONLY path that keeps it interactive: every raw-HTML surface routes
      // through sanitizeHtml.ts and DOMPurify strips `<script>`, so inlining kills the artifact.
      // Modeled on the pdf branch above — both render an `<iframe>` via createElement, bypassing
      // the sanitizer that the note-transclusion path (renderNote → renderMarkdown) enforces.
      const frame = document.createElement("iframe");
      frame.className = "cm-embed-html";
      // SECURITY (two layers, BOTH required — do not "simplify" either away):
      //   (1) sandbox WITHOUT `allow-same-origin` → the artifact's document gets an OPAQUE origin,
      //       so it can't script-read this app's DOM/localStorage/cookies. NEVER add
      //       allow-same-origin: that hands the frame our real origin and full same-origin access.
      //   (2) BUT sandbox alone does NOT protect the vault: relative URLs inside the artifact
      //       resolve against its document URL (= the core server), and the API is unauthenticated
      //       with Access-Control-Allow-Origin:* (withCors), so `fetch('/file?path=private.md')`
      //       from inside the artifact SUCCEEDS (ACAO:* matches the frame's null origin). The
      //       second half is the `connect-src 'none'` CSP that GET /asset stamps on served .html
      //       (see core/src/server.ts) — it kills fetch/XHR/WS/EventSource + external subresources.
      frame.setAttribute("sandbox", "allow-scripts"); // (.sandbox is a read-only DOMTokenList; set the attr)
      frame.src = s.page ? `${s.src}#${s.page}` : s.src; // `#region=form` → the artifact's location.hash
      wrap.appendChild(frame);
      if (this.resizable) {
        this.makeResizable(wrap); // an HTML viewport isn't tied to a fixed aspect (like PDF)
        wrap.style.width = s.width ? `${s.width}px` : "100%";
        wrap.style.height = `${s.height ?? 520}px`;
      }
    } else if (s.kind === "audio" && s.src) {
      const a = document.createElement("audio");
      a.className = "cm-embed-audio";
      a.controls = true;
      a.src = s.src;
      wrap.appendChild(a);
    } else if (s.kind === "video" && s.src) {
      const v = document.createElement("video");
      v.className = "cm-embed-video";
      v.controls = true;
      v.src = s.src;
      wrap.appendChild(v);
      if (this.resizable && s.width) { wrap.style.width = `${s.width}px`; if (s.height) wrap.style.height = `${s.height}px`; }
      if (this.resizable) this.makeResizable(wrap);
    } else if (s.kind === "note") {
      this.renderNote(wrap, s.target ?? "");
    } else {
      this.fail(wrap, `not found: ${s.target ?? s.src ?? ""}`);
    }
    return wrap;
  }

  /** Free resize for PDF/video via native CSS `resize: both` (no aspect to fight, so no
   *  flicker). pointerdown records the start size; the drag itself is the browser's native
   *  resizer. The commit is bound to `window` (not the wrap) so a pointer-up that lands OUTSIDE
   *  the box — or over a child iframe — still persists `|WxH` when the size actually changed. */
  private makeResizable(wrap: HTMLElement): void {
    wrap.classList.add("cm-embed-resizable");
    let startW = 0, startH = 0;
    const onUp = () => {
      window.removeEventListener("pointerup", onUp);
      const w = Math.round(wrap.clientWidth), h = Math.round(wrap.clientHeight);
      if (Math.abs(w - startW) > 1 || Math.abs(h - startH) > 1) this.ctx.commitResize(wrap, `${w}x${h}`);
    };
    wrap.addEventListener("pointerdown", () => {
      startW = wrap.clientWidth; startH = wrap.clientHeight;
      window.addEventListener("pointerup", onUp);
    });
  }

  /** Aspect-locked resize (images) via an invisible bottom-right corner handle with the
   *  diagonal resize cursor. I drive the drag myself — setting width and height = width/aspect
   *  on every pointermove — so there's no native-resize-vs-JS fight (and no flicker). The width
   *  persists as `|W`.
   *
   *  Two things make the drag robust once the cursor leaves the 20px handle. (1) `setPointerCapture`
   *  routes every subsequent pointer event to the handle — without it, Chrome delivers no moves to
   *  our listeners during a contenteditable drag and the corner feels dead. (2) The move/up
   *  listeners live on `window` (captured events still bubble up to it) as a fallback for webviews
   *  — notably the Tauri WKWebView the desktop app runs in — that silently refuse capture: there
   *  the events aren't retargeted but window still sees them, so the drag keeps tracking. */
  private makeAspectResizable(wrap: HTMLElement, getAspect: () => number): void {
    wrap.classList.add("cm-embed-aspect");
    const handle = document.createElement("div");
    handle.className = "cm-embed-handle";
    wrap.appendChild(handle);

    let startX = 0, startW = 0;
    const onMove = (e: PointerEvent) => {
      const a = getAspect();
      const maxW = wrap.parentElement?.clientWidth || 2000;
      const w = Math.round(Math.max(40, Math.min(startW + (e.clientX - startX), maxW)));
      wrap.style.width = `${w}px`;
      if (a) wrap.style.height = `${Math.round(w / a)}px`; // set both together — no fight, no flicker
    };
    const onUp = (e: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      try { handle.releasePointerCapture(e.pointerId); } catch { /* never captured */ }
      const w = Math.round(wrap.clientWidth);
      if (Math.abs(w - startW) > 1) this.ctx.commitResize(wrap, `${w}`);
    };
    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      startX = e.clientX;
      startW = wrap.clientWidth;
      try { handle.setPointerCapture(e.pointerId); } catch { /* synthetic / inactive pointer */ }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    });
  }

  /** Transclude a `.md` note: resolve filename-first, fetch, render its body markdown. */
  private renderNote(wrap: HTMLElement, target: string): void {
    wrap.classList.add("cm-embed-note");
    const resolved = resolveNotePath(target, this.ctx.getNotes()) ?? target;
    const path = resolved.endsWith(".md") ? resolved : `${resolved}.md`;
    const title = document.createElement("div");
    title.className = "cm-embed-note-title";
    title.textContent = target.split("/").pop() ?? target;
    const bodyEl = document.createElement("div");
    bodyEl.className = "cm-embed-note-body";
    bodyEl.textContent = "…";
    wrap.appendChild(title);
    wrap.appendChild(bodyEl);
    void api
      .read(path)
      .then((text) => {
        if (!text) { this.fail(wrap, `note not found: ${target}`); return; }
        bodyEl.innerHTML = renderMarkdown(stripFrontmatter(text)); // trusted vault content
      })
      .catch(() => this.fail(wrap, `failed to load: ${target}`));
  }

  private fail(wrap: HTMLElement, msg: string): void {
    wrap.replaceChildren();
    wrap.classList.add("cm-embed-error");
    wrap.textContent = `⚠ ${msg}`;
  }

  // Keep media interactive (PDF scroll, audio/video controls).
  ignoreEvent(): boolean {
    return true;
  }
}

// `![[target#frag|alias]]` OR `![alt](url "title")`.
const EMBED_RE = /!\[\[([^\]\n]+?)\]\]|!\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

interface EmbedToken {
  from: number; to: number; lineFrom: number; lineTo: number; standalone: boolean; spec: EmbedSpec;
  wiki: boolean; // a `![[...]]` embed (resizable + size-persistable) vs a `![](url)` image
  // For a standalone embed that sits AFTER a list marker / indentation (`- ![[img]]`), the
  // leading prefix — non-empty only then. We replace just the embed token (not the whole line)
  // so the bullet stays visible and the image renders under it (vs a tiny inline thumbnail).
  listIndent: string;
}

/** Scan the document for embed tokens. Runs the whole-doc stripCode + regex pass; the
 *  StateField caches the result and only recomputes it when the document content changes.
 *  Code regions are masked (same rule the graph + live-preview use), so embed syntax shown
 *  inside code isn't rendered; stripCode preserves offsets so m[1..3] are real outside code. */
function scanEmbeds(state: EditorState): EmbedToken[] {
  const doc = state.doc;
  const scan = stripCode(doc.toString());
  const tokens: EmbedToken[] = [];
  EMBED_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EMBED_RE.exec(scan))) {
    const from = m.index;
    const to = from + m[0].length;
    const wiki = m[1] !== undefined;
    const spec = wiki ? specForWikiEmbed(m[1], api.assetUrl) : specForMarkdownImage(m[3], m[2], api.assetUrl);
    if (!spec) continue;
    const line = doc.lineAt(from);
    // "Standalone" = the embed is the only content on its line — but allow a leading list
    // marker / indentation (`- ![[img]]`, `    ![[img]]`) so an image inside a bullet renders
    // as a block instead of a tiny inline thumbnail. `prefix` is that leading run; the embed is
    // standalone when nothing but the prefix precedes it (and nothing follows). `listIndent` is
    // recorded ONLY when there's a real prefix, so the plain case keeps a whole-line block.
    const prefix = /^(\s*(?:[-*+]|\d+[.)])\s+|\s+)/.exec(line.text)?.[0] ?? "";
    const sameLine = doc.lineAt(to).number === line.number;
    const standalone = sameLine && (
      line.text.trim() === m[0].trim() ||
      line.text.slice(prefix.length).trim() === m[0].trim()
    );
    // A list/indent prefix only counts when the embed isn't already the whole trimmed line.
    const listIndent = standalone && line.text.trim() !== m[0].trim() ? prefix : "";
    tokens.push({ from, to, lineFrom: line.from, lineTo: line.to, standalone, spec, wiki, listIndent });
  }
  return tokens;
}

/** Cheap per-cursor pass: turn cached tokens into decorations for the current caret. A
 *  standalone embed → a block replace over its line (revealed while the cursor is on the
 *  line); an inline embed → a token replace (revealed while the cursor is inside it). */
function decorationsFor(tokens: EmbedToken[], head: number, ctx: EmbedCtx): DecorationSet {
  const decos: Range<Decoration>[] = [];
  for (const tk of tokens) {
    if (tk.standalone) {
      if (head >= tk.lineFrom && head <= tk.lineTo) continue; // cursor on the line → reveal raw
      // Standalone media gets a resize handle regardless of wiki/markdown form (the size persists
      // as `|W` — in the alias for wiki embeds, in the alt for markdown images; see commitEmbedSize).
      const resizable = RESIZABLE_KINDS.has(tk.spec.kind);
      if (tk.listIndent) {
        // Inside a bullet: replace ONLY the embed token (not the whole line) so the list marker
        // stays visible and the image sits under it. A NON-block replace keeps the marker on the
        // same visual line; the image (a block-ish element) still flows below within the wrapper.
        decos.push(Decoration.replace({ widget: new EmbedWidget(tk.spec, false, resizable, ctx), block: false }).range(tk.from, tk.to));
      } else {
        decos.push(Decoration.replace({ widget: new EmbedWidget(tk.spec, false, resizable, ctx), block: true }).range(tk.lineFrom, tk.lineTo));
      }
    } else {
      if (head >= tk.from && head <= tk.to) continue; // cursor in the token → reveal raw
      decos.push(Decoration.replace({ widget: new EmbedWidget(tk.spec, true, false, ctx), block: false }).range(tk.from, tk.to));
    }
  }
  return Decoration.set(decos, true);
}

/** Write a drag-resize back into the embed source at the widget's doc position, so the size
 *  survives reload (Obsidian-style). Re-finds the embed token at commit time (via posAtDOM) so
 *  it's robust to edits above the widget. Wiki embeds persist as `![[file|size]]`; a markdown
 *  `![alt](url)` image has no size slot, so the size is carried in the alt as `![alt|WIDTH](url)`
 *  (only a bare width — a `WxH` from the aspect-resizer collapses to its width for round-trip). */
function commitEmbedSize(view: EditorView, dom: HTMLElement, size: string): void {
  let pos: number;
  try { pos = view.posAtDOM(dom); } catch { return; }
  const line = view.state.doc.lineAt(pos);
  const edit = computeSizeEdit(line.text, line.from, pos, size);
  if (!edit) return;
  if (view.state.sliceDoc(edit.from, edit.to) === edit.insert) return; // already this size
  // Move CM's own selection to the edit FIRST so a later undo restores it HERE, not wherever
  // `state.selection` happened to be. A drag-resize commits from the widget's own resize
  // handle — a DOM element CM's own selection tracking never sees — so `state.selection` is
  // still wherever it was before this drag. Setting `selection:` on the CHANGES transaction
  // below wouldn't retroactively fix this: CM's history() records an edit's undo-position from
  // the selection as it was BEFORE the edit (`tr.startState.selection`), not the after-state a
  // same-transaction `selection:` sets (see @codemirror/commands' `HistEvent.fromTransaction`).
  // Left unmoved, a later undo would restore that stale before-edit position — often the doc
  // end — instead of back to this embed (#44). A plain selection-only dispatch doesn't scroll
  // (no `scrollIntoView`), so this is visually inert.
  view.dispatch({ selection: { anchor: edit.from } });
  view.dispatch({ changes: edit });
}

// Elements that keep their OWN click instead of revealing the source: native audio/video
// controls, a PDF's iframe, an in-body link (note transclusion), and the resize handle.
const EMBED_KEEP_OWN_CLICK = "audio, video, iframe, a, .cm-embed-handle";

/** A plain click on an embed's rendered chrome (the image itself, a note transclusion's title,
 *  etc.) drops the cursor onto its source so decorationsFor's cursor check reveals the raw
 *  `![[...]]`/`![]()` text for editing — otherwise a standalone embed (esp. one with no visible
 *  "handle" of its own, like a plain image) can never be clicked into, since EmbedWidget's
 *  ignoreEvent() (by design) swallows every event so PDF scroll / audio-video controls / the
 *  resize handle keep working. Mirrors the `.cm-html-block` click-reveal in livePreview.ts —
 *  same domEventHandlers mechanism, which (like the callout widget's dblclick reveal) runs
 *  regardless of what the widget's own ignoreEvent() returns. Arrow-key navigation already
 *  reveals via the selection-driven StateField update; this is the click half of that same gate. */
const embedRevealOnClick = EditorView.domEventHandlers({
  mousedown(event, view) {
    if ((event as MouseEvent).button !== 0) return false; // left-click only
    const target = event.target as HTMLElement | null;
    if (!target || target.closest(EMBED_KEEP_OWN_CLICK)) return false;
    const wrap = target.closest<HTMLElement>(".cm-embed-block, .cm-embed-inline");
    if (!wrap) return false;
    let pos: number;
    try {
      pos = view.posAtDOM(wrap);
    } catch {
      return false;
    }
    event.preventDefault();
    view.dispatch({ selection: { anchor: pos } });
    view.focus();
    return true;
  },
});

const embedTheme = EditorView.theme({
  ".cm-embed-block": { display: "block", margin: "0.5em 0" },
  // Inline embed: the wrap must hug the image and sit on the text baseline so it flows with the
  // surrounding words. `line-height: 0` drops the inline-block's line-box strut (otherwise the
  // box was a full line-height tall for a tiny image, leaving it stranded at the bottom of an
  // oversized box); the block `img` below then makes the wrap exactly the image's height.
  ".cm-embed-inline": {
    display: "inline-block", "vertical-align": "middle", margin: "0 2px", "line-height": "0",
  },
  ".cm-embed-img": { "max-width": "100%", "border-radius": "6px", display: "block" },
  // Inline image: block display (no baseline gap) + max-width so it never overflows the line;
  // the wrap's `vertical-align: middle` centers it against the text.
  ".cm-embed-inline .cm-embed-img": { display: "block", "max-width": "100%", "border-radius": "4px" },
  ".cm-embed-pdf": {
    width: "100%", height: "520px", border: "1px solid var(--border)",
    "border-radius": "8px", background: "var(--surface-2)",
  },
  // HTML artifact iframe — same chrome as the PDF iframe (border + rounded + surface bg).
  ".cm-embed-html": {
    width: "100%", height: "520px", border: "1px solid var(--border)",
    "border-radius": "8px", background: "var(--surface-2)",
  },
  ".cm-embed-audio": { width: "min(420px, 100%)", display: "block" },
  ".cm-embed-video": { "max-width": "100%", "border-radius": "8px", display: "block" },
  ".cm-embed-note": {
    border: "1px solid var(--border)", "border-left": "3px solid var(--accent)",
    "border-radius": "8px", padding: "2px 16px", background: "var(--surface-2)",
  },
  ".cm-embed-note-title": {
    "font-family": MONO_FONT, "font-size": "0.72em",
    "letter-spacing": "0.04em", "text-transform": "uppercase",
    color: "color-mix(in srgb, var(--fg) 45%, transparent)", margin: "0.4em 0 0",
  },
  ".cm-embed-error": {
    "font-family": MONO_FONT, "font-size": "0.85em",
    color: "#e5847d", opacity: "0.85",
  },
  // PDF/video: free resize via the native bottom-right corner (no visible grip — see below).
  // `overflow: hidden` is required for the resize affordance; max-width keeps it in the editor.
  ".cm-embed-resizable": {
    resize: "both", overflow: "hidden", "max-width": "100%", "box-sizing": "border-box",
  },
  ".cm-embed-resizable .cm-embed-pdf": { width: "100%", height: "100%", display: "block" },
  ".cm-embed-resizable .cm-embed-html": { width: "100%", height: "100%", display: "block" },
  ".cm-embed-resizable .cm-embed-video": { width: "100%", height: "100%" },
  // Hide the native resize grip (the drag still works — hovering the corner shows the cursor).
  ".cm-embed-resizable::-webkit-resizer": { display: "none" },
  // Images: aspect-locked box driven by a custom corner handle (makeAspectResizable). The image
  // fills the box (which already matches its aspect, so object-fit: contain never letterboxes).
  ".cm-embed-aspect": { position: "relative", overflow: "hidden", "max-width": "100%", "box-sizing": "border-box" },
  ".cm-embed-aspect .cm-embed-img": { width: "100%", height: "100%", "object-fit": "contain", display: "block" },
  // Invisible drag handle in the bottom-right corner with the diagonal resize cursor (no grip).
  ".cm-embed-handle": {
    position: "absolute", right: "0", bottom: "0", width: "20px", height: "20px",
    cursor: "nwse-resize", "touch-action": "none",
  },
});

/** Factory: the editor passes a getter for the current note's sibling note list (for
 *  filename-first transclusion resolution). The field caches the scanned tokens and re-runs
 *  the whole-doc scan ONLY on content change; a selection-only change just re-derives the
 *  cheap cursor-reveal decorations from the cache (mirrors livePreview's content/selection
 *  split, so cursor moves in a large note don't re-stripCode the whole document). */
export function embedBlock(getNotes: () => NoteCandidate[]): Extension {
  // Captured per editor mount (embedBlock is called fresh per view), so the resize-commit
  // can dispatch a transaction. A ViewPlugin can't PROVIDE block decorations (CM forbids it),
  // hence the split: StateField owns the decorations, the plugin just holds the view ref.
  let view: EditorView | undefined;
  const ctx: EmbedCtx = {
    getNotes,
    commitResize: (dom, size) => { if (view) commitEmbedSize(view, dom, size); },
  };

  const field = StateField.define<{ tokens: EmbedToken[]; deco: DecorationSet }>({
    create(state) {
      const tokens = scanEmbeds(state);
      return { tokens, deco: decorationsFor(tokens, state.selection.main.head, ctx) };
    },
    update(value, tr) {
      if (tr.docChanged) {
        const tokens = scanEmbeds(tr.state);
        return { tokens, deco: decorationsFor(tokens, tr.state.selection.main.head, ctx) };
      }
      if (tr.selection) {
        return { tokens: value.tokens, deco: decorationsFor(value.tokens, tr.state.selection.main.head, ctx) };
      }
      return value;
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
  });

  const captureView = ViewPlugin.fromClass(class {
    constructor(v: EditorView) { view = v; }
    destroy() { view = undefined; }
  });

  return [field, captureView, embedTheme, embedRevealOnClick];
}
