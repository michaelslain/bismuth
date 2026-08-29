// app/src/icons/specimen/iconSetData.ts
//
// PURE, framework-free data module backing the icon-set specimen story. Nothing here imports
// Solid or touches the DOM — see IconSetSpecimen.tsx for the component that renders this.
//
// This is the record of the decision in .claude/plans/2026-08-27-visual-unification-audit.md
// section 10: Bismuth is moving off the Nerd Font glyph system (app/src/icons/registry.ts +
// nerdGlyphs.ts) to real SVG icons, and the user has chosen PHOSPHOR REGULAR on the strength of
// the coverage numbers computed here against the app's real 140 canonical icon names.
//
// Three candidate sets ship as plain Iconify JSON (`{ icons: { <name>: { body } }, width, height }`)
// — no React/Solid binding, just inlined markup:
//   @iconify-json/radix-icons  (15x15 native grid)
//   @iconify-json/ph           (256x256 native grid) — "ph" = Phosphor; thin/regular are both here
//   @iconify-json/iconoir      (24x24 native grid)
//
// MAPPING METHODOLOGY. Each candidate set names icons differently from the Lucide-derived
// canonical names this app uses (nerdGlyphs.ts). The tables below were built by kebab-casing each
// canonical name and, where that didn't exist in the set's icons.json, searching the set's actual
// key list by hand for a semantic equivalent (grepping the real JSON, never guessed from memory
// or a website) and verifying with `!!data.icons[slug]` before it went in the table. A name absent
// from a table is a GENUINE gap in that set — not an oversight — and getIconBody() returns null for
// it so the specimen can render a visible MISSING marker rather than hide the gap.
//
// PHOSPHOR'S 15 ORIGINALLY-UNMAPPED NAMES — resolved here one by one (plan §10, "several are
// almost certainly mapping gaps"):
//   BrainCircuit -> head-circuit      (a head silhouette printed with circuit traces - exact fit)
//   Columns3     -> columns           (Phosphor's one 3-column layout glyph; also serves Columns2)
//   Inbox        -> tray              (mail/inbox tray - the standard cross-set proxy for "inbox")
//   Layers       -> stack             (the standard cross-set proxy for "layers")
//   ListOrdered  -> list-numbers      (exact semantic match)
//   Menu         -> hamburger         (exact - Phosphor's three-line hamburger glyph)
//   PanelBottom  -> square-half-bottom (closest analog: a square split with the bottom half filled)
//   SeparatorHorizontal -> line-segment (a plain horizontal line - the separator concept)
//   Sigma        -> sigma             (exact match - Phosphor has it natively)
//   ArchiveX     -> GENUINE GAP. No archive+remove combination glyph exists in Phosphor 9161.
//   Blend        -> GENUINE GAP. No "blend" concept (search for the word itself: zero hits).
//   FolderInput  -> GENUINE GAP. folder-plus/folder-minus exist; nothing for "data flowing in".
//   Map          -> GENUINE GAP. Only map-PIN variants exist; no plain map/atlas glyph.
//   Vote         -> GENUINE GAP. No ballot/vote glyph in the set.
//   Regex        -> GENUINE GAP, hand-authored SVG (see CUSTOM_SVGS below). The single most likely
//                    of the 15 to need custom artwork, confirmed: `.*`-style regex marks are a
//                    niche find-UI concept absent from general-purpose icon libraries.
//   WholeWord    -> GENUINE GAP, hand-authored SVG (see CUSTOM_SVGS below). Same story as Regex -
//                    the `[W]` whole-word-match mark used by the editor find panel has no
//                    off-the-shelf equivalent in any of the three candidate sets either.
//
// Net effect: Phosphor resolves 133/140 from the library itself, plus the 2 hand-authored marks
// above (Regex, WholeWord) = 135/140 with real art, with 5 true gaps (ArchiveX, Blend, FolderInput,
// Map, Vote) that would need their own custom artwork before a full migration.

import phData from '@iconify-json/ph/icons.json'
import radixData from '@iconify-json/radix-icons/icons.json'
import iconoirData from '@iconify-json/iconoir/icons.json'
import { NERD_GLYPHS } from '../nerdGlyphs'

/** The five columns the specimen renders, left to right. */
export type IconSetId =
    'nerd' | 'radix' | 'phosphorThin' | 'phosphorRegular' | 'iconoir'

export interface IconSetMeta {
    id: IconSetId
    label: string
    /** True for exactly one column: the set the user picked. */
    chosen: boolean
    /** Native grid the set was drawn on, e.g. "15x15". Facts only, not used for scaling. */
    sourceGrid: string
    strokeNote: string
    licence: string
}

