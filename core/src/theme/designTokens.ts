// core/src/theme/designTokens.ts
// THE registry of design tokens: every CSS custom property on `:root` that is a design CHOICE
// (as opposed to font metrics, a constraint formula, or a per-person layout preference — those are
// UNREGISTERED_ROOT_VARS below, each with its reason). One entry per token: its CSS var name
// without `--` (the key), its kind (which fixes what a valid value looks like), its group, its
// default (what `app/src/global.css` paints at default settings) and one line saying what it paints.
//
// Bundle-safe: pure data + pure functions, no `node:*`, no Bun, no Solid. `tokens.ts` imports
// `applyColorTokens` from here at runtime; this file imports `ColorTokens` from `tokens.ts` as a
// TYPE only, so there is no runtime cycle. `app/src/tokenRegistry.test.ts` pins this file against
// `global.css` and `settingsToCssVars(DEFAULTS)`: a token added to one without the other fails.
//
// Colour defaults are the `ink` theme's. They are literals here (not read from tokens.ts) precisely
// because of the type-only import; the pin test asserts each equals what the projection emits.
import type { ColorTokens } from './tokens'
import { MONO_FONTS, PROSE_FONTS } from './fontFamilies'

export type TokenKind =
    | 'color'
    | 'length'
    | 'number'
    | 'duration'
    | 'easing'
    | 'shadow'
    | 'border'
    | 'gradient'
    | 'font-mono'
    | 'font-prose'
    | 'scheme'

export type TokenGroup =
    | 'surface'
    | 'text'
    | 'accent'
    | 'graph'
    | 'category'
    | 'semantic'
    | 'state'
    | 'effect'
    | 'callout'
    | 'font'
    | 'type-scale'
    | 'weight'
    | 'line-height'
    | 'tracking'
    | 'spacing'
    | 'size'
    | 'radius'
    | 'rule'
    | 'motion'
    | 'popover'
    | 'cursor'

export type TokenDef = {
    key: string // CSS var without '--'
    kind: TokenKind
    group: TokenGroup
    default: string // global.css's value, whitespace-normalized (ink's for a field token)
    doc: string // one line: what it paints
    field?: keyof ColorTokens // read by JS through ColorTokens
    index?: number // with field 'accentPalette': which slot (0..4)
    setting?: string // legacy .settings path aliasing this token
}

/** Display / scaffold order. */
export const TOKEN_GROUPS: readonly TokenGroup[] = [
    'surface',
    'text',
    'accent',
    'graph',
    'category',
    'semantic',
    'state',
    'effect',
    'callout',
    'font',
    'type-scale',
    'weight',
    'line-height',
    'tracking',
    'spacing',
    'size',
    'radius',
    'rule',
    'motion',
    'popover',
    'cursor',
]

type Extra = Pick<TokenDef, 'field' | 'index' | 'setting'>
/** One builder per group keeps each token to a single line below. */
const grp =
    (group: TokenGroup) =>
    (
        key: string,
        kind: TokenKind,
        def: string,
        doc: string,
        extra: Extra = {},
    ): TokenDef => ({ key, kind, group, default: def, doc, ...extra })

const surface = grp('surface')
const SURFACE: TokenDef[] = [
    surface('bg', 'color', '#15161A', 'Canvas behind everything.', { field: 'background' }),
    surface('surface-1', 'color', '#20222A', 'First raised surface: cards, panels.', { field: 'surface' }),
    surface('surface-2', 'color', '#272A33', 'Second raised surface: inputs, wells.', { field: 'surface2' }),
    surface('surface-3', 'color', '#31353F', 'Third raised surface: pressed and selected fills.', { field: 'surface3' }),
    surface('panel', 'color', '#20222A', 'Panel fill (same as surface-1 in every built-in theme).'),
    surface('rail', 'color', '#101116', 'Sidebar and top strip, a notch under the canvas.', { field: 'rail' }),
    surface('editor', 'color', '#191A1F', 'Main note pane.', { field: 'editor' }),
    surface('pop-bg', 'color', 'rgba(25,26,31,.88)', 'Floating cards: legends, graph cards, pickers.', { field: 'popBg' }),
    surface('pop-bg-strong', 'color', 'rgba(25,26,31,.94)', 'Floating cards that must stay legible over busy content.', { field: 'popBgStrong' }),
    surface('scrim-bg', 'color', 'rgba(10,11,14,.6)', 'Veil behind command, quick and template overlays.', { field: 'scrimBg' }),
    surface('overlay-bg', 'color', 'rgba(10,11,14,.6)', 'Backdrop behind modals.', { field: 'overlayBg' }),
    surface('hover-bg', 'color', 'rgba(232,227,214,.05)', 'Hover tint on rows and buttons.', { field: 'hoverBg' }),
    surface('border', 'color', '#3A3E4A', 'The standard line between regions.', { field: 'border' }),
    surface('border-soft', 'color', '#282B34', 'A hairline one notch softer than border.', { field: 'borderSoft' }),
    surface('term-bg', 'color', '#101116', 'Terminal background (a dark panel in every theme).', { field: 'termBg' }),
    surface('color-scheme', 'scheme', 'dark', 'light or dark: the browser color-scheme and the light/dark branch of derived surfaces.', { field: 'isLight' }),
    surface('skeleton-ink', 'color', 'color-mix(in srgb, var(--faint) 22%, transparent)', 'Loading placeholder ink: the bars and blocks of a skeleton.'),
    surface('skeleton-ink-faint', 'color', 'color-mix(in srgb, var(--faint) 16%, transparent)', 'The quieter second step of placeholder ink, for a skeleton\'s secondary blocks.'),
]

const text = grp('text')
const TEXT: TokenDef[] = [
    text('fg', 'color', '#E8E3D6', 'Primary text.', { field: 'foreground' }),
    text('text-muted', 'color', '#9C998E', 'Secondary text and graph edges.', { field: 'neutral' }),
    text('faint', 'color', '#827F78', 'Tertiary and disabled text.', { field: 'faint' }),
    text('term-fg', 'color', '#C9C4B6', 'Terminal text.', { field: 'termFg' }),
    text('label-halo', 'color', '#15161A', 'Halo behind graph labels.', { field: 'labelHalo' }),
    text('on-accent', 'color', '#15161A', 'Text on a solid accent fill.', { field: 'onAccent' }),
    text('on-scrim', 'color', '#fff', 'Text over a photo scrim; white in every theme.', { field: 'onScrim' }),
]

