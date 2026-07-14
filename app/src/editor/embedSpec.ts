// Pure (DOM-free) helpers behind embedBlock.ts: classify an embed target, parse its size
// alias, build an EmbedSpec, and compute the doc edit that persists a drag-resize. Kept
// separate from embedBlock.ts so this logic can be unit-tested without pulling in CodeMirror
// or the markdown renderer (see embedSpec.test.ts). The asset-URL builder is injected so this
// module has no dependency on `../api`.
import { parseWikilink } from "./wikilink";

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "ico"]);
const AUDIO_EXT = new Set(["mp3", "wav", "ogg", "m4a", "flac", "aac", "opus"]);
const VIDEO_EXT = new Set(["mp4", "webm", "mov", "m4v", "ogv", "mkv"]);

export type EmbedKind = "image" | "pdf" | "audio" | "video" | "html" | "note";

export interface EmbedSpec {
  kind: EmbedKind;
  src?: string;       // asset URL (media) — undefined for note transclusion
  target?: string;    // the raw target/basename (note transclusion + alt text)
  page?: string;      // PDF fragment ("page=2") OR an html embed's URL fragment ("region=form"),
                      //   carried onto `frame.src#…` so `![[viz.html#region=form]]` deep-links via location.hash
  width?: number;
  height?: number;
  alt?: string;
}

/** Classify an embed target by its file extension. Anything that isn't a known media
 *  extension (including a bare `[[Note]]` with no extension) is treated as a note. `.draw`
 *  returns null — drawings are no longer embeddable in notes (draw-anywhere note ink replaced
 *  the embed; a stray `![[Sketch.draw]]` in old content renders as inert plain text). */
