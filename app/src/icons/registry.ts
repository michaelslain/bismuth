// app/src/icons/registry.ts
//
// The ASCII redesign's icon registry: a static NAME -> GLYPH map (design/ascii/README.md
// "Iconography"). There is no icon font, sprite, or SVG set anymore — every icon call site
// still passes a canonical Lucide-style name (e.g. "Plus", "FileText") so the ~100 existing
// callsites across the app never change; this module just resolves that name to a short typed
// glyph instead of an SVG component.
//
// Because the manifest below is a small, fully static literal (not ~1,700 lazily-imported
// Lucide components), resolution is entirely SYNCHRONOUS now — there is no more "eager seed vs
// lazily-loaded full manifest" split, no idle-scheduled import, no pending/placeholder state.
// `resolveIcon` returns a glyph or null immediately.
//
// All name-normalization (case/separator-insensitive matching, the "…Icon" alias, the legacy
// "Li"/"Lu" vault-icon prefix) is still handled by the pure, framework-free registry-core.ts —
// unchanged and reused as-is, just instantiated over glyph strings instead of components.
import { createIconRegistry, type IconEntry, type IconRegistry } from "./registry-core";
import { looksLikeIconName } from "./registry-core";

export { looksLikeIconName };

// The design vocabulary's seven surface glyphs (design/ascii/README.md "Iconography") plus a
// sensible ASCII/Unicode mapping for every other canonical name the app's chrome references
// (toolbar/command catalog, file tree, tab bar, palettes, pickers, view toolbars). Unlisted
// names fall through to FALLBACK_GLYPH (see resolveIcon below) — expected for a name that isn't
// part of the app's own chrome vocabulary (e.g. a stray legacy Lucide name in old vault
// frontmatter): "unknown -> ▸ via fallback" per the porting notes, not a bug.
const GLYPHS: Record<string, string> = {
  // Surface glyphs (design vocabulary) — graph / note / base / calendar / agent / daemon / folder.
  Share2: "⁘", // graph
  FileText: "✎", // note
  Table: "▤", // base (also used for .sheet — both are "grid" data)
  Calendar: "▦", CalendarX: "▦", // calendar
  MessageSquare: "◈", MessagesSquare: "◈", // agent / chat
  Bot: "✳", Inbox: "✳", Server: "✳", Settings2: "✳", // daemon
  Folder: "▸", FolderOpen: "▾", // folder (open state = the folder chevron)

  // Everything else: plain ASCII or a short text label per name — never a decorative Unicode
  // symbol (the design vocabulary is closed; see the module doc above). Where a name's concept
  // overlaps a SURFACE glyph's meaning it reuses that glyph rather than inventing a new one (e.g.
  // Book/Database/Notebook/SquareKanban -> the base/table grid, Map -> the calendar grid,
  // Network -> the agent/chat glyph, BrainCircuit -> the daemon glyph).
  AppWindow: "[ ]", Archive: "[A]", ArchiveX: "[A]x",
  ArrowDown: "↓", ArrowLeft: "<", ArrowRight: ">", ArrowUp: "↑",
  AtSign: "@", Ban: "(x)", Blend: "~", Bold: "B",
  Book: "▤", BookOpen: "▤", Box: "[]", Brain: "[B]", BrainCircuit: "✳", Bug: "[b]",
  CaseSensitive: "Aa", ChartColumn: "|||", ChartLine: "/",
  Check: "v", CircleCheck: "(v)", CircleHelp: "?", CircleX: "(x)",
  ChevronDown: "▾", ChevronLeft: "<", ChevronRight: "▸", ChevronUp: "^",
  Clipboard: "[C]", ClipboardList: "[C]", Code: "{}", Columns2: "||", Columns3: "|||",
  Combine: "+", Copy: "[c]", Crown: "[K]",
  Database: "▤", Download: "↓",
  Eraser: "[e]", Eye: "(o)", ExternalLink: "->",
  File: "✎", FilePlus: "✎+", Flame: "!",
  FolderInput: "▸>", FolderPlus: "▸+",
  Gauge: "~", Globe: "O", Grid3x3: "▦",
  Hash: "#", Heading1: "H1", Heading2: "H2", Heading3: "H3", Heart: "<3", Highlighter: "_",
  Image: "[I]", ImagePlus: "[I]+", Info: "i", Italic: "I",
  KeyRound: "[k]", Landmark: "[L]", Layers: "▦", LayoutGrid: "▦", LayoutList: "=",
  Lightbulb: "*", Link: "-", List: "=", ListChecks: "[v]", ListOrdered: "1.", Lock: "[^]",
  Map: "▦", Megaphone: "!", Menu: "=", Minus: "-", Network: "◈", Notebook: "▤",
  Palette: "~",
  PanelBottom: "_", PanelLeft: "<<", PanelRight: ">>",
  Pen: "✎", Pencil: "✎", PenTool: "✎", Pin: "|", PinOff: "|x", Play: "|>",
  Plus: "+", Power: "(|)", PowerOff: "[|]",
  Redo2: ">>", RefreshCw: ">>", Regex: ".*", Repeat: ">>", Replace: "<>", Reply: "<-",
  RotateCcw: "<<", Scissors: "><", Search: "/", Send: ">",
  SeparatorHorizontal: "--", Settings: "*", Share: ">>",
  Sigma: "S", Smile: ":)", Sparkles: "*",
  Square: "[ ]", SquareCheck: "[x]", SquareKanban: "▤", SquarePlus: "[+]", SquareSlash: "[/]",
  SquareTerminal: ">_", SquareX: "[-]", Star: "*",
  Tag: "#", TextQuote: "\"", Trash2: "[d]", TriangleAlert: "!",
  Undo2: "<<", Ungroup: "][", Users: "oo", Vote: "[v]",
  WholeWord: "[W]", Wrench: "[w]", X: "x", Zap: "!", ZoomIn: "+", ZoomOut: "-",
};

const glyphRegistry: IconRegistry<string> = createIconRegistry<string>(GLYPHS);

/** Generic fallback for a value that LOOKS like an icon name (see `looksLikeIconName`) but
 *  isn't in the map above — e.g. a legacy Lucide name from old vault/note frontmatter. Renders
 *  as a typed glyph instead of the literal (broken-looking) name string. */
export const FALLBACK_GLYPH = "▸";

/**
 * Resolve an icon spec (a name in any casing, the legacy "Li"/"Lu" convention, or an emoji /
 * arbitrary glyph) to its mapped glyph, or `null` when it isn't a known name in GLYPHS — the
 * caller (`<Icon>`) then decides between the fallback glyph and passing the raw value through
 * as text (see `looksLikeIconName`).
 */
export const resolveIcon = (spec: string | null | undefined): string | null => glyphRegistry.resolve(spec);

/** True when `spec` names a known icon (vs. an emoji / arbitrary glyph) — used by the ui/
 *  button primitives' DEV-only lint (`warnBadIcon`) to catch a literal glyph hardcoded where a
 *  semantic icon name belongs. */
export const isIconName = (spec: string | null | undefined): boolean => resolveIcon(spec) !== null;

/** Every mapped icon (canonical name + glyph), sorted by name. For the icon picker. */
export const allIcons = (): IconEntry<string>[] => glyphRegistry.all();

/** All canonical icon names, sorted — for autocomplete suggestions (settings `icon:` completion). */
export const iconNames = (): string[] => glyphRegistry.names();
