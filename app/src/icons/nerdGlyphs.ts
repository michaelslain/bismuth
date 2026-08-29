// app/src/icons/nerdGlyphs.ts
//
// Canonical icon name -> Nerd Font CODEPOINT, for all 140 names in the icon registry.
//
// RETIRED FROM <Icon> as of the Phosphor migration (plan §10, 2026-08-27) — registry.ts no longer
// imports this file. It survives for two reasons only: (1) icons/specimen/ (the decision record
// for the Phosphor move) renders this era's glyphs in its "Nerd Font (incumbent)" comparison
// column, via the real subset font in assets/fonts/, and (2) iconNames.ts's 140-name canonical
// list was sourced from this file's key set at migration time and iconNames.test.ts cross-checks
// the two against drift while both still exist. The live art seam is icons/iconMap.ts +
// assets/icons/icon-manifest.json; do not add a new icon here expecting it to reach <Icon>.
//
// Codepoints, not characters, on purpose. `String.fromCodePoint(0xf048a)` is a surrogate PAIR in
// JS source, and a literal astral character in a `.ts` file is invisible to review, survives a
// copy-paste badly, and cannot be diffed — a number can be read, sorted and compared. The specimen
// converts at render time (see specimen/iconSetData.ts).
//
// EVERY CODEPOINT HERE MUST BE IN THE SUBSET FONT. app/scripts/build-icon-font.ts reads THIS FILE
// to decide what to subset, so adding an entry is two steps and never one: add it here, then
// `cd app && bun run icons:font`. Skip the second and the icon renders as nothing at all — see the
// zero-ink note below, which is why this cannot be left to be noticed later.
//
// A MISSING GLYPH IS INVISIBLE, NOT BROKEN-LOOKING. Measured in Chrome: a Private Use Area
// codepoint the font does not contain draws ZERO pixels — no `.notdef` box, no placeholder, no
// console warning. So an unmapped or unsubset icon is a button with nothing in it, which reads as a
// layout bug rather than a missing asset. That is what nerdGlyphs.test.ts's exact-count and
// font-coverage assertions exist to prevent, and why they assert an exact number rather than a
// lower bound.
//
// PROVENANCE. 124 entries carry the icon migration's verified mapping: 87 from a snake_case name
// match against the upstream `glyphnames.json` (10,995 glyphs), preferring the `md` set (Material
// Design, 6,896 glyphs — closest in spirit to the Lucide-derived names these call sites use), then
// `fa`, `cod`, `oct`, `dev`; 37 hand-picked where no same-name glyph existed. The trailing comment
// on each line is the upstream glyph name, kept because a later reader choosing a SIBLING icon needs
// to know which set this one came from — an `md` icon next to a `cod` icon is a visible weight
// mismatch, not a neutral choice.
//
// The 16 lines marked `+` were added here, because the 124-entry mapping was built from
// `pixelPaths.ts` plus the literal surface-glyph keys and never checked against `iconNames()`, which
// returns 140. Nine were genuinely unmapped and are design choices; each was picked by rendering the
// candidates from the upstream TTF at the sizes the app actually uses (13/16px) and measuring what
// fraction of pixels differed from the glyph it has to be told apart from:
//
//   FolderOpen     md-folder_open_outline — the file tree's collapse affordance, so it must read as
//                  the OPEN member of a pair with Folder at tree size. md-folder_open differs from
//                  md-folder by only 20.7% of inked pixels at 13px and is genuinely hard to tell
//                  apart; the outline variant differs by 41.5% (filled-closed vs outline-open) and
//                  keeps the whole folder group in one set.
//   SquareCheck    md-checkbox_marked — the real MDI checkbox pair with Square (see `~` below).
//   FolderInput    md-folder_move — the "Move to…" action, an arrow going INTO a folder.
//   FolderPlus     md-folder_plus — "New Folder"; filled, matching Folder's weight.
//   Redo2          md-redo — the exact mirror of Undo2's md-undo, from the same set; they sit
//                  side by side in the drawing toolbar, so a mismatched pair would be obvious.
//   Scissors       md-content_cut — the canonical scissors, for the editor's "Cut".
//   Ungroup        md-ungroup — an exact name match; separates two overlapping frames.
//   CaseSensitive  md-format_letter_case — the "Aa" mark it replaces, in md to match Regex's
//                  md-regex; the two sit in the same search-toggle row.
//   WholeWord      cod-whole_word — the ONLY glyph in all 10,995 that means "whole word". It is the
//                  one codicon in that row of three; there is no md equivalent to keep it uniform.
//
// The other seven `+` lines were aliases sharing a sibling's drawing, which the pixel-art set forced
// and a 10,995-glyph font does not. Each now reads as the thing it names:
//
//   File           md-file_outline — a plain page, vs FileText's fa-file_text page-with-lines.
//                  md-file was rejected: also filled, only 14.6% different at 13px.
//   MessagesSquare md-forum — two overlapping bubbles, vs MessageSquare's single one.
//   Inbox          md-inbox — a tray.        Server  md-server — stacked racks.
//   Settings2      md-cog — the file tree's system-folder mark. No clash with Settings, whose
//                  cod-settings is SLIDERS rather than a gear (63.1% different).
//   BrainCircuit   fa-brain — a side-profile brain, vs Brain's top-down md-brain (42.4%).
//   CalendarX      md-calendar_remove — a calendar with a removal cross, and the only line here
//                  chosen despite a low score (15.7% vs Calendar, because the frame dominates the
//                  raster at 13px). It is the "Disconnect Google Calendar" command's icon and never
//                  renders beside Calendar; the alternative broke weight with the md calendar for a
//                  pair that cannot be confused in practice.
//
// The one line marked `~` is a RE-POINT of an entry from the verified 124, and it is a deviation
// worth reading before trusting: Square was auto-matched to `md-square`, which is a SOLID FILLED
// BLOCK, not a checkbox. Square and SquareCheck render side by side at 13px (ChatView's
// multi-select, the task status menu), and against a solid block no checked partner is legible —
// md-checkbox_marked differs by 11.5% at 13px and 7% at 16px, i.e. two dark squares. The genuine
// MDI pair (checkbox_blank_outline / checkbox_marked) differs by 55.4%. The auto match was a name
// coincidence, never a drawing anyone chose.

