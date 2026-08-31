// app/scripts/build-pixel-icons.ts
//
// Generates `app/src/icons/pixelPaths.ts` — the static NAME -> SVG-path-data map behind the
// pixel half of the icon registry (bismuth-design/ascii/README.md "Iconography").
//
// Why generated and committed rather than imported at runtime: the upstream package is ~2MB of
// SVG/PNG/webfont across 2,300 files, and we need ~140 of them. This script reads only the
// mapped icons out of node_modules, extracts each one's single `d` attribute (every icon in the
// set is one axis-aligned path on a 24x24 grid — no strokes, no groups, no fills), and emits a
// plain TS object. The app then ships ~30KB of path data with NO dependency on the package.
//
// Run after changing PIXEL_MAP below:  bun run icons:build   (from app/)
//
// The mapping is deliberately hand-written, not name-matched: the app's call sites use canonical
// Lucide-style names ("ChevronDown", "Trash2") and the pixel library uses its own vocabulary
// ("angle-down", "trash"), so every pair is a judgment call about which pixel drawing best
// carries that name's MEANING in this app.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SVG_DIR = join(
    HERE,
    '..',
    'node_modules',
    '@hackernoon',
    'pixel-icon-library',
    'icons',
    'SVG',
    'regular',
)
const OUT = join(HERE, '..', 'src', 'icons', 'pixelPaths.ts')

/**
 * Canonical icon name -> pixel-icon-library file (without `.svg`) in `icons/SVG/regular`.
 *
 * NOT listed here, by design:
 *   - The seven SURFACE glyphs and their aliases (graph/note/base/calendar/agent/daemon/folder)
 *     — those stay typed ASCII in registry.ts; they carry surface identity in the tab rail and
 *     vault tree, which is the one place the ASCII vocabulary is load-bearing.
 *   - Names whose ASCII form IS the better drawing: `x` (close), `[ ]`/`[x]` (task checkboxes),
 *     `<<`/`>>` (undo/redo, collapse handles), `.*` (regex), `Aa` (case-sensitive), `S` (sigma),
 *     `><` (scissors), `][` (ungroup), `[W]` (whole word). The library has no equivalent for
 *     these and inventing a loose one would read worse than the literal syntax.
 */
const PIXEL_MAP: Record<string, string> = {
    AppWindow: 'window-restore',
    Archive: 'archive',
    ArchiveX: 'archive',
    ArrowDown: 'arrow-down',
    ArrowLeft: 'arrow-left',
    ArrowRight: 'arrow-right',
    ArrowUp: 'arrow-up',
    AtSign: 'at',
    Ban: 'times-circle',
    Blend: 'themes',
    Bold: 'bold',
    Book: 'book',
    BookOpen: 'book',
    Box: 'archive',
    Brain: 'lightbulb',
    Bug: 'bug',
    ChartColumn: 'analytics',
    ChartLine: 'chart-line',
    Check: 'check',
    CircleCheck: 'check-circle',
    CircleHelp: 'question-circle',
    CircleX: 'times-circle',
    // All four chevrons use the `angle-*` family — the library's `chevron-*` only ships
    // down/up, and mixing the two families would give the four directions different weights.
    ChevronDown: 'angle-down',
    ChevronLeft: 'angle-left',
    ChevronRight: 'angle-right',
    ChevronUp: 'angle-up',
    Clipboard: 'clipboard',
    ClipboardList: 'check-list',
    Code: 'code',
    Columns2: 'divider',
    Columns3: 'grid',
    Combine: 'merge',
    Copy: 'copy',
    Crown: 'crown',
    Database: 'table',
    Download: 'download',
    Eraser: 'broom',
    Eye: 'eye',
    ExternalLink: 'external-link',
    FilePlus: 'edit', // "compose a new note", not "a file with a plus"
    Flame: 'fire',
    Gauge: 'trending',
    Globe: 'globe',
    Grid3x3: 'grid',
    Hash: 'hashtag',
    Heading1: 'h1',
    Heading2: 'h2',
    Heading3: 'h3',
    Heart: 'heart',
    Highlighter: 'highlight',
    Image: 'image',
    ImagePlus: 'image',
    Info: 'info-circle',
    Italic: 'italics',
    KeyRound: 'lock-alt',
    Landmark: 'bank',
    Layers: 'shapes',
    LayoutGrid: 'grid',
    LayoutList: 'bullet-list',
    Lightbulb: 'lightbulb',
    Link: 'link',
    List: 'bullet-list',
    ListChecks: 'check-list',
    ListOrdered: 'numbered-list',
    Lock: 'lock',
    Map: 'location-pin',
    Megaphone: 'bullhorn',
    Menu: 'bars',
    Minus: 'minus',
    Network: 'sitemap',
    Notebook: 'notebook',
    Palette: 'paint-brush',
    PanelBottom: 'divider',
    PanelLeft: 'side-nav-collapse',
    PanelRight: 'side-nav-expand',
    Pen: 'pen',
    Pencil: 'pencil',
    PenTool: 'pen-nib',
    Pin: 'thumbtack',
    PinOff: 'thumbtack',
    Play: 'play',
    Plus: 'plus',
    Power: 'play', // daemon start/stop reads better as transport controls than as a power symbol
    PowerOff: 'pause',
    RefreshCw: 'refresh',
    Repeat: 'refresh',
    Replace: 'shuffle',
    Reply: 'share-alt', // the curved arrow; `share` is the three-node network symbol
    RotateCcw: 'refresh',
    Search: 'search',
    Send: 'plane',
    SeparatorHorizontal: 'divider',
    Settings: 'cog',
    Share: 'share',
    Smile: 'face-grin',
    Sparkles: 'sparkles',
    SquareKanban: 'grid',
    SquarePlus: 'plus',
    SquareSlash: 'times-square',
    SquareTerminal: 'laptop-code',
    SquareX: 'times-square',
    Star: 'star',
    Tag: 'tag',
    TextQuote: 'quote-left',
    Trash2: 'trash',
    TriangleAlert: 'exclamation-triangle',
    Users: 'users',
    Vote: 'vote-yeah',
    Wrench: 'pencil-ruler',
    Zap: 'bolt',
    ZoomIn: 'expand',
    ZoomOut: 'collapse',
}

