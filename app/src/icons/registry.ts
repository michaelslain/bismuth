// app/src/icons/registry.ts
//
// The redesign's icon registry: a static NAME -> ART map (design/ascii/README.md "Iconography").
// Every icon call site still passes a canonical Lucide-style name (e.g. "Plus", "FileText") so
// the ~100 existing call sites across the app never change; this module resolves that name to
// one of two kinds of art:
//
//   • SURFACE_GLYPHS — a typed character. The seven glyphs that carry a SURFACE's identity in
//     the tab rail and vault tree (graph/note/base/calendar/agent/daemon/folder), plus the
//     handful of names whose ASCII form is simply the better drawing: `x` (close), `[ ]`/`[x]`
//     (task checkboxes), `<<`/`>>` (undo/redo), `.*` (regex), `Aa`, `S`, `><`, `][`.
//   • PIXEL_PATHS — a 24x24 pixel-art SVG path from HackerNoon's Pixel Icon Library, generated
//     into pixelPaths.ts by app/scripts/build-pixel-icons.ts. Everything else: toolbar, command
//     catalog, palettes, pickers, view toolbars.
//
// Surface glyphs are applied LAST when composing the manifest, so a name appearing in both maps
// always keeps its typed form — the ASCII vocabulary wins where it's load-bearing.
//
// Because both maps are small static literals (not ~1,700 lazily-imported Lucide components),
// resolution is entirely SYNCHRONOUS — there is no "eager seed vs lazily-loaded full manifest"
// split, no idle-scheduled import, no pending/placeholder state. `resolveIcon` returns art or
// null immediately.
//
// All name-normalization (case/separator-insensitive matching, the "…Icon" alias, the legacy
// "Li"/"Lu" vault-icon prefix) is handled by the pure, framework-free registry-core.ts.
import { createIconRegistry, type IconEntry, type IconRegistry } from "./registry-core";
import { looksLikeIconName } from "./registry-core";
import { PIXEL_PATHS } from "./pixelPaths";

export { looksLikeIconName };

/** What a name resolves to: a typed character, or pixel-art path data on a 24x24 grid. */
export type IconArt =
  | { kind: "glyph"; text: string }
  | { kind: "pixel"; d: string };

// The seven surface glyphs (design vocabulary) — graph / note / base / calendar / agent /
// daemon / folder — and their aliases. These stay typed characters on purpose: they're the
// identity of a surface wherever it appears, and the folder family reads as tree structure
// rather than as an icon.
const SURFACE_GLYPHS: Record<string, string> = {
  Share2: "⁘", // graph
  FileText: "✎", File: "✎", // note
  Table: "▤", // base (also .sheet — both are "grid" data)
  Calendar: "▦", CalendarX: "▦", // calendar
  MessageSquare: "◈", MessagesSquare: "◈", // agent / chat
  Bot: "✳", Inbox: "✳", Server: "✳", Settings2: "✳", BrainCircuit: "✳", // daemon
  Folder: "▸", FolderOpen: "▾", FolderInput: "▸>", FolderPlus: "▸+", // folder

  // Names whose ASCII form IS the drawing — the pixel set has no equivalent and a loose
  // substitute would read worse than the literal syntax (design/ascii/README.md line 185:
  // window controls, collapse handles and `x` are typography, not icons).
  X: "x",
  Square: "[ ]", SquareCheck: "[x]",
  Undo2: "<<", Redo2: ">>",
  Regex: ".*", CaseSensitive: "Aa", WholeWord: "[W]",
  Sigma: "S", Scissors: "><", Ungroup: "][",
};

const asGlyph = (text: string): IconArt => ({ kind: "glyph", text });
const asPixel = (d: string): IconArt => ({ kind: "pixel", d });

const manifest: Record<string, IconArt> = {
  ...Object.fromEntries(Object.entries(PIXEL_PATHS).map(([name, d]) => [name, asPixel(d)])),
  // Applied last: a surface glyph always beats a pixel drawing of the same name.
  ...Object.fromEntries(Object.entries(SURFACE_GLYPHS).map(([name, text]) => [name, asGlyph(text)])),
};

const iconRegistry: IconRegistry<IconArt> = createIconRegistry<IconArt>(manifest);

/** Generic fallback for a value that LOOKS like an icon name (see `looksLikeIconName`) but
 *  isn't mapped — e.g. a legacy Lucide name from old vault/note frontmatter. Renders as a typed
 *  glyph instead of the literal (broken-looking) name string. */
export const FALLBACK_GLYPH = "▸";
export const FALLBACK_ART: IconArt = asGlyph(FALLBACK_GLYPH);

/**
 * Resolve an icon spec (a name in any casing, the legacy "Li"/"Lu" convention, or an emoji /
 * arbitrary glyph) to its art, or `null` when it isn't a known name — the caller (`<Icon>`)
 * then decides between the fallback glyph and passing the raw value through as text (see
 * `looksLikeIconName`).
 */
export const resolveIcon = (spec: string | null | undefined): IconArt | null => iconRegistry.resolve(spec);

/** True when `spec` names a known icon (vs. an emoji / arbitrary glyph) — used by the ui/
 *  button primitives' DEV-only lint (`warnBadIcon`) to catch a literal glyph hardcoded where a
 *  semantic icon name belongs. */
export const isIconName = (spec: string | null | undefined): boolean => resolveIcon(spec) !== null;

/** Every mapped icon (canonical name + art), sorted by name. For the icon picker. */
export const allIcons = (): IconEntry<IconArt>[] => iconRegistry.all();

/** All canonical icon names, sorted — for autocomplete suggestions (settings `icon:` completion). */
export const iconNames = (): string[] => iconRegistry.names();