const accent = grp('accent')
const ACCENT: TokenDef[] = [
    accent('accent', 'color', '#93BDB0', 'The one accent: focus, selection, links, primary buttons.', { field: 'accent' }),
    accent('accent-soft', 'color', 'rgba(147,189,176,0.12)', 'Accent tint behind a selected tab or row.', { field: 'accentSoft' }),
    accent('accent-purple', 'color', '#A190C4', 'Editor syntax and task accent; the graph ramp violet.'),
    accent('grad', 'gradient', 'linear-gradient(120deg, #C98CA8, #A190C4, #8296C6, #83B4AE, #A3BE8C, #CBB27E)', 'The iridescent gradient on the wordmark and hero marks.'),
    accent('selection', 'color', 'color-mix(in srgb, var(--accent) 38%, transparent)', 'Text selection highlight.'),
]

const graph = grp('graph')
const GRAPH: TokenDef[] = [
    graph('graph-0', 'color', '#C98CA8', 'Graph node ramp, slot 0 (rose).', { field: 'accentPalette', index: 0 }),
    graph('graph-1', 'color', '#A190C4', 'Graph node ramp, slot 1 (violet).', { field: 'accentPalette', index: 1 }),
    graph('graph-2', 'color', '#8296C6', 'Graph node ramp, slot 2 (blue).', { field: 'accentPalette', index: 2 }),
    graph('graph-3', 'color', '#83B4AE', 'Graph node ramp, slot 3 (teal).', { field: 'accentPalette', index: 3 }),
    graph('graph-4', 'color', '#A3BE8C', 'Graph node ramp, slot 4 (green).', { field: 'accentPalette', index: 4 }),
    graph('graph-bg', 'color', '#121317', 'Graph canvas ground.', { field: 'graphBg' }),
    graph('graph-edge', 'color', '#3C4048', 'Graph edges.', { field: 'graphEdge' }),
    graph('node-cold', 'color', '#4A4E58', 'Graph nodes with no hue: untagged and far.', { field: 'nodeCold' }),
    graph('node-self', 'color', '#E8E3D6', 'The open note in the local graph.', { field: 'nodeSelf' }),
    graph('vignette-edge', 'color', '#0D0E11', 'Graph depth vignette, at the edge.', { field: 'vignetteEdge' }),
    graph('map-sea', 'color', '#272A33', 'Bases offline map: water.'),
    graph('map-land', 'color', '#20222A', 'Bases offline map: land.'),
    graph('map-coast', 'color', 'color-mix(in srgb, #93BDB0 45%, #20222A)', 'Bases offline map: coastline.'),
    graph('map-grid', 'color', 'color-mix(in srgb, #E8E3D6 12%, transparent)', 'Bases offline map: graticule.'),
]

const category = grp('category')
const CATEGORY: TokenDef[] = [
    category('teal', 'color', '#83B4AE', 'Category hue: statuses, event categories, map pins, chart series.', { field: 'categoryTeal' }),
    category('blue', 'color', '#8296C6', 'Category hue: blue.', { field: 'categoryBlue' }),
    category('violet', 'color', '#A190C4', 'Category hue: violet.', { field: 'categoryViolet' }),
    category('green', 'color', '#A3BE8C', 'Category hue: green.', { field: 'categoryGreen' }),
    category('gold', 'color', '#CBB27E', 'Category hue: gold.', { field: 'categoryGold' }),
    category('rose', 'color', '#C98CA8', 'Category hue: rose.', { field: 'categoryRose' }),
]

const semantic = grp('semantic')
const SEMANTIC: TokenDef[] = [
    semantic('danger', 'color', '#C87F72', 'Destructive actions and errors.', { field: 'danger' }),
    semantic('success', 'color', '#A3BE8C', 'Success and done.', { field: 'success' }),
    semantic('warning', 'color', '#CBB27E', 'Caution.', { field: 'warning' }),
    semantic('warning-soft', 'color', 'color-mix(in srgb, #CBB27E 7%, transparent)', 'Faint caution tint behind a box that needs attention.'),
    semantic('warning-edge', 'color', 'color-mix(in srgb, #CBB27E 45%, transparent)', 'Caution tint for the outline of a box that needs attention.'),
]

const state = grp('state')
const STATE: TokenDef[] = [
    state('state-hover-bg', 'color', 'color-mix(in srgb, var(--fg) 8%, transparent)', 'Row or button under the pointer.'),
    state('state-active-bg', 'color', 'color-mix(in srgb, var(--fg) 14%, transparent)', 'Row or button being pressed: the one pressed fill for list rows and chips.'),
    state('state-selected-bg', 'color', 'var(--accent-soft)', 'Selected row or tab fill.'),
    state('state-selected-fg', 'color', 'var(--accent)', 'Selected row or tab text. (no consumer yet)'),
    state('state-focus-ring', 'shadow', 'inset 0 0 0 1px var(--accent)', 'Keyboard focus drawn inside a control. (no consumer yet)'),
    state('state-disabled-op', 'number', '0.45', 'The one sanctioned opacity-as-state: it dims the sidebar toolbar while the switcher is active (`shell/AppFrame.module.css`), a whole non-interactive region. The text of a disabled control is still `--faint` ink alone, because any opacity over `--faint` falls under the 3:1 UI floor. No other state is shown by opacity.'),
    state('focus-ring', 'border', '2px solid var(--accent)', 'Keyboard focus outline.'),
    state('focus-ring-offset', 'length', '1px', 'Gap between a control and its focus outline. (no consumer yet)'),
]

const effect = grp('effect')
const EFFECT: TokenDef[] = [
    effect('glow-accent', 'shadow', '0 0 0 1px rgba(147,189,176,0.14)', 'Accent bloom; only cathode really glows.', { field: 'glowAccent' }),
    effect('glow-text', 'shadow', 'none', 'Text bloom; only cathode uses it.', { field: 'glowText' }),
    effect('shadow-hard', 'color', 'rgba(0,0,0,.45)', 'The flat shadow colour that lift composites against.'),
    effect('lift', 'shadow', '2px 2px 0 var(--shadow-hard)', 'Hard-offset drop shadow under menus, popups and cards.'),
    effect('lift-start', 'shadow', '-2px 2px 0 var(--shadow-hard)', 'The mirror of lift for a panel on the right edge, so its depth cue falls inside the window.'),
    effect('hud-fps-good', 'color', '#3fb950', 'FPS meter: healthy frame rate. Theme-independent.'),
    effect('hud-fps-ok', 'color', '#d29922', 'FPS meter: borderline frame rate. Theme-independent.'),
    effect('hud-fps-bad', 'color', '#f85149', 'FPS meter: slow frame rate. Theme-independent.'),
    effect('field-noise-op', 'number', '.45', 'Opacity of the graph field texture.'),
    effect('intro-glyph-scale', 'number', '1.3333', "Largest scale the first-run intro's glyph art is drawn at. A 24-row art box over an 18-row scene is exactly 4/3; GlyphCanvas caps its fit here, then snaps down onto whole device pixels."),
    effect('z-local', 'number', '1', 'Stacking inside one component: a handle over its sibling.'),
    effect('z-overlay', 'number', '20', 'Pane overlays: the chat panel, the switcher, drop cues.'),
    effect('z-shell', 'number', '100', 'Shell chrome over the panes: the tab rail and the sidebar edge.'),
    effect('z-modal', 'number', '1000', 'The modal band: scrim and panel, shared with the drag ghost. A modal sits over the shell.'),
    effect('z-toast', 'number', '1050', 'Toasts: above a modal, because a notification must be seen, and below a popover, so a toast never covers an open menu.'),
    effect('z-popover', 'number', '1100', 'Popovers and menus: tops the stack, because a menu can open inside a modal and must sit over it.'),
]