export const ICON_SETS: IconSetMeta[] = [
    {
        id: 'nerd',
        label: 'Nerd Font (incumbent)',
        chosen: false,
        sourceGrid: 'variable (font glyphs)',
        strokeNote:
            'monospace font glyphs, not vector strokes - weight fixed by the face',
        licence: 'MIT (Nerd Fonts patcher) + per-glyph-source licences',
    },
    {
        id: 'radix',
        label: 'Radix Icons',
        chosen: false,
        sourceGrid: '15x15',
        strokeNote:
            'fixed 1px stroke drawn for crispness at exactly 15px - degrades off-grid',
        licence: 'MIT',
    },
    {
        id: 'phosphorThin',
        label: 'Phosphor Thin',
        chosen: false,
        sourceGrid: '256x256 (all Phosphor weights)',
        strokeNote:
            'hairline stroke - goes faint / disappears at 14px, rejected for that reason',
        licence: 'MIT',
    },
    {
        id: 'phosphorRegular',
        label: 'Phosphor Regular',
        chosen: true,
        sourceGrid: '256x256 (all Phosphor weights)',
        strokeNote:
            'medium stroke - holds up at 14px, the deciding factor vs. Thin',
        licence: 'MIT',
    },
    {
        id: 'iconoir',
        label: 'Iconoir',
        chosen: false,
        sourceGrid: '24x24',
        strokeNote:
            '1.5px stroke on a 24px grid - reads fine at 14px, runner-up',
        licence: 'MIT',
    },
]

/** The app's real 140 canonical icon names, in the order nerdGlyphs.ts declares them - NOT a
 *  curated showcase list. The whole point of this specimen is to see how each set handles the
 *  awkward/technical names (BrainCircuit, Regex, Sigma, PanelLeft...), not just the easy ones. */
export const CANONICAL_NAMES: string[] = Object.keys(NERD_GLYPHS)

interface IconifyIconData {
    icons: Record<string, { body: string }>
    width?: number
    height?: number
}

const PH: IconifyIconData = phData as IconifyIconData
const RADIX: IconifyIconData = radixData as IconifyIconData
const ICONOIR: IconifyIconData = iconoirData as IconifyIconData

/** canonical name -> Radix slug. 84/140 verified present in radix-icons/icons.json. */
const RADIX_MAP: Record<string, string> = {
    Archive: 'archive',
    ArrowDown: 'arrow-down',
    ArrowLeft: 'arrow-left',
    ArrowRight: 'arrow-right',
    ArrowUp: 'arrow-up',
    Bold: 'font-bold',
    BookOpen: 'reader',
    Box: 'box',
    Calendar: 'calendar',
    ChartColumn: 'bar-chart',
    Check: 'check',
    ChevronDown: 'chevron-down',
    ChevronLeft: 'chevron-left',
    ChevronRight: 'chevron-right',
    ChevronUp: 'chevron-up',
    CircleHelp: 'question-mark-circled',
    CircleX: 'cross-circled',
    Clipboard: 'clipboard',
    ClipboardList: 'clipboard-copy',
    Code: 'code',
    Copy: 'copy',
    Database: 'database',
    Download: 'download',
    Eraser: 'eraser',
    ExternalLink: 'external-link',
    Eye: 'eye-open',
    File: 'file',
    FilePlus: 'file-plus',
    FileText: 'file-text',
    Globe: 'globe',
    Grid3x3: 'grid',
    Hash: 'input',
    Heading1: 'heading',
    Heading2: 'heading',
    Heading3: 'heading',
    Heart: 'heart',
    Image: 'image',
    Info: 'info-circled',
    Italic: 'font-italic',
    Layers: 'layers',
    LayoutGrid: 'dashboard',
    LayoutList: 'rows',
    Link: 'link-2',
    List: 'list-bullet',
    Lock: 'lock-closed',
    Megaphone: 'speaker-loud',
    Menu: 'hamburger-menu',
    MessageSquare: 'chat-bubble',
    MessagesSquare: 'chat-bubble',
    Minus: 'minus',
    PanelBottom: 'panel-bottom',
    PanelLeft: 'panel-left',
    PanelRight: 'panel-right',
    Pen: 'pencil-1',
    Pencil: 'pencil-2',
    Pin: 'drawing-pin',
    Play: 'play',
    Plus: 'plus',
    Redo2: 'update',
    RefreshCw: 'reload',
    Repeat: 'loop',
    RotateCcw: 'counter-clockwise-clock',
    Scissors: 'scissors',
    Search: 'magnifying-glass',
    Send: 'paper-plane',
    Server: 'server',
    Settings: 'gear',
    Settings2: 'mixer-horizontal',
    Share: 'share-1',
    Share2: 'share-2',
    Smile: 'face',
    Sparkles: 'magic-wand',
    Square: 'square',
    SquarePlus: 'plus-circled',
    SquareX: 'cross-circled',
    Star: 'star',
    Table: 'table',
    TextQuote: 'quote',
    Trash2: 'trash',
    Undo2: 'reset',
    X: 'cross-1',
    Zap: 'lightning-bolt',
    ZoomIn: 'zoom-in',
    ZoomOut: 'zoom-out',
}

