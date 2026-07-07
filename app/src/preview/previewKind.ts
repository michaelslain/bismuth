// app/src/preview/previewKind.ts
// Pure, framework-free classification of a vault file path into a PREVIEW kind (or null when
// the file isn't preview-able and should keep its normal editor/view). Shared by PaneContent
// routing, the tab-icon lookup (tabIds.ts), and unit tests. Kept dependency-free so it stays
// testable without a DOM.

export type PreviewKind = "image" | "pdf" | "code" | "external";

// Raster/vector images rendered inline as an <img>. SVG is shown RENDERED (not as source) —
// the sensible default; "Open in default app" reaches the source externally.
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico", "svg"]);

// Code/text files shown read-only in a monospace pane. Deliberately EXCLUDES the vault's own
// editable formats — `.md` (notes/bases), `.yaml`/`.yml` (config buffers), the extensionless
// `.settings`, `.sheet`, and `.draw` — so those keep their real editors/views.
const CODE_EXT = new Set([
  // web / js / ts
  "js", "jsx", "ts", "tsx", "mjs", "cjs", "json", "jsonc", "vue", "svelte", "astro",
  "css", "scss", "sass", "less", "html", "htm", "xml",
  // systems / scripting
  "py", "rb", "go", "rs", "java", "kt", "kts", "c", "h", "cc", "cpp", "hpp", "cxx", "cs",
  "php", "swift", "scala", "clj", "ex", "exs", "erl", "hs", "lua", "r", "dart", "zig", "pl",
  "sh", "bash", "zsh", "fish", "ps1", "bat",
  // data / query / config
  "sql", "graphql", "gql", "proto", "toml", "ini", "cfg", "conf", "env", "properties",
  // plain text / logs / misc
  "txt", "text", "log", "csv", "tsv", "diff", "patch",
  // common extensionless dev files (matched by whole-name below)
  "makefile", "dockerfile",
]);

// Binary formats we can't render in-app: show a "preview not available" state + the
// Open-with affordance (Photoshop for .psd, Figma-desktop for .fig, etc.).
const EXTERNAL_EXT = new Set([
  "psd", "ai", "fig", "figma", "sketch", "xd", "eps", "indd", "afphoto", "afdesign",
  "blend", "dwg", "dxf", "obj", "fbx", "gltf", "glb",
  "docx", "doc", "xlsx", "xls", "pptx", "ppt", "key", "numbers", "pages", "odt", "ods",
  "zip", "rar", "7z", "tar", "gz", "dmg", "iso",
  "mp3", "wav", "m4a", "flac", "aac", "ogg", "opus",
  "mp4", "mov", "webm", "mkv", "m4v", "avi",
]);

/** Lowercased extension of a path's basename, or the whole lowercased basename when it has no
 *  extension (so `Makefile`/`Dockerfile` classify as code). A leading-dot dotfile keeps its
 *  full name (`.gitignore`). */
export function extOf(path: string): string {
  const base = path.split("/").pop() ?? path;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return base.toLowerCase(); // no extension (or a leading-dot dotfile)
  return base.slice(dot + 1).toLowerCase();
}

/** Classify a path into a preview kind, or null when it should NOT preview (falls through to
 *  the normal editor/view — notes, bases, `.settings`, `.sheet`, `.draw`, unknown types). */
export function previewKind(path: string): PreviewKind | null {
  const ext = extOf(path);
  if (IMAGE_EXT.has(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (CODE_EXT.has(ext)) return "code";
  if (EXTERNAL_EXT.has(ext)) return "external";
  return null;
}

/** True when the path opens as a read-only preview tab. */
export const isPreviewPath = (path: string): boolean => previewKind(path) !== null;

/** True when a preview can be handed off to the `.draw` markup surface (annotate). */
export const isAnnotatable = (path: string): boolean => {
  const k = previewKind(path);
  return k === "image" || k === "pdf";
};