const callout = grp('callout')
const CALLOUTS: TokenDef[] = [
    callout('callout-note', 'color', '#448aff', 'Callout [!note] accent. Theme-independent.'),
    callout('callout-tip', 'color', '#00bfa5', 'Callout [!tip] accent.'),
    callout('callout-success', 'color', '#21c065', 'Callout [!success] accent.'),
    callout('callout-question', 'color', '#e0a526', 'Callout [!question] accent.'),
    callout('callout-warning', 'color', '#ef8e2c', 'Callout [!warning] accent.'),
    callout('callout-failure', 'color', '#e5484d', 'Callout [!failure] accent.'),
    callout('callout-danger', 'color', '#e93147', 'Callout [!danger] accent.'),
    callout('callout-bug', 'color', '#e93147', 'Callout [!bug] accent.'),
    callout('callout-example', 'color', '#a371f7', 'Callout [!example] accent.'),
    callout('callout-quote', 'color', '#9aa0a6', 'Callout [!quote] accent.'),
    callout('callout-abstract', 'color', '#00b8d4', 'Callout [!abstract] accent.'),
    callout('callout-todo', 'color', '#448aff', 'Callout [!todo] accent.'),
    callout('callout-important', 'color', '#00b8d4', 'Callout [!important] accent.'),
]

const font = grp('font')
const FONT: TokenDef[] = [
    font('ui-font-stack', 'font-mono', 'Monaspace Xenon', 'UI + mono font family (all chrome, code, frontmatter, math, tags). Legacy: appearance.uiFont.', { setting: 'appearance.uiFont' }),
    font('prose-font', 'font-prose', 'Libron', 'Prose font family (note body, headings, tables, chat). Legacy: appearance.proseFont.', { setting: 'appearance.proseFont' }),
    font('prose-scale', 'number', '0.97', 'Size correction measured for the prose face, so prose reads at one optical size.'),
    font('mono-scale', 'number', '1', 'Optical-size factor for the mono font, 0.6 to 1. Legacy: appearance.monoScale.', { setting: 'appearance.monoScale' }),
    font('glyph-scale', 'number', '1.25', 'Size of glyph art relative to its cell.'),
    font('code-scale', 'number', '0.89', 'Mono text size relative to the prose around it.'),
]

const typeScale = grp('type-scale')
const TYPE_SCALE: TokenDef[] = [
    typeScale('fs-nano', 'length', '9.5px', 'Smallest text.'),
    typeScale('fs-micro', 'length', '10.5px', 'Fine print and captions.'),
    typeScale('fs-ui', 'length', '11.5px', 'Chrome text: tabs, menus, rows, 11 to 16px. Also scales the ASCII cell width. Legacy: appearance.uiFontSize.', { setting: 'appearance.uiFontSize' }),
    typeScale('fs-body', 'length', '13px', 'Dense body text.'),
    typeScale('fs-body-lg', 'length', '13.5px', 'Prose body text.'),
    typeScale('fs-lead', 'length', '15px', 'Lead paragraphs.'),
    typeScale('fs-title', 'length', '19px', 'Titles.'),
    typeScale('fs-display', 'length', '24px', 'Display headings.'),
    typeScale('fs-hero', 'length', '40px', 'Hero text.'),
    typeScale('fs-hero-xl', 'length', '48px', 'Largest hero text.'),
    typeScale('fs-wordmark-display', 'length', '96px', "The brand wordmark as a slide's whole picture (the first-run intro)."),
    typeScale('fs-h1', 'length', 'max(var(--fs-display), var(--editor-font-size))', 'Note heading 1.'),
    typeScale('fs-h2', 'length', 'max(var(--fs-title), var(--editor-font-size))', 'Note heading 2.'),
    typeScale('fs-h3', 'length', 'var(--editor-font-size)', 'Note heading 3.'),
    typeScale('fs-h4', 'length', 'var(--editor-font-size)', 'Note heading 4.'),
    typeScale('fs-h5', 'length', 'min(var(--fs-body), var(--editor-font-size))', 'Note heading 5.'),
    typeScale('fs-h6', 'length', 'min(var(--fs-body), var(--editor-font-size))', 'Note heading 6.'),
    typeScale('editor-font-size', 'length', '13.5px', 'Note prose size, 11 to 28px. Legacy: appearance.editorFontSize.', { setting: 'appearance.editorFontSize' }),
]

const weight = grp('weight')
const WEIGHT: TokenDef[] = [
    weight('fw-regular', 'number', '400', 'Regular weight.'),
    weight('fw-medium', 'number', '500', 'Medium weight.'),
    weight('fw-bold', 'number', '600', 'Bold weight.'),
    weight('fw-h1', 'number', 'var(--fw-bold)', 'Heading 1 weight.'),
    weight('fw-h2', 'number', 'var(--fw-bold)', 'Heading 2 weight.'),
    weight('fw-h3', 'number', 'var(--fw-bold)', 'Heading 3 weight.'),
    weight('fw-h4', 'number', 'var(--fw-medium)', 'Heading 4 weight.'),
    weight('fw-h5', 'number', 'var(--fw-medium)', 'Heading 5 weight.'),
    weight('fw-h6', 'number', 'var(--fw-medium)', 'Heading 6 weight.'),
]

const lineHeight = grp('line-height')
const LINE_HEIGHT: TokenDef[] = [
    lineHeight('lh-tight', 'number', '1.4', 'Tight line height.'),
    lineHeight('lh-ui', 'number', '1.7', 'Chrome line height.'),
    lineHeight('lh-prose', 'number', '1.6', 'Prose line height where the editor setting does not apply.'),
    lineHeight('lh-grid', 'number', '1', 'Character-grid line height; one cell tall.'),
    lineHeight('prose-line-height', 'number', '1.25', 'Note prose line height, 0.8 to 1.8. Legacy: editor.lineHeight.', { setting: 'editor.lineHeight' }),
]

const tracking = grp('tracking')
const TRACKING: TokenDef[] = [
    tracking('ls-eyebrow', 'length', '.14em', 'Letter spacing of eyebrow labels.'),
    tracking('ls-label', 'length', '.06em', 'Letter spacing of small labels.'),
    tracking('ls-display', 'length', '-.01em', 'Letter spacing of display text.'),
]