/**
 * Name -> codepoint for every icon in the registry. Exactly the key set `iconNames()` returns;
 * nerdGlyphs.test.ts asserts that both ways, so a name added to the registry without a glyph here
 * fails immediately rather than rendering as an empty box.
 */
export const NERD_GLYPHS: Record<string, number> = {
    AppWindow: 0xf0614, // md-application_outline
    Archive: 0xf003c, // md-archive
    ArchiveX: 0xf1767, // md-archive_remove
    ArrowDown: 0xf0045, // md-arrow_down
    ArrowLeft: 0xf004d, // md-arrow_left
    ArrowRight: 0xf0054, // md-arrow_right
    ArrowUp: 0xf005d, // md-arrow_up
    AtSign: 0xf0065, // md-at
    Ban: 0xf05e, // fa-ban
    // Two overlapping circles, NOT md-circle_opacity (which renders as a halftone swatch). `Blend` is
    // the graph's "both brains" mode — vault plus memory, shown together — so it has to read as two
    // things overlapping. An opacity swatch reads as a transparency control.
    Blend: 0xf0695, // md-circle_multiple_outline
    Bold: 0xf032, // fa-bold
    Book: 0xf00ba, // md-book
    BookOpen: 0xf00bd, // md-book_open
    Bot: 0xf06a9, // md-robot
    // NOT md-box. Material's "box" glyph is a literal lowercase "box" WORDMARK — it renders as the
    // three letters, so the icon grid showed the word "box" sitting among 139 pictures. A name matching
    // a glyph name is not the same as a glyph matching the name's meaning, which is the whole reason the
    // full-set story exists to be looked at.
    Box: 0xf03d7, // md-package_variant_closed
    Brain: 0xf09d1, // md-brain
    BrainCircuit: 0xee9c, // + fa-brain
    Bug: 0xf00e4, // md-bug
    Calendar: 0xf00ed, // md-calendar
    CalendarX: 0xf00f4, // + md-calendar_remove
    CaseSensitive: 0xf0b34, // + md-format_letter_case
    ChartColumn: 0xf0128, // md-chart_bar
    ChartLine: 0xf012a, // md-chart_line
    Check: 0xf012c, // md-check
    ChevronDown: 0xf0140, // md-chevron_down
    ChevronLeft: 0xf0141, // md-chevron_left
    ChevronRight: 0xf0142, // md-chevron_right
    ChevronUp: 0xf0143, // md-chevron_up
    CircleCheck: 0xf05d, // fa-circle_check
    CircleHelp: 0xf02d7, // md-help_circle
    CircleX: 0xf0159, // md-close_circle
    Clipboard: 0xf0147, // md-clipboard
    ClipboardList: 0xf10d4, // md-clipboard_list
    Code: 0xf121, // fa-code
    Columns2: 0xf056d, // md-view_column
    Columns3: 0xf1487, // md-view_column_outline
    Combine: 0xebb6, // cod-combine
    Copy: 0xf0c5, // fa-copy
    Crown: 0xf01a5, // md-crown
    Database: 0xf01bc, // md-database
    Download: 0xf01da, // md-download
    Eraser: 0xf01fe, // md-eraser
    ExternalLink: 0xf08e, // fa-external_link
    Eye: 0xf0208, // md-eye
    File: 0xf0224, // + md-file_outline
    FilePlus: 0xf0752, // md-file_plus
    FileText: 0xf15c, // fa-file_text
    Flame: 0xeaf2, // cod-flame
    Folder: 0xf024b, // md-folder
    FolderInput: 0xf0252, // + md-folder_move
    FolderOpen: 0xf0dcf, // + md-folder_open_outline
    FolderPlus: 0xf0257, // + md-folder_plus
    Gauge: 0xf029a, // md-gauge
    Globe: 0xf0ac, // fa-globe
    Grid3x3: 0xf02c1, // md-grid
    Hash: 0xf4df, // oct-hash
    Heading1: 0xf026b, // md-format_header_1
    Heading2: 0xf026c, // md-format_header_2
    Heading3: 0xf026d, // md-format_header_3
    Heart: 0xf02d1, // md-heart
    Highlighter: 0xee5a, // fa-highlighter
    Image: 0xf02e9, // md-image
    ImagePlus: 0xf087c, // md-image_plus
    Inbox: 0xf0687, // + md-inbox
    Info: 0xf129, // fa-info
    Italic: 0xf033, // fa-italic
    KeyRound: 0xf0306, // md-key
    Landmark: 0xeed0, // fa-landmark
    Layers: 0xf0328, // md-layers
    LayoutGrid: 0xf0570, // md-view_grid
    LayoutList: 0xf0572, // md-view_list
    Lightbulb: 0xf0335, // md-lightbulb
    Link: 0xf0337, // md-link
    List: 0xf03a, // fa-list
    ListChecks: 0xf0756, // md-format_list_checks
    ListOrdered: 0xeb16, // cod-list_ordered
    Lock: 0xf033e, // md-lock
    Map: 0xf034d, // md-map
    Megaphone: 0xeb1e, // cod-megaphone
    Menu: 0xf035c, // md-menu
    MessageSquare: 0xf0369, // md-message_text
    MessagesSquare: 0xf028c, // + md-forum
    Minus: 0xf0374, // md-minus
    Network: 0xf06f3, // md-network
    Notebook: 0xf082e, // md-notebook
    Palette: 0xf03d8, // md-palette
    PanelBottom: 0xf10a9, // md-dock_bottom
    PanelLeft: 0xf10aa, // md-dock_left
    PanelRight: 0xf10ab, // md-dock_right
    Pen: 0xf03ea, // md-pen
    Pencil: 0xf03eb, // md-pencil
    PenTool: 0xf0d13, // md-fountain_pen_tip
    Pin: 0xf0403, // md-pin
    PinOff: 0xf0404, // md-pin_off
    Play: 0xf040a, // md-play
    Plus: 0xf0415, // md-plus
    Power: 0xf0425, // md-power
    PowerOff: 0xf0902, // md-power_off
    Redo2: 0xf044e, // + md-redo
    RefreshCw: 0xf0450, // md-refresh
    Regex: 0xf0451, // md-regex
    Repeat: 0xf0456, // md-repeat
    Replace: 0xeb3d, // cod-replace
    Reply: 0xf045a, // md-reply
    RotateCcw: 0xf006f, // md-backup_restore
    Scissors: 0xf0190, // + md-content_cut
    Search: 0xf002, // fa-search
    Send: 0xf048a, // md-send
    SeparatorHorizontal: 0xf093b, // md-arrow_split_horizontal
    Server: 0xf048b, // + md-server
    Settings: 0xeb52, // cod-settings
    Settings2: 0xf0493, // + md-cog
    Share: 0xf0496, // md-share
    Share2: 0xf0497, // md-share_variant
    Sigma: 0xf04a0, // md-sigma
    Smile: 0xf01f5, // md-emoticon_happy_outline
    Sparkles: 0xf0068, // md-auto_fix
    Square: 0xf0131, // ~ md-checkbox_blank_outline
    SquareCheck: 0xf0132, // + md-checkbox_marked
    SquareKanban: 0xf0728, // md-view_parallel
    SquarePlus: 0xf0fe, // fa-square_plus
    SquareSlash: 0xf0fe0, // md-slash_forward_box
    SquareTerminal: 0xf018d, // md-console
    SquareX: 0xf0158, // md-close_box_outline
    Star: 0xf04ce, // md-star
    Table: 0xf04eb, // md-table
    Tag: 0xf04f9, // md-tag
    TextQuote: 0xf027e, // md-format_quote_close
    Trash2: 0xf0a79, // md-trash_can
    TriangleAlert: 0xf0026, // md-alert
    Undo2: 0xf054c, // md-undo
    Ungroup: 0xf0550, // + md-ungroup
    Users: 0xf0c0, // fa-users
    Vote: 0xf0a1f, // md-vote
    WholeWord: 0xeb7e, // + cod-whole_word
    Wrench: 0xf05b7, // md-wrench
    X: 0xf467, // oct-x
    Zap: 0x26a1, // oct-zap
    ZoomIn: 0xeb81, // cod-zoom_in
    ZoomOut: 0xeb82, // cod-zoom_out
}

/**
 * The glyph for a name-shaped value that does NOT resolve — a legacy icon name in old vault
 * frontmatter, a typo in a `.settings` toolbar entry.
 *
 * It has to be its OWN codepoint, distinct from every entry above. Before this it was the literal
 * character `▸`, which is also what `Folder` was, so an unresolved icon name rendered as a folder
 * arrow and looked deliberate (registry.ts's FALLBACK_GLYPH — plan Task 3 points it here).
 *
 * A rhombus rather than a circle, deliberately. `CircleHelp` is already md-help_circle, a filled
 * circle with a question mark, and it is a control the user CLICKS for help — an unresolved icon
 * must not look like one. The diamond silhouette appears nowhere else in the set, so it reads as
 * "this is not an icon" at a glance (43.9% of pixels differ from md-help_circle at 13px).
 * md-progress_question was rejected for the opposite reason: its dashed ring reads as "loading",
 * and icon resolution is fully synchronous (see registry.ts), so nothing is ever pending.
 */
export const FALLBACK_CODEPOINT = 0xf0ba6 // md-help_rhombus_outline