/** canonical name -> Phosphor slug (regular/thin share names; the style suffix is applied by
 *  getIconBody). 133/140 verified present in @iconify-json/ph. */
const ICON_MAP: Record<string, string> = {
    AppWindow: 'app-window',
    Archive: 'archive',
    ArrowDown: 'arrow-down',
    ArrowLeft: 'arrow-left',
    ArrowRight: 'arrow-right',
    ArrowUp: 'arrow-up',
    AtSign: 'at',
    Ban: 'prohibit',
    Bold: 'text-b',
    Book: 'book',
    BookOpen: 'book-open',
    Bot: 'robot',
    Box: 'cube',
    Brain: 'brain',
    BrainCircuit: 'head-circuit',
    Bug: 'bug',
    Calendar: 'calendar',
    CalendarX: 'calendar-x',
    CaseSensitive: 'text-aa',
    ChartColumn: 'chart-bar',
    ChartLine: 'chart-line',
    Check: 'check',
    ChevronDown: 'caret-down',
    ChevronLeft: 'caret-left',
    ChevronRight: 'caret-right',
    ChevronUp: 'caret-up',
    CircleCheck: 'check-circle',
    CircleHelp: 'question',
    CircleX: 'x-circle',
    Clipboard: 'clipboard',
    ClipboardList: 'clipboard-text',
    Code: 'code',
    Columns2: 'columns',
    Columns3: 'columns',
    Combine: 'intersect',
    Copy: 'copy',
    Crown: 'crown',
    Database: 'database',
    Download: 'download-simple',
    Eraser: 'eraser',
    ExternalLink: 'arrow-square-out',
    Eye: 'eye',
    File: 'file',
    FilePlus: 'file-plus',
    FileText: 'file-text',
    Flame: 'flame',
    Folder: 'folder',
    FolderOpen: 'folder-open',
    FolderPlus: 'folder-plus',
    Gauge: 'gauge',
    Globe: 'globe',
    Grid3x3: 'grid-nine',
    Hash: 'hash',
    Heading1: 'text-h-one',
    Heading2: 'text-h-two',
    Heading3: 'text-h-three',
    Heart: 'heart',
    Highlighter: 'highlighter-circle',
    Image: 'image',
    ImagePlus: 'image-square',
    Inbox: 'tray',
    Info: 'info',
    Italic: 'text-italic',
    KeyRound: 'key',
    Landmark: 'bank',
    Layers: 'stack',
    LayoutGrid: 'squares-four',
    LayoutList: 'rows',
    Lightbulb: 'lightbulb',
    Link: 'link',
    List: 'list',
    ListChecks: 'list-checks',
    ListOrdered: 'list-numbers',
    Lock: 'lock',
    Megaphone: 'megaphone',
    Menu: 'hamburger',
    MessageSquare: 'chat-circle',
    MessagesSquare: 'chats',
    Minus: 'minus',
    Network: 'network',
    Notebook: 'notebook',
    Palette: 'palette',
    PanelBottom: 'square-half-bottom',
    PanelLeft: 'sidebar-simple',
    PanelRight: 'sidebar-simple',
    Pen: 'pen',
    Pencil: 'pencil-simple',
    PenTool: 'pen-nib',
    Pin: 'push-pin',
    PinOff: 'push-pin-slash',
    Play: 'play',
    Plus: 'plus',
    Power: 'power',
    PowerOff: 'power',
    Redo2: 'arrow-clockwise',
    RefreshCw: 'arrows-clockwise',
    Repeat: 'repeat',
    Replace: 'arrows-left-right',
    Reply: 'arrow-bend-up-left',
    RotateCcw: 'arrow-counter-clockwise',
    Scissors: 'scissors',
    Search: 'magnifying-glass',
    Send: 'paper-plane-tilt',
    SeparatorHorizontal: 'line-segment',
    Server: 'hard-drives',
    Settings: 'gear',
    Settings2: 'sliders',
    Share: 'share',
    Share2: 'share-network',
    Sigma: 'sigma',
    Smile: 'smiley',
    Sparkles: 'sparkle',
    Square: 'square',
    SquareCheck: 'check-square',
    SquareKanban: 'kanban',
    SquarePlus: 'plus-square',
    SquareSlash: 'prohibit-inset',
    SquareTerminal: 'terminal-window',
    SquareX: 'x-square',
    Star: 'star',
    Table: 'table',
    Tag: 'tag',
    TextQuote: 'quotes',
    Trash2: 'trash',
    TriangleAlert: 'warning',
    Undo2: 'arrow-counter-clockwise',
    Ungroup: 'selection-slash',
    Users: 'users',
    Wrench: 'wrench',
    X: 'x',
    Zap: 'lightning',
    ZoomIn: 'magnifying-glass-plus',
    ZoomOut: 'magnifying-glass-minus',
}