const spacing = grp('spacing')
const SPACING: TokenDef[] = [
    spacing('sp-1', 'length', '2px', 'Spacing step 1.'),
    spacing('sp-2', 'length', '4px', 'Spacing step 2.'),
    spacing('sp-3', 'length', '6px', 'Spacing step 3.'),
    spacing('sp-4', 'length', '8px', 'Spacing step 4.'),
    spacing('sp-5', 'length', '12px', 'Spacing step 5.'),
    spacing('sp-6', 'length', '16px', 'Spacing step 6.'),
    spacing('sp-7', 'length', '24px', 'Spacing step 7.'),
    spacing('optical-nudge', 'length', '1px', 'One-pixel nudge that centres glyphs optically.'),
    spacing('bar-icon-gap', 'length', 'var(--sp-4)', 'Gap between icons in a view bar.'),
    spacing('bar-crumb-gap', 'length', 'var(--sp-5)', 'Gap between breadcrumbs in a view bar.'),
]

const size = grp('size')
const SIZE: TokenDef[] = [
    size('row-h', 'length', '18px', 'The app row unit: tree rows, tabs, prose lines land on it.'),
    size('h-row', 'length', '18px', 'Height of a list row.'),
    size('h-control', 'length', '24px', 'Height of a button or field.'),
    size('h-band', 'length', '36px', 'Height of a header band.'),
    size('inset-traffic-lights', 'length', '78px', 'Start inset of a band that clears the macOS traffic lights (Band inset).'),
    size('note-column', 'length', '620px', 'Reading width of a note.'),
    size('note-gutter', 'length', '40px', 'Side padding of a note: the editor content inset that the title, frontmatter and chat transcript line up with.'),
    size('chat-column', 'length', '680px', 'Reading width of a chat transcript and its composer.'),
    size('daemon-list-max', 'length', '100ch', 'Widest an opened daemon section list (crons, services, inbox, log) grows, so all four end at one x.'),
    size('view-gutter', 'length', 'var(--sp-5)', 'Side gutter of a Bases view body; matches the view bar.'),
    size('rail-w-collapsed', 'length', '46px', 'Width of the tab rail when collapsed.'),
    size('skeleton-bar-h', 'length', 'var(--sp-5)', 'Height of one placeholder bar in a skeleton.'),
    size('list-max-h', 'length', '320px', 'Tallest a dropdown list grows before scrolling.'),
    size('icon', 'length', '12px', 'Size of every icon, 11 to 20px. Legacy: appearance.iconSize.', { setting: 'appearance.iconSize' }),
    size('bar-icon-size', 'length', '18px', 'Size of icons in a view bar.'),
    size('ascii-dash-pitch', 'number', '2', 'Cells between dashes of an ASCII dashed line.'),
]

const radius = grp('radius')
const RADIUS: TokenDef[] = [
    radius('r-0', 'length', '0', 'Square corners.'),
    radius('r-mark', 'length', '1px', 'Marks and ticks.'),
    radius('r-chip', 'length', '2px', 'Chips and badges.'),
    radius('r-control', 'length', '3px', 'Buttons and fields.'),
    radius('r-card', 'length', '4px', 'Cards.'),
    radius('r-panel', 'length', '5px', 'Panels.'),
    radius('r-dot', 'length', '50%', 'Status dots, colour dots, pager dots.'),
]

const rule = grp('rule')
const RULE: TokenDef[] = [
    rule('rule', 'border', '1px solid var(--border)', 'The standard line.'),
    rule('rule-soft', 'border', '1px solid var(--border-soft)', 'A hairline.'),
    rule('rule-accent', 'border', '1px solid var(--accent)', 'An accent line. (no consumer yet)'),
    rule('rule-dashed', 'border', '1px dashed var(--border)', 'A dashed line. Dashed edges read this, or rule-drop for a drop cue, never a hand-written 1.5px dashed.'),
    rule('rule-drop', 'border', '1.5px dashed var(--accent)', 'The outline of a place that takes the drop.'),
    rule('rule-soft-dashed', 'border', '1px dashed var(--border-soft)', 'A dashed hairline.'),
    rule('accent-edge', 'border', '2px solid var(--accent)', 'The accent bar on the edge of a selected block.'),
]

const motion = grp('motion')
const MOTION: TokenDef[] = [
    motion('motion-scale', 'number', '1', 'Multiplies every CSS transition and animation duration; 0 turns CSS motion off. Not scaled: cursor-blink, cursor-glide and the graph renderer\'s own morph timings.'),
    motion('dur-fast', 'duration', 'calc(80ms * var(--motion-scale))', 'Fast transitions: hover, press.'),
    motion('dur', 'duration', 'calc(120ms * var(--motion-scale))', 'Standard transitions.'),
    motion('dur-grow', 'duration', 'calc(140ms * var(--motion-scale))', 'A surface growing into another: a daemon-page box opening to fill the page.'),
    motion('dur-pop', 'duration', 'calc(260ms * var(--motion-scale))', 'Popovers and larger movements.'),
    motion('ease', 'easing', 'cubic-bezier(0.22, 1, 0.36, 1)', 'The standard ease-out.'),
    motion('ease-spring', 'easing', 'cubic-bezier(0.34, 1.56, 0.64, 1)', 'A small overshoot.'),
    motion('ease-std', 'easing', 'ease', 'The browser ease curve many components use.'),
    motion('sheen', 'duration', 'calc(8s * var(--motion-scale))', 'Cycle of the idle sheen sweep.'),
]

const popover = grp('popover')
const POPOVER: TokenDef[] = [
    popover('popover-radius', 'length', 'var(--r-0)', 'Corner radius of menus and popovers.'),
    popover('popover-pad', 'length', '4px', 'Padding inside a popover.'),
    popover('popover-row-pad-y', 'length', '0px', 'Vertical padding of a popover row.'),
    popover('popover-row-pad-x', 'length', '8px', 'Horizontal padding of a popover row.'),
    popover('popover-row-radius', 'length', '0', 'Corner radius of a popover row.'),
    popover('popover-row-gap', 'length', 'var(--sp-4)', 'Gap between parts of a popover row.'),
    popover('popover-font-size', 'length', 'var(--fs-ui)', 'Popover text size.'),
    popover('popover-min-width', 'length', '170px', 'Narrowest a popover gets.'),
    popover('popover-selected-bg', 'color', 'var(--state-selected-bg)', 'Fill of the selected popover row.'),
    popover('popover-detail-opacity', 'number', '0.5', 'Opacity of the secondary text in a popover row.'),
    popover('popover-shadow', 'shadow', 'var(--lift)', 'Shadow under a popover.'),
]