/** `<polygon points="x y x y …">` -> the equivalent closed path. Every edge in this set is
 *  axis-aligned, so emitting `h`/`v` deltas instead of `L x y` roughly halves the output. */
const polygonToPath = (points: string): string => {
    const n = points
        .trim()
        .split(/[\s,]+/)
        .map(Number)
    if (n.length < 6 || n.length % 2 !== 0)
        throw new Error(`bad polygon points: ${points}`)
    let [cx, cy] = [n[0], n[1]]
    let d = `M${cx} ${cy}`
    for (let i = 2; i < n.length; i += 2) {
        const [x, y] = [n[i], n[i + 1]]
        if (y === cy && x !== cx) d += `h${x - cx}`
        else if (x === cx && y !== cy) d += `v${y - cy}`
        else if (x !== cx || y !== cy) d += `L${x} ${y}`
        ;[cx, cy] = [x, y]
    }
    return `${d}Z`
}

/** `<rect x y width height>` -> the equivalent closed path (x/y default to 0). */
const rectToPath = (attrs: string): string => {
    const num = (k: string) =>
        Number(new RegExp(`\\b${k}="([^"]+)"`).exec(attrs)?.[1] ?? 0)
    const [x, y, w, h] = [num('x'), num('y'), num('width'), num('height')]
    return `M${x} ${y}h${w}v${h}h${-w}Z`
}

/**
 * Flatten a pixel-library SVG to ONE `d` string.
 *
 * The set draws with a mix of `<path>`, `<polygon>` and `<rect>` (sometimes several in one
 * icon), so we normalize all three to path data. Two things make the flattening safe: every
 * element uses the default nonzero fill (holes are already reverse-wound subpaths inside their
 * own `d`, so concatenation preserves them), and nothing carries a transform. The only element
 * we must DROP is the `fill="none"` 24x24 background rect a few icons wrap in a `<g>` — filling
 * it would paint a solid block over the icon.
 */
function extractPath(file: string): string {
    const svg = readFileSync(join(SVG_DIR, `${file}.svg`), 'utf8')
    if (!/viewBox="0 0 24 24"/.test(svg))
        throw new Error(`${file}.svg: not on the 24x24 grid`)
    if (/transform=/.test(svg))
        throw new Error(`${file}.svg: has a transform (flattening unsafe)`)

    const out: string[] = []
    for (const [el] of svg.matchAll(/<(?:path|polygon|rect)\b[^>]*>/g)) {
        if (/fill="none"/.test(el)) continue // the BG_copy_* bounding rect
        // A leading RELATIVE `m` is only equivalent to `M` while the current point is the origin —
        // true for the first subpath of the original file, false once we append after a `Z`. Promote
        // it, or every shape after the first lands at the wrong offset.
        if (el.startsWith('<path'))
            out.push(/\sd="([^"]+)"/.exec(el)![1].replace(/^\s*m/, 'M'))
        else if (el.startsWith('<polygon'))
            out.push(polygonToPath(/\spoints="([^"]+)"/.exec(el)![1]))
        else out.push(rectToPath(el))
    }
    if (out.length === 0)
        throw new Error(`${file}.svg: no drawable shapes found`)
    return out.join('')
}

const missing = Object.values(PIXEL_MAP).filter(
    f => !existsSync(join(SVG_DIR, `${f}.svg`)),
)
if (missing.length) {
    console.error(`Unknown pixel icons: ${[...new Set(missing)].join(', ')}`)
    process.exit(1)
}

const entries = Object.keys(PIXEL_MAP)
    .sort((a, b) => a.localeCompare(b))
    .map(name => `  ${name}: ${JSON.stringify(extractPath(PIXEL_MAP[name]))},`)
    .join('\n')

writeFileSync(
    OUT,
    `// app/src/icons/pixelPaths.ts
//
// GENERATED by app/scripts/build-pixel-icons.ts — do not edit by hand.
// Run \`bun run icons:build\` (from app/) after changing that script's PIXEL_MAP.
//
// Canonical icon name -> SVG path data from HackerNoon's Pixel Icon Library, drawn on a 24x24
// grid. Icons are CC BY 4.0 (c) HackerNoon — see docs/overview/third-party-notices.md.
// Paths are unmodified; only the surrounding <svg> wrapper is ours (see Icon.tsx).

/** Name -> the icon's \`d\`, to be rendered in a \`viewBox="0 0 24 24"\` with \`fill="currentColor"\`. */
export const PIXEL_PATHS: Record<string, string> = {
${entries}
};
`,
    'utf8',
)

console.log(`wrote ${OUT} (${Object.keys(PIXEL_MAP).length} icons)`)