/** canonical name -> Iconoir slug. 103/140 verified present in @iconify-json/iconoir. */
const ICONOIR_MAP: Record<string, string> = {
    AppWindow: 'app-window',
    Archive: 'archive',
    ArrowDown: 'arrow-down',
    ArrowLeft: 'arrow-left',
    ArrowRight: 'arrow-right',
    ArrowUp: 'arrow-up',
    AtSign: 'at-sign',
    Bold: 'bold',
    Book: 'book',
    BookOpen: 'open-book',
    Box: 'box',
    Brain: 'brain',
    Bug: 'bug',
    Calendar: 'calendar',
    CalendarX: 'calendar-minus',
    ChartColumn: 'graph-up',
    ChartLine: 'stats-report',
    Check: 'check',
    ChevronDown: 'nav-arrow-down',
    ChevronLeft: 'nav-arrow-left',
    ChevronRight: 'nav-arrow-right',
    ChevronUp: 'nav-arrow-up',
    CircleCheck: 'check-circle',
    CircleHelp: 'help-circle',
    CircleX: 'xmark-circle',
    Clipboard: 'clipboard',
    ClipboardList: 'multiple-pages',
    Code: 'code',
    Columns2: 'view-columns-2',
    Columns3: 'view-columns-3',
    Combine: 'combine',
    Copy: 'copy',
    Crown: 'crown',
    Database: 'database',
    Download: 'download',
    Eraser: 'erase',
    ExternalLink: 'open-new-window',
    Eye: 'eye',
    FileText: 'page',
    Flame: 'fire-flame',
    Folder: 'folder',
    FolderOpen: 'folder',
    FolderPlus: 'folder-plus',
    Globe: 'globe',
    Grid3x3: 'dots-grid-3x3',
    Hash: 'hash',
    Heading1: 'text-h1',
    Heading2: 'text-h2',
    Heading3: 'text-h3',
    Heart: 'heart',
    Highlighter: 'text-highlight',
    ImagePlus: 'media-image-plus',
    Info: 'info-circle',
    Italic: 'italic',
    KeyRound: 'key-command',
    Landmark: 'bank',
    Layers: 'layers',
    LayoutGrid: 'view-grid',
    LayoutList: 'view-grid-outline',
    Lightbulb: 'light-bulb',
    Link: 'link',
    List: 'list',
    ListChecks: 'list-select',
    ListOrdered: 'ordered-list',
    Lock: 'lock',
    Megaphone: 'megaphone',
    Menu: 'menu',
    MessageSquare: 'chat-bubble',
    MessagesSquare: 'chat-lines',
    Minus: 'minus',
    Network: 'network',
    Notebook: 'notebook',
    Palette: 'palette',
    PanelLeft: 'layout-left',
    PanelRight: 'layout-right',
    Pen: 'edit-pencil',
    Pencil: 'design-pencil',
    PenTool: 'pen-tablet',
    Pin: 'pin',
    PinOff: 'pin-slash',
    Play: 'play',
    Plus: 'plus',
    Power: 'power-off',
    PowerOff: 'power-off',
    Redo2: 'redo-action',
    RefreshCw: 'refresh-double',
    Repeat: 'repeat',
    Reply: 'reply',
    RotateCcw: 'undo-action',
    Scissors: 'scissor-01',
    Search: 'search',
    Send: 'send',
    Settings: 'settings',
    Settings2: 'sliders-horizontal',
    Share: 'share-android',
    Share2: 'share-ios',
    Sigma: 'sigma-function',
    Smile: 'emoji',
    Sparkles: 'sparks',
    Square: 'square',
    SquareCheck: 'check-square',
    SquareKanban: 'kanban-board',
    SquarePlus: 'plus-square',
    SquareSlash: 'slash-square',
    SquareTerminal: 'terminal',
    SquareX: 'x-square',
    Star: 'star',
    Table: 'table',
    Tag: 'tag',
    TextQuote: 'quote',
    Trash2: 'trash',
    TriangleAlert: 'warning-triangle',
    Undo2: 'undo-action',
    Users: 'group',
    Wrench: 'wrench',
    X: 'xmark',
    Zap: 'flash',
    ZoomIn: 'zoom-in',
    ZoomOut: 'zoom-out',
}