const cursor = grp('cursor')
const CURSOR: TokenDef[] = [
    cursor('cursor-width', 'length', '2px', 'Text cursor bar width, 1 to 4px. Legacy: appearance.cursorWidth.', { setting: 'appearance.cursorWidth' }),
    cursor('cursor-glide', 'duration', '70ms', 'Cursor glide between positions, 20 to 200ms. Legacy: appearance.cursorGlideMs.', { setting: 'appearance.cursorGlideMs' }),
    cursor('cursor-blink', 'duration', '1.2s', 'Cursor blink cycle, 0.6 to 2s. Legacy: appearance.cursorBlinkSeconds.', { setting: 'appearance.cursorBlinkSeconds' }),
]

/** Every token, grouped in TOKEN_GROUPS order. */
export const DESIGN_TOKENS: readonly TokenDef[] = [
    ...SURFACE,
    ...TEXT,
    ...ACCENT,
    ...GRAPH,
    ...CATEGORY,
    ...SEMANTIC,
    ...STATE,
    ...EFFECT,
    ...CALLOUTS,
    ...FONT,
    ...TYPE_SCALE,
    ...WEIGHT,
    ...LINE_HEIGHT,
    ...TRACKING,
    ...SPACING,
    ...SIZE,
    ...RADIUS,
    ...RULE,
    ...MOTION,
    ...POPOVER,
    ...CURSOR,
]

const BY_KEY: ReadonlyMap<string, TokenDef> = new Map(
    DESIGN_TOKENS.map(d => [d.key, d]),
)

/** The def for a key, or undefined. A Map lookup, so 'constructor' / '__proto__' are just unknown. */
export function tokenDef(key: string): TokenDef | undefined {
    return BY_KEY.get(key)
}

export type TokenMap = Record<string, string> // key → normalized value
export type TokenCheck =
    | { ok: true; value: string }
    | { ok: false; problem: string }

// ── value checks ────────────────────────────────────────────────────────────────────────────

