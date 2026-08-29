// app/src/icons/iconMap.ts
//
// canonical icon name -> Phosphor Regular identifier. THIS is the module a future icon-set swap
// replaces (plan §10.1's "very trivial" constraint) — build-icon-svgs.ts and registry.ts are
// written against its SHAPE (PhosphorEntry), not against Phosphor specifically, so swapping sets
// later is: write a new file with this shape, point build-icon-svgs.ts at it, rerun the script.
//
// Three kinds of entry, deliberately not silently conflated:
//   - { kind: 'slug' } — resolved against @iconify-json/ph's icons.json by build-icon-svgs.ts.
//     133 of these, each verified present (`!!data.icons[slug]`) before this file was written.
//   - { kind: 'custom' } — a hand-authored inline SVG body, for the two names Phosphor genuinely
//     has no concept for but the app cannot leave blank: Regex ('.*') and WholeWord ('[W]'), both
//     visible controls in the editor find panel. Same monospace-text-mark approach as the
//     specimen's CUSTOM_SVGS, at Phosphor's native 0-256 viewBox so they sit at the same visual
//     weight as their mapped neighbours.
//   - absent from this file entirely — see KNOWN_MISSING below. A GENUINE gap, never invented art.
//
// PROVENANCE. Copied from (not imported from) app/src/icons/specimen/iconSetData.ts's
// ICON_MAP + CUSTOM_SVGS, which is the record of how each slug was chosen — kebab-case the
// canonical name, and where that missed, grep the real @iconify-json/ph key list by hand for a
// semantic equivalent, verifying with `!!data.icons[slug]` before it went in the table. Copied
// rather than imported because the specimen is a historical record of the DECISION and must not
// become a runtime dependency of the shipped app (plan: "do not delete app/src/icons/specimen/").
// See the specimen and plan §10.2 for the full per-name reasoning, including the ten names that
// looked like gaps and turned out to be mapping misses (BrainCircuit -> head-circuit, etc).
export type PhosphorEntry =
    | { kind: 'slug'; slug: string }
    | { kind: 'custom'; body: string; viewBox: string }

/** The npm package build-icon-svgs.ts resolves `{ kind: 'slug' }` entries against — an iconify-json
 *  collection, so it ships both `icons.json` (the `{icons,width,height}` iconify format) and
 *  `package.json` (for the version stamped into the generated manifest). Read by the build script
 *  as a plain string (not a static import specifier) so a future set swap is genuinely just "write
 *  a new <newSet>Map.ts with its own SOURCE_PACKAGE + entries, rerun `bun run icons:svg`" — the
 *  script itself does not name Phosphor anywhere. */
export const SOURCE_PACKAGE = '@iconify-json/ph'