/** The two ASCII find-panel marks Phosphor has no equivalent for (plan §10.1's "trap to resolve
 *  first"). Hand-authored, deliberately simple - a monospace text glyph inside an SVG viewBox
 *  matching Phosphor's 0-256 box, so it sits at the same visual weight as its neighbours in the
 *  chosen column. These are NOT from Phosphor; they exist so the chosen set's column has no
 *  visible holes for the two names the app's find panel actually needs. */
const CUSTOM_SVGS: Record<string, { body: string; viewBox: string }> = {
    Regex: {
        viewBox: '0 0 256 256',
        body: '<text x="128" y="172" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="120" font-weight="600" text-anchor="middle" fill="currentColor">.*</text>',
    },
    WholeWord: {
        viewBox: '0 0 256 256',
        body: '<text x="128" y="164" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="84" font-weight="600" text-anchor="middle" fill="currentColor">[W]</text>',
    },
}

export interface IconBody {
    kind: 'svg' | 'glyph' | 'missing'
    /** svg: inner markup to place inside an <svg>. glyph: the literal character. missing: unused. */
    content: string
    /** svg only. */
    viewBox?: string
    /** True when this body is hand-authored rather than sourced from the icon set itself. */
    custom?: boolean
}

const svgFrom = (
    data: IconifyIconData,
    slug: string | undefined,
): IconBody | null => {
    if (!slug) return null
    const entry = data.icons[slug]
    if (!entry) return null
    const w = data.width ?? 24
    const h = data.height ?? 24
    return { kind: 'svg', content: entry.body, viewBox: `0 0 ${w} ${h}` }
}

/**
 * Resolve one canonical name to renderable art for one column, or null when that set has a
 * genuine gap for this name. Regex/WholeWord in the `phosphorRegular` column resolve to the
 * hand-authored marks above rather than null, because that is the CHOSEN column and plan §10.1
 * requires those two not "silently render nothing".
 */
export const getIconBody = (
    setId: IconSetId,
    name: string,
): IconBody | null => {
    if (setId === 'nerd') {
        const cp = NERD_GLYPHS[name]
        if (cp === undefined) return null
        return { kind: 'glyph', content: String.fromCodePoint(cp) }
    }

    if (setId === 'radix') return svgFrom(RADIX, RADIX_MAP[name])

    if (setId === 'phosphorThin' || setId === 'phosphorRegular') {
        const slug = ICON_MAP[name]
        const suffix = setId === 'phosphorThin' ? '-thin' : ''
        const body = svgFrom(PH, slug ? slug + suffix : undefined)
        if (body) return body
        if (setId === 'phosphorRegular' && CUSTOM_SVGS[name]) {
            const custom = CUSTOM_SVGS[name]
            return {
                kind: 'svg',
                content: custom.body,
                viewBox: custom.viewBox,
                custom: true,
            }
        }
        return null
    }

    if (setId === 'iconoir') return svgFrom(ICONOIR, ICONOIR_MAP[name])

    return null
}

export interface CoverageResult {
    id: IconSetId
    resolved: number
    total: number
    /** resolved / total, 0..1. */
    ratio: number
}

/** Coverage per set against CANONICAL_NAMES - measured by actually resolving every name, not by
 *  reading the size of a mapping table (a table could have stale/dead entries). */
export const computeCoverage = (setId: IconSetId): CoverageResult => {
    const total = CANONICAL_NAMES.length
    const resolved = CANONICAL_NAMES.filter(
        n => getIconBody(setId, n) !== null,
    ).length
    return {
        id: setId,
        resolved,
        total,
        ratio: total === 0 ? 0 : resolved / total,
    }
}

export const allCoverage = (): CoverageResult[] =>
    ICON_SETS.map(s => computeCoverage(s.id))

/** Names where phosphorRegular (the chosen set) has no art at all, real or hand-authored - the
 *  true remaining gaps a migration would need custom artwork for. */
export const phosphorRegularGaps = (): string[] =>
    CANONICAL_NAMES.filter(n => getIconBody('phosphorRegular', n) === null)