export function kindForTarget(target: string): EmbedKind | null {
  const dot = target.lastIndexOf(".");
  const ext = dot === -1 ? "" : target.slice(dot + 1).toLowerCase();
  if (ext === "draw") return null;
  if (IMAGE_EXT.has(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (AUDIO_EXT.has(ext)) return "audio";
  if (VIDEO_EXT.has(ext)) return "video";
  // Interactive HTML artifact — before the `note` fallback so `![[viz.html]]` renders live in a
  // sandboxed iframe (embedBlock.ts) instead of trying to transclude it as a (missing) markdown note.
  if (ext === "html" || ext === "htm") return "html";
  return "note";
}

/** Parse a wikilink alias as a size: `300` → width, `300x200` → width×height. */
export function parseSize(alias?: string): { width?: number; height?: number } {
  if (!alias) return {};
  const m = /^(\d+)(?:x(\d+))?$/.exec(alias.trim());
  if (!m) return {};
  return m[2] ? { width: +m[1], height: +m[2] } : { width: +m[1] };
}

/** Split a markdown image alt into its text + a trailing `|WIDTH` (the size we persist there,
 *  since a markdown image has no `[[...|size]]` slot). `![logo|300](url)` → alt "logo", width 300. */
export function altSize(alt: string): { alt: string; width?: number } {
  const pipe = alt.lastIndexOf("|");
  if (pipe === -1) return { alt };
  const m = /^(\d+)$/.exec(alt.slice(pipe + 1).trim());
  return m ? { alt: alt.slice(0, pipe), width: +m[1] } : { alt };
}

/** Build an EmbedSpec from a `![[target#frag|alias]]` inner string, or null to skip. */
export function specForWikiEmbed(inner: string, assetUrl: (target: string) => string): EmbedSpec | null {
  const { target, alias, heading } = parseWikilink(inner);
  if (!target) return null;
  const kind = kindForTarget(target);
  if (kind === null) return null; // .draw — not embeddable
  if (kind === "note") return { kind, target };
  const src = assetUrl(target); // backend resolves filename-first
  if (kind === "image") return { kind, src, alt: target, ...parseSize(alias) };
  if (kind === "pdf") return { kind, src, page: heading };
  // html reuses the wikilink `#heading` slot as the iframe URL fragment (deep-link, mirrors pdf).
  if (kind === "html") return { kind, src, page: heading };
  return { kind, src };
}

/** Spec for a markdown `![](url)` image. A remote URL renders as-is; a bare vault path is
 *  classified by extension so `![](clip.mp4)` / `![](doc.pdf#page=2)` render as that medium
 *  (Obsidian parity), not a broken <img>. A trailing `|WIDTH` in the alt sets the image width
 *  (resize is persisted there — markdown images have no `[[...|size]]` slot). */
export function specForMarkdownImage(url: string, rawAlt: string, assetUrl: (target: string) => string): EmbedSpec | null {
  const { alt, width } = altSize(rawAlt);
  if (/^(https?:|data:|blob:)/i.test(url)) return { kind: "image", src: url, alt, width };
  const hash = url.indexOf("#");
  const target = hash === -1 ? url : url.slice(0, hash);
  const frag = hash === -1 ? undefined : url.slice(hash + 1);
  const kind = kindForTarget(target);
  if (kind === null) return null; // .draw — not embeddable (scanEmbeds drops a null spec)
  const src = assetUrl(target);
  if (kind === "pdf") return { kind, src, page: frag };
  if (kind === "html") return { kind, src, page: frag }; // `![](viz.html#region=form)` deep-links too
  if (kind === "audio" || kind === "video") return { kind, src };
  return { kind: "image", src, alt, width }; // image, or a non-media ext we can only try as an image
}

/** Compute the doc edit that persists a drag-resize back into the embed source at `pos`, or
 *  null if no embed sits on the line. Pure counterpart of commitEmbedSize (no EditorView), so
 *  the wiki-vs-markdown persistence rules are unit-testable. A wiki embed persists as
 *  `![[file|size]]`; a markdown `![alt](url)` image has no size slot, so the width is carried in
 *  the alt as `![alt|WIDTH](url)` (a `WxH` from a freer resizer collapses to its width). */
export function computeSizeEdit(
  lineText: string,
  lineFrom: number,
  pos: number,
  size: string,
): { from: number; to: number; insert: string } | null {
  // Wiki embeds first — re-find the `![[...]]` token under the caret (fallback: first on line).
  let hit: { from: number; to: number; inner: string } | null = null;
  for (const m of lineText.matchAll(/!\[\[([^\]\n]+?)\]\]/g)) {
    const from = lineFrom + (m.index ?? 0);
    const to = from + m[0].length;
    if (pos >= from && pos <= to) { hit = { from, to, inner: m[1] }; break; }
    if (!hit) hit = { from, to, inner: m[1] };
  }
  if (hit) {
    const pipe = hit.inner.indexOf("|");
    const beforePipe = pipe === -1 ? hit.inner : hit.inner.slice(0, pipe); // keep target + #frag
    return { from: hit.from, to: hit.to, insert: `![[${beforePipe}|${size}]]` };
  }
  // No wiki embed on the line → a markdown `![alt](url)` image. Persist the width in the alt.
  const width = size.split("x")[0];
  let mhit: { from: number; to: number; alt: string; url: string } | null = null;
  for (const m of lineText.matchAll(/!\[([^\]\n]*)\]\(([^)\s]+)\)/g)) {
    const from = lineFrom + (m.index ?? 0);
    const to = from + m[0].length;
    if (pos >= from && pos <= to) { mhit = { from, to, alt: m[1], url: m[2] }; break; }
    if (!mhit) mhit = { from, to, alt: m[1], url: m[2] };
  }
  if (!mhit) return null;
  const basePipe = mhit.alt.lastIndexOf("|");
  const baseAlt = basePipe !== -1 && /^\d+$/.test(mhit.alt.slice(basePipe + 1).trim())
    ? mhit.alt.slice(0, basePipe) : mhit.alt;
  return { from: mhit.from, to: mhit.to, insert: `![${baseAlt}|${width}](${mhit.url})` };
}