export const ICON_MAP: Record<string, PhosphorEntry> = {
    AppWindow: { kind: 'slug', slug: 'app-window' },
    Archive: { kind: 'slug', slug: 'archive' },
    ArrowDown: { kind: 'slug', slug: 'arrow-down' },
    ArrowLeft: { kind: 'slug', slug: 'arrow-left' },
    ArrowRight: { kind: 'slug', slug: 'arrow-right' },
    ArrowUp: { kind: 'slug', slug: 'arrow-up' },
    AtSign: { kind: 'slug', slug: 'at' },
    Ban: { kind: 'slug', slug: 'prohibit' },
    Bold: { kind: 'slug', slug: 'text-b' },
    Book: { kind: 'slug', slug: 'book' },
    BookOpen: { kind: 'slug', slug: 'book-open' },
    Bot: { kind: 'slug', slug: 'robot' },
    Box: { kind: 'slug', slug: 'cube' },
    Brain: { kind: 'slug', slug: 'brain' },
    BrainCircuit: { kind: 'slug', slug: 'head-circuit' },
    Bug: { kind: 'slug', slug: 'bug' },
    Calendar: { kind: 'slug', slug: 'calendar' },
    CalendarX: { kind: 'slug', slug: 'calendar-x' },
    CaseSensitive: { kind: 'slug', slug: 'text-aa' },
    ChartColumn: { kind: 'slug', slug: 'chart-bar' },
    ChartLine: { kind: 'slug', slug: 'chart-line' },
    Check: { kind: 'slug', slug: 'check' },
    ChevronDown: { kind: 'slug', slug: 'caret-down' },
    ChevronLeft: { kind: 'slug', slug: 'caret-left' },
    ChevronRight: { kind: 'slug', slug: 'caret-right' },
    ChevronUp: { kind: 'slug', slug: 'caret-up' },
    CircleCheck: { kind: 'slug', slug: 'check-circle' },
    CircleHelp: { kind: 'slug', slug: 'question' },
    CircleX: { kind: 'slug', slug: 'x-circle' },
    Clipboard: { kind: 'slug', slug: 'clipboard' },
    ClipboardList: { kind: 'slug', slug: 'clipboard-text' },
    Code: { kind: 'slug', slug: 'code' },
    Columns2: { kind: 'slug', slug: 'columns' },
    Columns3: { kind: 'slug', slug: 'columns' },
    Combine: { kind: 'slug', slug: 'intersect' },
    Copy: { kind: 'slug', slug: 'copy' },
    Crown: { kind: 'slug', slug: 'crown' },
    Database: { kind: 'slug', slug: 'database' },
    Download: { kind: 'slug', slug: 'download-simple' },
    Eraser: { kind: 'slug', slug: 'eraser' },
    ExternalLink: { kind: 'slug', slug: 'arrow-square-out' },
    Eye: { kind: 'slug', slug: 'eye' },
    File: { kind: 'slug', slug: 'file' },
    FilePlus: { kind: 'slug', slug: 'file-plus' },
    FileText: { kind: 'slug', slug: 'file-text' },
    Flame: { kind: 'slug', slug: 'flame' },
    Folder: { kind: 'slug', slug: 'folder' },
    FolderOpen: { kind: 'slug', slug: 'folder-open' },
    FolderPlus: { kind: 'slug', slug: 'folder-plus' },
    Gauge: { kind: 'slug', slug: 'gauge' },
    Globe: { kind: 'slug', slug: 'globe' },
    Grid3x3: { kind: 'slug', slug: 'grid-nine' },
    Hash: { kind: 'slug', slug: 'hash' },
    Heading1: { kind: 'slug', slug: 'text-h-one' },
    Heading2: { kind: 'slug', slug: 'text-h-two' },
    Heading3: { kind: 'slug', slug: 'text-h-three' },
    Heart: { kind: 'slug', slug: 'heart' },
    Highlighter: { kind: 'slug', slug: 'highlighter-circle' },
    Image: { kind: 'slug', slug: 'image' },
    ImagePlus: { kind: 'slug', slug: 'image-square' },
    Inbox: { kind: 'slug', slug: 'tray' },
    Info: { kind: 'slug', slug: 'info' },
    Italic: { kind: 'slug', slug: 'text-italic' },
    KeyRound: { kind: 'slug', slug: 'key' },
    Landmark: { kind: 'slug', slug: 'bank' },
    Layers: { kind: 'slug', slug: 'stack' },
    LayoutGrid: { kind: 'slug', slug: 'squares-four' },
    LayoutList: { kind: 'slug', slug: 'rows' },
    Lightbulb: { kind: 'slug', slug: 'lightbulb' },
    Link: { kind: 'slug', slug: 'link' },
    List: { kind: 'slug', slug: 'list' },
    ListChecks: { kind: 'slug', slug: 'list-checks' },
    ListOrdered: { kind: 'slug', slug: 'list-numbers' },
    Lock: { kind: 'slug', slug: 'lock' },
    Megaphone: { kind: 'slug', slug: 'megaphone' },
    Menu: { kind: 'slug', slug: 'hamburger' },
    MessageSquare: { kind: 'slug', slug: 'chat-circle' },
    MessagesSquare: { kind: 'slug', slug: 'chats' },
    Minus: { kind: 'slug', slug: 'minus' },
    Network: { kind: 'slug', slug: 'network' },
    Notebook: { kind: 'slug', slug: 'notebook' },
    Palette: { kind: 'slug', slug: 'palette' },
    PanelBottom: { kind: 'slug', slug: 'square-half-bottom' },
    PanelLeft: { kind: 'slug', slug: 'sidebar-simple' },
    PanelRight: { kind: 'slug', slug: 'sidebar-simple' },
    Pen: { kind: 'slug', slug: 'pen' },
    Pencil: { kind: 'slug', slug: 'pencil-simple' },
    PenTool: { kind: 'slug', slug: 'pen-nib' },
    Pin: { kind: 'slug', slug: 'push-pin' },
    PinOff: { kind: 'slug', slug: 'push-pin-slash' },
    Play: { kind: 'slug', slug: 'play' },
    Plus: { kind: 'slug', slug: 'plus' },
    Power: { kind: 'slug', slug: 'power' },
    PowerOff: { kind: 'slug', slug: 'power' },
    Redo2: { kind: 'slug', slug: 'arrow-clockwise' },
    RefreshCw: { kind: 'slug', slug: 'arrows-clockwise' },
    Repeat: { kind: 'slug', slug: 'repeat' },
    Replace: { kind: 'slug', slug: 'arrows-left-right' },
    Reply: { kind: 'slug', slug: 'arrow-bend-up-left' },
    RotateCcw: { kind: 'slug', slug: 'arrow-counter-clockwise' },
    Scissors: { kind: 'slug', slug: 'scissors' },
    Search: { kind: 'slug', slug: 'magnifying-glass' },
    Send: { kind: 'slug', slug: 'paper-plane-tilt' },
    SeparatorHorizontal: { kind: 'slug', slug: 'line-segment' },
    Server: { kind: 'slug', slug: 'hard-drives' },
    Settings: { kind: 'slug', slug: 'gear' },
    Settings2: { kind: 'slug', slug: 'sliders' },
    Share: { kind: 'slug', slug: 'share' },
    Share2: { kind: 'slug', slug: 'share-network' },
    Sigma: { kind: 'slug', slug: 'sigma' },
    Smile: { kind: 'slug', slug: 'smiley' },
    Sparkles: { kind: 'slug', slug: 'sparkle' },
    Square: { kind: 'slug', slug: 'square' },
    SquareCheck: { kind: 'slug', slug: 'check-square' },
    SquareKanban: { kind: 'slug', slug: 'kanban' },
    SquarePlus: { kind: 'slug', slug: 'plus-square' },
    SquareSlash: { kind: 'slug', slug: 'prohibit-inset' },
    SquareTerminal: { kind: 'slug', slug: 'terminal-window' },
    SquareX: { kind: 'slug', slug: 'x-square' },
    Star: { kind: 'slug', slug: 'star' },
    Table: { kind: 'slug', slug: 'table' },
    Tag: { kind: 'slug', slug: 'tag' },
    TextQuote: { kind: 'slug', slug: 'quotes' },
    Trash2: { kind: 'slug', slug: 'trash' },
    TriangleAlert: { kind: 'slug', slug: 'warning' },
    Undo2: { kind: 'slug', slug: 'arrow-counter-clockwise' },
    Ungroup: { kind: 'slug', slug: 'selection-slash' },
    Users: { kind: 'slug', slug: 'users' },
    Wrench: { kind: 'slug', slug: 'wrench' },
    X: { kind: 'slug', slug: 'x' },
    Zap: { kind: 'slug', slug: 'lightning' },
    ZoomIn: { kind: 'slug', slug: 'magnifying-glass-plus' },
    ZoomOut: { kind: 'slug', slug: 'magnifying-glass-minus' },
    Regex: {
        kind: 'custom',
        viewBox: '0 0 256 256',
        body: '<text x="128" y="172" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="120" font-weight="600" text-anchor="middle" fill="currentColor">.*</text>',
    },
    WholeWord: {
        kind: 'custom',
        viewBox: '0 0 256 256',
        body: '<text x="128" y="164" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="84" font-weight="600" text-anchor="middle" fill="currentColor">[W]</text>',
    },
}

/** Names genuinely absent from Phosphor's ~9161 icons — confirmed, not merely unmapped. No archive
 *  +remove combination glyph (ArchiveX), no "blend" concept at all (Blend), no "data flowing into a
 *  folder" glyph beyond folder-plus/-minus (FolderInput), only map-PIN variants and no plain
 *  map/atlas glyph (Map), no ballot/vote glyph (Vote). User 2026-08-27: "thats ok, dont worry about
 *  it. 11 'missing' icons, who cares." build-icon-svgs.ts emits the deliberate MISSING marker for
 *  these — never hand-authored art, unlike Regex/WholeWord above, which were the two the user's
 *  own UI (the find panel) actually needs to show something for. */
export const KNOWN_MISSING: string[] = [
    'ArchiveX',
    'Blend',
    'FolderInput',
    'Map',
    'Vote',
]