/** Anything that could break out of a declaration, open a url fetch, or comment. */
const REJECT = /[;{}<>"'\\!@]|\/\*|url\s*\(|\bexpression\b/i

const NUM = String.raw`-?(?:\d+\.?\d*|\.\d+)`
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const COLOR_ARG = String.raw`${NUM}(?:%|deg)?`
const COLOR_FN = new RegExp(
    String.raw`^(rgb|rgba|hsl|hsla)\(\s*(${COLOR_ARG}(?:(?:\s*,\s*|\s+)${COLOR_ARG}){2,3}(?:\s*\/\s*${COLOR_ARG})?)\s*\)$`,
    'i',
)
const LENGTH = new RegExp(String.raw`^${NUM}(?:px|rem|em|%|ch|vh|vw)$`)
const DURATION = /^(?:\d+\.?\d*|\.\d+)(?:ms|s)$/
const NUMERIC = new RegExp(`^${NUM}$`)
const EASING_WORDS = [
    'linear',
    'ease',
    'ease-in',
    'ease-out',
    'ease-in-out',
    'step-start',
    'step-end',
]
const BORDER_STYLES = ['solid', 'dashed', 'dotted', 'double']
const GRADIENT_WORDS = [
    'to',
    'at',
    'top',
    'bottom',
    'left',
    'right',
    'center',
    'circle',
    'ellipse',
    'closest-side',
    'farthest-side',
    'closest-corner',
    'farthest-corner',
    'in',
    'srgb',
]

const norm = (s: string) => s.trim().replace(/\s+/g, ' ')

/** Split on `sep` outside parentheses. */
function splitTop(s: string, sep: RegExp | string): string[] {
    const out: string[] = []
    let depth = 0
    let cur = ''
    for (let i = 0; i < s.length; i++) {
        const c = s[i]
        if (c === '(') depth++
        else if (c === ')') depth--
        const isSep =
            depth === 0 &&
            (typeof sep === 'string' ? c === sep : sep.test(c))
        if (isSep) {
            out.push(cur)
            cur = ''
        } else cur += c
    }
    out.push(cur)
    return out.map(p => p.trim()).filter(p => p.length > 0)
}

function balanced(s: string): boolean {
    let depth = 0
    for (const c of s) {
        if (c === '(') depth++
        else if (c === ')' && --depth < 0) return false
    }
    return depth === 0
}

/** `var(--key)` naming a registered token → the key, else undefined. */
function varRef(s: string, accept: readonly TokenKind[]): string | undefined {
    const m = /^var\(\s*--([a-z0-9-]+)\s*\)$/.exec(s)
    if (!m) return undefined
    const def = BY_KEY.get(m[1])
    return def && accept.includes(def.kind) ? m[1] : undefined
}

const COLOR_ONLY: readonly TokenKind[] = ['color']

/** The kinds a `var(--x)` may name inside a value of this kind. */
const REF_KINDS: Partial<Record<TokenKind, readonly TokenKind[]>> = {
    color: ['color'],
    length: ['length'],
    number: ['number'],
    duration: ['duration'],
    easing: ['easing'],
    shadow: ['shadow', 'color'],
    border: ['border', 'length', 'color'],
    gradient: ['color'],
}

/** A value that names its own token anywhere in a `var(--key)`. */
function refersToSelf(s: string, key: string): boolean {
    for (const m of s.matchAll(/var\(\s*--([a-z0-9-]+)\s*[,)]/g)) if (m[1] === key) return true
    return false
}

/** Plain colours only: what a JS consumer can parse. */
function isPlainColor(s: string): boolean {
    if (s === 'transparent' || HEX.test(s)) return true
    const m = COLOR_FN.exec(s)
    if (!m) return false
    const n = m[2].split(/[,\s/]+/).filter(Boolean).length
    return n === 3 || n === 4
}

/** A colour item inside a formula: plain, or a registered var. */
const isColorItem = (s: string) => isPlainColor(s) || varRef(s, COLOR_ONLY) !== undefined

/** `color-mix(in srgb, <color> <p>%, <color>)` — CSS-only tokens, never read by JS. */
function isColorMix(s: string): boolean {
    const m = /^color-mix\((.*)\)$/s.exec(s)
    if (!m) return false
    const parts = splitTop(m[1], ',')
    if (parts.length !== 3 || !/^in\s+srgb$/.test(parts[0])) return false
    const first = splitTop(parts[1], /\s/)
    if (first.length !== 2 || !/^\d+\.?\d*%$/.test(first[1])) return false
    return isColorItem(first[0]) && isColorItem(parts[2])
}

/** True when `flat` (numbers and registered vars already collapsed to the operand `0`) is ONE
 *  well-formed math call: operands joined by exactly one operator, balanced groups, a legal
 *  argument count per function, nothing before or after. Catches `calc(1 var(--a))` (two operands,
 *  no operator), `calc(1 +)`, `min()`, `clamp(1, 2)`, and stray text. */
function isWellFormedMath(flat: string): boolean {
    const text = flat.trim()
    const toks: string[] = []
    const re = /\s*(calc|min|max|clamp|0|[+\-*/(),])/y
    let at = 0
    while (at < text.length) {
        re.lastIndex = at
        const m = re.exec(text)
        if (!m) return false // text no token covers: a stray word, a unit that is not allowed
        toks.push(m[1])
        at = re.lastIndex
    }
    return runParse(toks)
}

function runParse(toks: string[]): boolean {
    let i = 0
    const FN_ARGS: Record<string, [number, number]> = {
        calc: [1, 1],
        min: [1, Infinity],
        max: [1, Infinity],
        clamp: [3, 3],
    }
    // expr := term (('+' | '-') term)* ; term := factor (('*' | '/') factor)*
    const expr = (): boolean => {
        if (!term()) return false
        while (toks[i] === '+' || toks[i] === '-') {
            i++
            if (!term()) return false
        }
        return true
    }
    const term = (): boolean => {
        if (!factor()) return false
        while (toks[i] === '*' || toks[i] === '/') {
            i++
            if (!factor()) return false
        }
        return true
    }
    // factor := '0' | '(' expr ')' | fn '(' expr (',' expr)* ')'
    const factor = (): boolean => {
        const t = toks[i]
        if (t === '0') {
            i++
            return true
        }
        if (t === '(') {
            i++
            if (!expr() || toks[i] !== ')') return false
            i++
            return true
        }
        const range = t === undefined ? undefined : FN_ARGS[t]
        if (!range || toks[i + 1] !== '(') return false
        i += 2
        let args = 0
        for (;;) {
            if (!expr()) return false
            args++
            if (toks[i] !== ',') break
            i++
        }
        if (toks[i] !== ')' || args < range[0] || args > range[1]) return false
        i++
        return true
    }
    // the whole value is exactly one math call
    return FN_ARGS[toks[0] ?? ''] !== undefined && factor() && i === toks.length
}

/** `calc|min|max|clamp(...)` over numbers with `units`, and registered vars. Checks the operands
 *  and units first, then that the formula is structurally well formed. */
function isMath(s: string, unit: string, accept: readonly TokenKind[]): boolean {
    if (!/^(?:calc|min|max|clamp)\(/.test(s) || !balanced(s)) return false
    let ok = true
    const flat = s
        .replace(/var\(\s*--([a-z0-9-]+)\s*\)/g, (_, k: string) => {
            const d = BY_KEY.get(k)
            if (!d || !accept.includes(d.kind)) ok = false
            return ' 0 '
        })
        .replace(new RegExp(`${NUM}(?:${unit})?`, 'g'), ' 0 ')
    return ok && isWellFormedMath(flat)
}

function isLengthLiteral(s: string): boolean {
    return s === '0' || LENGTH.test(s)
}

function checkShadowLayer(layer: string): boolean {
    let colours = 0
    let lengths = 0
    for (const tok of splitTop(layer, /\s/)) {
        if (tok === 'inset') continue
        if (isLengthLiteral(tok)) lengths++
        else if (isPlainColor(tok) || varRef(tok, COLOR_ONLY)) colours++
        else return false
    }
    return colours === 1 && lengths >= 2 && lengths <= 4
}

function checkGradient(s: string): boolean {
    const m = /^(?:linear|radial)-gradient\((.*)\)$/s.exec(s)
    if (!m || !balanced(s)) return false
    const parts = splitTop(m[1], ',')
    if (parts.length < 2) return false
    return parts.every(part =>
        splitTop(part, /\s/).every(
            tok =>
                isPlainColor(tok) ||
                varRef(tok, COLOR_ONLY) !== undefined ||
                GRADIENT_WORDS.includes(tok) ||
                new RegExp(`^${NUM}(?:deg|%|px|rem|em|turn|rad)?$`).test(tok),
        ),
    )
}

function checkEasing(s: string): boolean {
    if (EASING_WORDS.includes(s)) return true
    const m = /^cubic-bezier\(([^()]*)\)$/.exec(s)
    if (!m) return false
    const p = m[1].split(',').map(x => x.trim())
    if (p.length !== 4 || !p.every(x => NUMERIC.test(x))) return false
    const [x1, , x2] = [Number(p[0]), 0, Number(p[2])]
    return x1 >= 0 && x1 <= 1 && x2 >= 0 && x2 <= 1
}

const KIND_WORDS: Record<TokenKind, string> = {
    color: 'a color: #rrggbb, rgba(0, 0, 0, 0.5), or transparent',
    length: 'a length: 6px, 0.5em, or a number of px',
    number: 'a number: 1.5',
    duration: 'a duration: 120ms, 0.2s, or a number of ms',
    easing: 'an easing: ease, linear, or cubic-bezier(0.2, 0, 0, 1)',
    shadow: 'a shadow: none, or 2px 2px 0 rgba(0, 0, 0, 0.4)',
    border: 'a border: 1px solid #3a3e4a',
    gradient: 'a gradient: linear-gradient(120deg, #c98ca8, #8296c6)',
    'font-mono': `a mono font: ${MONO_FONTS.join(', ')}`,
    'font-prose': `a prose font: ${PROSE_FONTS.join(', ')}`,
    scheme: 'a color scheme: light or dark',
}

/** What a kind accepts, for error messages: `a length: 6px, 0.5em, or a number of px`. */
export function describeKind(kind: TokenKind): string {
    return KIND_WORDS[kind]
}

function fail(kind: TokenKind, raw: unknown): TokenCheck {
    const text = typeof raw === 'string' ? raw : JSON.stringify(raw) ?? String(raw)
    const shown = text.length > 80 ? `${text.slice(0, 80)}…` : text
    const d = describeKind(kind)
    const at = d.indexOf(': ')
    return {
        ok: false,
        problem: `not ${d.slice(0, at)}: ${shown} (${d.slice(at + 2)})`,
    }
}

/** Check one value against a token's kind. Numbers are accepted where noted and normalized to a
 *  string. A colour on a FIELD token (one JS reads through ColorTokens) must be a plain colour;
 *  CSS-only colour tokens may also be `var(--registered)` or a `color-mix` formula. */
export function checkTokenValue(def: TokenDef, raw: unknown): TokenCheck {
    const kind = def.kind
    const bad = () => fail(kind, raw)
    const ok = (value: string): TokenCheck => ({ ok: true, value })
    if (typeof raw !== 'string' && typeof raw !== 'number') return bad()
    if (typeof raw === 'number' && !Number.isFinite(raw)) return bad()
    const s = typeof raw === 'string' ? norm(raw) : String(raw)
    if (REJECT.test(s)) return bad()
    if (typeof raw === 'string' && refersToSelf(s, def.key)) {
        const shown = s.length > 80 ? `${s.slice(0, 80)}…` : s
        return { ok: false, problem: `refers to itself: ${shown}` }
    }
    const ref = varRef(s, REF_KINDS[kind] ?? [])
    switch (kind) {
        case 'color':
            if (typeof raw !== 'string') return bad()
            if (isPlainColor(s)) return ok(s)
            if (!def.field && (ref || isColorMix(s))) return ok(s)
            return bad()
        case 'length':
            if (typeof raw === 'number') return ok(`${raw}px`)
            return isLengthLiteral(s) || ref || isMath(s, 'px|rem|em|%|ch|vh|vw', ['length', 'number'])
                ? ok(s)
                : bad()
        case 'number':
            if (typeof raw === 'number') return ok(String(raw))
            if (NUMERIC.test(s)) return ok(String(Number(s)))
            return ref ? ok(s) : bad()
        case 'duration':
            if (typeof raw === 'number') return ok(`${raw}ms`)
            return DURATION.test(s) || ref || isMath(s, 'ms|s', ['duration', 'number']) ? ok(s) : bad()
        case 'easing':
            if (typeof raw !== 'string') return bad()
            return checkEasing(s) || ref ? ok(s) : bad()
        case 'shadow':
            if (typeof raw !== 'string') return bad()
            if (s === 'none' || ref) return ok(s)
            return splitTop(s, ',').every(checkShadowLayer) ? ok(s) : bad()
        case 'border': {
            if (typeof raw !== 'string') return bad()
            if (s === 'none' || ref) return ok(s)
            const p = splitTop(s, /\s/)
            return p.length === 3 &&
                isLengthLiteral(p[0]) &&
                BORDER_STYLES.includes(p[1]) &&
                (isPlainColor(p[2]) || varRef(p[2], COLOR_ONLY))
                ? ok(s)
                : bad()
        }
        case 'gradient':
            if (typeof raw !== 'string') return bad()
            return checkGradient(s) ? ok(s) : bad()
        case 'font-mono':
            return typeof raw === 'string' && MONO_FONTS.includes(raw)
                ? ok(raw)
                : bad()
        case 'font-prose':
            return typeof raw === 'string' && PROSE_FONTS.includes(raw)
                ? ok(raw)
                : bad()
        case 'scheme':
            return s === 'light' || s === 'dark' ? ok(s) : bad()
    }
}

// ── maps ────────────────────────────────────────────────────────────────────────────────────

export type TokenDiagnostic = {
    key: string
    severity: 'error' | 'warning'
    message: string
}

function editDistance(a: string, b: string): number {
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
    for (let i = 1; i <= a.length; i++) {
        const cur = [i]
        for (let j = 1; j <= b.length; j++)
            cur[j] = Math.min(
                prev[j] + 1,
                cur[j - 1] + 1,
                prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
            )
        prev = cur
    }
    return prev[b.length]
}

/** The registered token nearest to a misspelt `key` (edit distance under 3), or undefined. */
export function suggestTokenKey(key: string): string | undefined {
    let best: string | undefined
    let bestD = 3
    for (const d of DESIGN_TOKENS) {
        const dist = editDistance(key, d.key)
        if (dist < bestD) {
            best = d.key
            bestD = dist
        }
    }
    return best
}

/** Validate a raw `tokens:` map (from `.settings` or a theme file). Unknown keys warn and are
 *  dropped; a bad value is an error and the key is dropped. Keys are case-sensitive. */
export function parseTokenMap(raw: unknown): {
    tokens: TokenMap
    diagnostics: TokenDiagnostic[]
} {
    const tokens: TokenMap = {}
    const diagnostics: TokenDiagnostic[] = []
    if (raw === undefined || raw === null) return { tokens, diagnostics }
    if (typeof raw !== 'object' || Array.isArray(raw)) {
        diagnostics.push({
            key: '',
            severity: 'error',
            message: 'tokens must be a map of token: value',
        })
        return { tokens, diagnostics }
    }
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        const def = tokenDef(key)
        if (!def) {
            const hint = suggestTokenKey(key)
            diagnostics.push({
                key,
                severity: 'warning',
                message: `${key}: unknown token, ignored${hint ? ` (did you mean ${hint}?)` : ''}`,
            })
            continue
        }
        const r = checkTokenValue(def, value)
        if (r.ok) tokens[key] = r.value
        else
            diagnostics.push({
                key,
                severity: 'error',
                message: `${key}: ${r.problem}`,
            })
    }
    return { tokens, diagnostics }
}

/** The tokens that are NOT read through ColorTokens: what gets projected straight onto `:root`. */
export function nonFieldTokens(tokens: TokenMap): TokenMap {
    const out: TokenMap = {}
    for (const [k, v] of Object.entries(tokens))
        if (!tokenDef(k)?.field) out[k] = v
    return out
}

/** `base` with the field tokens in `tokens` written on top. A NEW object; `base` and its
 *  `accentPalette` are never mutated. Non-field keys are ignored. */
export function applyColorTokens(
    base: ColorTokens,
    tokens: TokenMap,
): ColorTokens {
    const out: ColorTokens = { ...base, accentPalette: [...base.accentPalette] }
    for (const [key, value] of Object.entries(tokens)) {
        const def = tokenDef(key)
        if (!def?.field) continue
        const r = checkTokenValue(def, value)
        if (!r.ok) continue
        if (def.field === 'accentPalette') {
            if (def.index !== undefined) out.accentPalette[def.index] = r.value
        } else if (def.field === 'isLight') out.isLight = r.value === 'light'
        else (out as unknown as Record<string, string>)[def.field] = r.value
    }
    return out
}

// ── legacy .settings aliases ────────────────────────────────────────────────────────────────

/** Schema bounds of each legacy path (written in the defs' docs too) and the unit its number takes. */
const LEGACY_NUMBERS: Record<string, { min: number; max: number; unit: string }> = {
    'editor-font-size': { min: 11, max: 28, unit: 'px' },
    'fs-ui': { min: 11, max: 16, unit: 'px' },
    icon: { min: 11, max: 20, unit: 'px' },
    'mono-scale': { min: 0.6, max: 1, unit: '' },
    'cursor-width': { min: 1, max: 4, unit: 'px' },
    'cursor-glide': { min: 20, max: 200, unit: 'ms' },
    'cursor-blink': { min: 0.6, max: 2, unit: 's' },
    'prose-line-height': { min: 0.8, max: 1.8, unit: '' },
}

function at(doc: unknown, path: string): unknown {
    let cur = doc
    for (const part of path.split('.')) {
        if (cur === null || typeof cur !== 'object') return undefined
        if (!Object.hasOwn(cur, part)) return undefined
        cur = (cur as Record<string, unknown>)[part]
    }
    return cur
}

/** The legacy appearance/editor settings in a parsed `.settings` document, as token values.
 *  A key absent, invalid, or outside the schema's min/max is skipped. Font tokens carry the family
 *  NAME; the app turns it into a stack. */
export function legacyTokens(settingsDoc: Record<string, unknown>): TokenMap {
    const out: TokenMap = {}
    for (const def of DESIGN_TOKENS) {
        if (!def.setting) continue
        const v = at(settingsDoc, def.setting)
        const b = LEGACY_NUMBERS[def.key]
        let candidate: unknown = v
        if (b) {
            if (typeof v !== 'number' || !Number.isFinite(v)) continue
            if (v < b.min || v > b.max) continue
            candidate = `${v}${b.unit}`
        }
        const r = checkTokenValue(def, candidate)
        if (r.ok) out[def.key] = r.value
    }
    return out
}

// ── what is NOT registered ──────────────────────────────────────────────────────────────────

/** `:root` custom properties that are deliberately not tokens, each with why. A trailing `*` is a
 *  prefix. app/src/tokenRegistry.test.ts requires every `:root` var to be a token or listed here. */
export const UNREGISTERED_ROOT_VARS: Readonly<Record<string, string>> = {
    '--cell-w': 'font metric: the mono advance width, derived from --fs-ui (6.3px at 11.5px), must track the font',
    '--cell-w-dense': 'font metric: the advance width at 7px, must track the font',
    '--cell-h-dense': 'font metric: the dense line-box height, must track the font',
    '--cell-h': 'constraint formula: always equals --row-h; set the row unit instead',
    '--label-col': 'constraint formula: 20 cells wide; set the cell metric instead',
    '--prose-font-size': 'constraint formula: editor size times the prose scale; set those instead',
    '--code-font-size': 'constraint formula: prose size times code scale times mono scale; set those instead',
    '--fs-rel-code': 'constraint formula: 1em times code scale times mono scale; set those instead',
    '--sidebar-width': 'layout preference: .settings (appearance.sidebarWidth) owns it, and a theme would fight the drag',
    '--sidebar-graph-height': 'layout preference: .settings (appearance.sidebarGraphHeight) owns it',
    '--tab-rail-width': 'layout preference: .settings (appearance.tabRailWidth) owns it, set by dragging',
    '--palette-top-offset': 'layout preference: .settings (ui.paletteTopOffset) owns it',
    '--pane-divider-width': 'layout preference: .settings (ui.paneDividerWidth) owns it',
    '--month-cell-min-h': 'layout preference: .settings (calendar.monthCellMinHeight) owns it',
    '--time-gutter-width': 'layout preference: .settings (calendar.timeGutterWidth) owns it',
    '--card-grid-min': 'layout preference: .settings (ui.cardGridMinWidth) owns it',
    '--kanban-col-min': 'layout preference: .settings (ui.kanbanColumnMinWidth) owns it',
    '--kanban-col-max': 'layout preference: .settings (ui.kanbanColumnMaxWidth) owns it',
    '--map-min-height': 'layout preference: .settings (ui.mapMinHeight) owns it',
    '--popover-font': 'alias of --ui-font-stack: a font stack is set through the font token, not per surface',
}

/** Groups of things that are NOT tokens, with where they live and why. Rendered into
 *  docs/settings/tokens.md under "What is not a token". */
export const NOT_TOKENS: readonly { group: string; where: string; reason: string }[] = [
    {
        group: 'ASCII glyph choices',
        where: 'app/src/ui/ascii/ (glyph tables and tiles)',
        reason: 'which character draws a rule, corner or marker is the product identity, not a design choice to override',
    },
    {
        group: 'Graph-renderer tuning constants',
        where: 'app/src/graph/AsciiGraphRenderer.ts, asciiGrid.ts, lod.ts',
        reason: 'alphas, the zoom ladder and level-of-detail thresholds are algorithm tuning; changing one changes how the graph reads, not how it is themed',
    },
    {
        group: 'Component geometry',
        where: 'app/src/**/*.module.css',
        reason: 'widths, heights, z-index and component-local --x props belong to one component and are not shared design choices',
    },
    {
        group: 'color-mix percentages',
        where: 'app/src/**/*.module.css, app/src/global.css',
        reason: 'the percentage in a tint is part of the formula that makes the tint; override the colours it mixes instead',
    },
    {
        group: 'Terminal glyph-fallback font list',
        where: 'app/src/Terminal.tsx',
        reason: 'the Nerd Font fallback list is what terminal programs expect to find; the sixteen ANSI colours are NOT listed here because they are derived from tokens (--rail, --danger, --fg and the rest), so a token edit already moves the terminal',
    },
    {
        group: 'Export and drawing palettes',
        where: 'app/src/export/, core/src/drawing/',
        reason: 'exported files and drawings are theme-independent so they look the same wherever they are opened',
    },
    {
        group: 'Google event colours',
        where: 'core/src/gcal/colors.ts',
        reason: 'Google defines these; they are data from another system',
    },
    {
        group: 'Chat tab colour swatches',
        where: 'app/src/chatColors.ts',
        reason: 'per-chat identity colours chosen by the person, stored as data',
    },
    {
        group: 'Univer sheet theme variables',
        where: 'app/src/global.css (--univer-* on .bismuth-sheet, not :root)',
        reason: 'Univer\'s own --univer-* vars are scoped to the sheet and already derived from tokens (--accent and friends) in CSS, so a token edit reaches the sheet without a token of their own',
    },
    {
        group: 'Graph hub-label pill colours',
        where: 'app/src/GraphView.tsx (labelTextColor, labelBgColor)',
        reason: 'the translucent rgba pill behind graph hub labels is chosen per light or dark theme as a legibility pair over the graph canvas, not a themed colour; label text on light themes does follow --fg',
    },
    {
        group: 'PDF page constants',
        where: 'core/src/theme/tokens.ts (PDF_PAGE_PAPER, PDF_PAGE_RULE, PDF_HIGHLIGHT_YELLOW)',
        reason: 'a PDF page is white paper and a highlight is highlighter yellow in every theme; the margin and highlight fill must match that fixed page, not a theme surface',
    },
    {
        group: 'Font metrics',
        where: 'app/src/global.css (--cell-w, --cell-w-dense, --cell-h-dense)',
        reason: 'they must equal the font\'s own advance width and line box, so they follow the font and are never a free choice',
    },
    {
        group: 'Layout preferences',
        where: '.settings (appearance.sidebarWidth, sidebarGraphHeight, tabRailWidth; ui.* widths; calendar.* sizes)',
        reason: 'per-person layout already owned by .settings; a theme setting a drag width would fight the drag',
    },
]
