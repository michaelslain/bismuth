// core/src/schema/settingsSchema.ts
// The fixed, documented schema for the vault `settings.yaml` file. Every key
// mirrors a current app setting (app/src/settings.ts DEFAULTS) plus its old
// SettingsPage slider bounds, so the first-launch writer can author a fully
// commented file and the same engine validates it. DEFAULTS is the plain nested
// object the frontend store seeds from synchronously (no white-screen on boot).
import type { Schema, SchemaEntry, PropertyType } from './types'
import { COMMAND_IDS } from '../commands'
import { KEYBINDING_CATALOG } from '../keybindings'
import { SIDEBAR_SECTIONS } from '../shellLayout'
import {
    DEFAULT_STATUS_BAR,
    STATUS_BUILTINS,
    STATUS_QUERY_SOURCES,
    STATUS_TONES,
} from '../statusBarItems'
import {
    CATEGORY_SWATCHES,
    THEME_NAMES as THEME_NAME_TUPLE,
} from '../theme/tokens'
import { MONO_FONTS, PROSE_FONTS } from '../theme/fontFamilies'
import { DESIGN_TOKENS } from '../theme/designTokens'
import {
    BACKEND_IDS,
    BACKEND_LIST,
    AUTO_ORDER,
    AUTO_PROVIDER,
    DEFAULT_BACKEND,
} from '../agentBackends/catalog'

// Which backends can run a vault's daemon brain at all — derived from the catalog (today: just
// "claude" and "codex"), so this enum never drifts from BackendCapabilities.daemon. Note this is
// NOT the security gate: resolveDaemonBackend (daemon/src/daemon/session.ts) still refuses any
// non-Claude backend for a vault with hidden notes regardless of what's picked here — this enum
// only bounds the settings UI to backends that HAVE a daemon implementation at all.
const DAEMON_BACKEND_IDS = BACKEND_LIST.filter(b => b.capabilities.daemon).map(
    b => b.id,
)

// The theme enum is sourced directly from the color source of truth
// (core/src/theme/tokens.ts) — no hand-maintained copy to drift from THEMES.
const THEME_NAMES = [...THEME_NAME_TUPLE]
const ICON_NAMES = [
    'hopper-crystal',
    'node-b',
    'square-funnel',
    'nested-diamonds',
    'pinwheel',
    'node-crystal',
    'lattice',
    'diamond-bloom',
    'node-diamond',
    'octagon-bloom',
    'spin-cross',
    'tri-bloom',
    'radial-graph',
    'node-rings',
]
// CALENDAR_VIEWS must stay in sync with `ViewType` in app/src/calendar/types.ts
// (currently 'month' | 'week' | '3day' | 'day'). If ViewType changes, update here.
const CALENDAR_VIEWS = ['month', 'week', '3day', 'day']
// The chat-provider enum is sourced from the agent-backend catalog
// (core/src/agentBackends/catalog.ts) — the same source the router, the frontend picker and the
// capability gating read, so adding a backend never needs a schema edit. catalog.ts is import-free
// by design, so pulling it in here keeps this module bundle-safe for the app.
const CHAT_PROVIDER_IDS = [AUTO_PROVIDER, ...BACKEND_IDS]
const CHAT_PROVIDER_DOC =
    `Default chat provider for NEW chat tabs: "auto" (the default) runs the first agent installed on this machine, in this order: ${AUTO_ORDER.join(', ')}; ` +
    `or name one: ${BACKEND_LIST.map(b => `"${b.id}" runs ${b.label}`).join(', ')}. ` +
    'A named provider is never swapped for another. Each chat can still pick its own provider in the header.'

const enumType = (values: string[]): PropertyType => ({ kind: 'enum', values })
const object = (fields: Schema): SchemaEntry => ({
    type: { kind: 'object', fields },
})

// The `keybindings` section: one string-typed key per global action, derived from
// the KEYBINDING_CATALOG (single source of truth for ids + default combos). A
// nested object (not a list), so the per-key merge — autocomplete, lint, the
// parity test, and POST /set-setting — all work without any special-casing.
const keybindingFields: Schema = {}
for (const k of KEYBINDING_CATALOG) {
    keybindingFields[k.id] = { type: 'keybind', default: k.default, doc: k.doc }
}

// `appearance.tokens`: one field per registered design token, derived from DESIGN_TOKENS (the one
// registry). No per-field defaults — the file is sparse and an absent key is the token's registry
// default (global.css). Validation + completion read each field's `token` kind.
const tokenFields: Schema = {}
for (const def of DESIGN_TOKENS) {
    tokenFields[def.key] = {
        type: { kind: 'token', token: def.key },
        doc: def.doc,
    }
}

export const SETTINGS_SCHEMA: Schema = {
    appearance: object({
        tokens: {
            type: { kind: 'object', fields: tokenFields },
            default: {},
            doc: 'Design-token overrides: token-name: value, e.g. sp-3: 10px. Only tokens you set are stored; an absent token is its default. Ctrl-Space lists every token.',
        },
        // Bismuth color theme — selects EVERY color in the app + graph (background,
        // surfaces, border, text, muted, accent, and the graph node palette). The theme
        // is the single source of color; app/src/themes.ts holds the token values that
        // settingsCssVars.ts projects to CSS vars. Ink and cathode are dark; paper and
        // riso are light.
        theme: {
            type: enumType(THEME_NAMES),
            default: 'ink',
            doc: 'Bismuth color theme: ink (default) // paper // cathode // riso, or the name of a custom theme in .themes/<name>.yaml.',
        },
        // Per-vault app logo mark (favicon + sidebar logo). One of the 14 Bismuth marks.
        icon: {
            type: enumType(ICON_NAMES),
            default: 'hopper-crystal',
            doc: 'App logo mark: hopper-crystal // node-b // square-funnel // nested-diamonds // pinwheel // node-crystal // lattice // diamond-bloom // node-diamond // octagon-bloom // spin-cross // tri-bloom // radial-graph // node-rings.',
        },
        uiFont: {
            type: enumType([...MONO_FONTS]),
            default: 'Monaspace Xenon',
            doc: 'UI + MONO font — a Monaspace variant, used for all chrome (rail, tabs, buttons, menus, calendar chips) AND for the mono constructs inside a note: code blocks, inline code, frontmatter, math and in-note tags. Config buffers (.settings, *.yaml) render entirely in it.',
        },
        proseFont: {
            type: enumType([...PROSE_FONTS]),
            default: 'Libron',
            doc: "PROSE font — the proportional face for everything that is the user's own writing: note body text, note headings, note tables, chat message bodies and the chat composer. Libron // IBM Plex Serif // Lora // the five Monaspace variants. Set it to a Monaspace variant for an all-mono editor.",
        },
        editorFontSize: {
            type: 'number',
            default: 13.5,
            min: 11,
            max: 28,
            doc: "Note prose font size (px). 13.5 is the design system's own prose size (--fs-body-lg, app/src/global.css) — prose is the one thing that is NOT at the 11.5px --fs-ui chrome size, because chrome is scanned and prose is read. The 18px row unit (--row-h) is unchanged, so a line of prose still lands on the same grid as a tree row or a tab.",
        },
        sidebarWidth: {
            type: 'number',
            default: 266,
            min: 200,
            max: 600,
            doc: "Left sidebar width (px) — the ASCII design's 266px vault rail (tokens/spacing.css). Set by dragging the sidebar's edge, which snaps onto this default within 12px.",
        },
        sidebarGraphHeight: {
            type: 'number',
            default: 305,
            min: 200,
            max: 500,
            doc: 'Height of the mini graph panel in the sidebar (px).',
        },
        tabRailWidth: {
            type: 'number',
            default: 232,
            min: 160,
            max: 480,
            doc: "Right tab rail's open width (px) — hovered or pinned; collapsed it is always the 46px icon column. Set by dragging the rail's edge, which snaps onto this default within 12px.",
        },
        uiFontSize: {
            type: 'number',
            default: 11.5,
            min: 11,
            max: 16,
            doc: "Base UI font size — sidebar, tabs, menus (px). It sets --fs-ui, the workhorse chrome size, and the ASCII grid's cell width follows it (6.3px at the 11.5 default).",
        },
        monoScale: {
            type: 'number',
            default: 1,
            min: 0.6,
            max: 1,
            doc: 'Optical-size factor for Monaspace (the mono UI/code font). The serif-vs-mono optical correction is legacy — the all-mono UI needs none; 1 = no correction.',
        },
        iconSize: {
            type: 'number',
            default: 12,
            min: 11,
            max: 20,
            doc: 'Icon size (px) for EVERY icon in the app — toolbars, file-tree rows, menus, buttons, chips. One size, no per-surface overrides. Default 12: an icon needs a little more room than the 11.5px --fs-ui label text beside it.',
        },
        cursorWidth: {
            type: 'number',
            default: 2,
            min: 1,
            max: 4,
            doc: 'Text cursor bar width (px) — the ONE cursor every editor, field and terminal draws.',
        },
        cursorGlideMs: {
            type: 'number',
            default: 70,
            min: 20,
            max: 200,
            doc: 'Text cursor glide between positions (ms), in every editor, field and terminal.',
        },
        cursorBlinkSeconds: {
            type: 'number',
            default: 1.2,
            min: 0.6,
            max: 2,
            doc: 'Text cursor blink cycle (seconds), shared by every cursor in the app.',
        },
    }),
    graph: object({
        spin: {
            type: 'boolean',
            default: true,
            doc: 'Idle rotation of the graph.',
        },
        showFps: {
            type: 'boolean',
            default: false,
            doc: 'Show the frame-rate (FPS) counter on the graph.',
        },
        spinSpeed: {
            type: 'number',
            default: 0.0015,
            min: 0,
            max: 0.01,
            doc: 'Idle spin speed (radians/frame).',
        },
        repulsion: {
            type: 'number',
            default: -10,
            min: -40,
            max: -1,
            doc: 'Node repulsion; more negative pushes apart harder.',
        },
        linkDistance: {
            type: 'number',
            default: 5,
            min: 1,
            max: 40,
            doc: 'Target distance between linked nodes.',
        },
        centering: {
            type: 'number',
            default: 0.13,
            min: 0,
            max: 0.5,
            doc: 'Pull toward center; higher = denser ball.',
        },
        nodeSize: {
            type: 'number',
            default: 6,
            min: 2,
            max: 16,
            doc: 'Base node radius.',
        },
        // NOTE: the graph 2D/3D dimension is intentionally NOT a setting. It's a transient,
        // per-window UI toggle (localStorage-backed) in app/src/GraphView.tsx, so switching it
        // never rewrites settings.yaml (which used to reload an open settings buffer and scroll
        // it to the top).
        showGraphLabels: {
            type: 'boolean',
            default: true,
            doc: 'Master toggle for in-scene labels.',
        },
        graphLabelHubCount: {
            type: 'number',
            default: 10,
            min: 0,
            max: 30,
            doc: 'Top-degree nodes that always get a label.',
        },
        nodeSizeMinMult: {
            type: 'number',
            default: 0.4,
            min: 0.1,
            max: 1,
            doc: 'Size multiplier for a 0/1-degree leaf node (the smallest dots).',
        },
        nodeSizeDegreeGain: {
            type: 'number',
            default: 0.45,
            min: 0.1,
            max: 1.5,
            doc: 'How fast node size grows with sqrt(link count).',
        },
        nodeSizeMaxMult: {
            type: 'number',
            default: 6,
            min: 2,
            max: 12,
            doc: 'Ceiling on node size (biggest hub vs a leaf).',
        },
        mapDefaultZoom: {
            type: 'number',
            default: 2,
            min: 1,
            max: 18,
            doc: "Default zoom for the Bases map view when it can't fit markers.",
        },
        refreshDebounceMs: {
            type: 'number',
            default: 300,
            min: 100,
            max: 1000,
            doc: 'Delay before rebuilding the graph after an edit burst (ms).',
        },
        backgroundNoise: {
            type: 'boolean',
            default: false,
            doc: 'The faint ASCII noise texture under the graph field. Off by default.',
        },
        gradient: {
            type: 'boolean',
            default: false,
            doc: 'The phosphor glow behind dense regions of the graph and the darkened vignette at its edges. Off by default (a flat ground).',
        },
    }),
    editor: object({
        livePreview: {
            type: 'boolean',
            default: true,
            doc: 'Render markdown inline as you type.',
        },
        lineNumbers: {
            type: 'boolean',
            default: false,
            doc: 'Show line numbers.',
        },
        lineWrapping: {
            type: 'boolean',
            default: true,
            doc: 'Wrap long lines.',
        },
        spellcheck: {
            type: 'boolean',
            default: true,
            doc: 'Spell check the note body (Harper).',
        },
        grammarCheck: {
            type: 'boolean',
            default: false,
            doc: 'Grammar + style check the note body (Harper). Independent of spellcheck; off by default.',
        },
        autoSaveDelay: {
            type: 'number',
            default: 800,
            min: 200,
            max: 3000,
            doc: 'Milliseconds of idle before saving.',
        },
        lineHeight: {
            type: 'number',
            // 1.25 -> 22.5px at the 18px row unit. Prose is Libron (--prose-font) at
            // 13.5 * --prose-scale 0.97 = 13.1px, so 22.5px of leading is a 1.72 ratio — open,
            // which suits a reading face drawn for e-readers (IBM Plex Serif, the previous
            // default, sat at 13.5px, a 1.67 ratio; Lora before it at 14.04px, 1.60). The old default of 1.5 (27px) was tuned for the CMU Serif
            // measurement before that (--prose-scale 1.28, ~17.28px prose).
            // Still a RATIONAL multiple of the row unit, deliberately: 1.25 means four prose
            // lines span exactly five 18px rows, so the "prose lands on the app's grid"
            // property this token exists to protect survives — it is now a 4:5 relationship
            // instead of 1:1, rather than an arbitrary one.
            default: 1.25,
            min: 0.8,
            max: 1.8,
            doc: "Editor prose line height, as a multiplier of the app's row unit (--row-h, 18px — app/src/global.css :root), NOT of the font size. Default 1.25 -> 22.5px. Prose is Libron (--prose-font) at 13.1px (13.5 * --prose-scale 0.97), where 22.5px of leading is a 1.72 ratio, an open measure that suits a reading face. Still a rational multiple of the row unit, so four prose lines span exactly five tree rows.",
        },
        mathMacros: {
            type: 'string',
            default: '',
            doc: 'LaTeX preamble of \\newcommand / \\def definitions applied to ALL math (KaTeX), mirroring Obsidian\'s preamble.sty. Example: "\\newcommand{\\R}{\\mathbb{R}} \\newcommand{\\norm}[1]{\\left\\lVert #1 \\right\\rVert}". Definitions are available in every $...$ and $$...$$ across the vault.',
        },
        wrapSelection: {
            type: 'boolean',
            default: true,
            doc: 'With text selected, type a wrapping character to surround the selection instead of replacing it (e.g. select a word, press * → *word*).',
        },
        wrapSelectionChars: {
            type: { kind: 'list', item: 'string' },
            default: ['*', '_', '~', '`'],
            doc: "Characters that wrap the current selection when typed (each surrounds it with itself; ( [ { < pair to ) ] } >). Brackets and quotes ( [ { ' \" $ already wrap via auto-close, so they're omitted here by default.",
        },
    }),
    vault: object({
        backupOnSave: {
            type: 'boolean',
            default: true,
            doc: 'Take a git snapshot after every save.',
        },
    }),
    // Where pasted/dropped attachments (images, PDFs, audio, video) are saved, and what
    // happens when you drag a file in from outside the vault. Embeds always RESOLVE by
    // filename (like wikilinks), so `folder` only sets where NEW files land — moving an
    // attachment later never breaks its `![[name]]` embed.
    attachments: object({
        folder: {
            type: 'string',
            default: 'attachments',
            doc: 'Folder for new pasted/dropped attachments (relative to the vault root). Created automatically if missing; "" = vault root, "." = the current note\'s folder.',
        },
        onDrop: {
            type: enumType(['copy', 'reference']),
            default: 'copy',
            doc: "Dragging a file in from outside the vault: copy it into the attachment folder (default, keeps the vault self-contained), or reference it in place (⌥-drop always references). Pasted clipboard images always copy in. Note: reference-in-place is best-effort in the browser build (the referenced file isn't in the vault, so the embed only resolves on desktop).",
        },
        naming: {
            type: 'string',
            default: 'Pasted image {timestamp}',
            doc: 'Filename for pasted clipboard images (the extension is added automatically). {timestamp} → a sortable date-time stamp; name collisions get a numeric suffix.',
        },
    }),
    calendar: object({
        // defaultView enum is coupled to ViewType in app/src/calendar/types.ts.
        defaultView: {
            type: enumType(CALENDAR_VIEWS),
            default: 'week',
            doc: 'Default calendar view.',
        },
        weekStartsOnMonday: {
            type: 'boolean',
            default: true,
            doc: 'Start the week on Monday.',
        },
        militaryTime: {
            type: 'boolean',
            default: false,
            doc: 'Use 24-hour time.',
        },
        monthCellMinHeight: {
            type: 'number',
            default: 80,
            min: 50,
            max: 160,
            doc: 'Minimum height of a day cell in month view (px).',
        },
        timeGutterWidth: {
            type: 'number',
            default: 50,
            min: 40,
            max: 80,
            doc: 'Width of the hour-label gutter in week/day views (px).',
        },
        defaultCategoryColor: {
            type: 'string',
            default: CATEGORY_SWATCHES.blue,
            doc: 'Default color for a newly created event category (hex).',
        },
    }),
    // Two-way Google Calendar sync — CONNECTION-LEVEL config shared by every synced calendar.
    // NON-SECRET operational config only — the OAuth client credentials + tokens live OUTSIDE
    // the vault (~/.bismuth/gcal), never in settings.yaml or git. Connect via the "Connect
    // Google Calendar…" command; the single OAuth scope is calendar.events (read+write events
    // only; no Gmail/Drive/contacts access). WHICH calendar base syncs with WHICH Google
    // calendar is now PER-CALENDAR: each calendar base declares `googleCalendarSync` +
    // `googleCalendarId` in its own frontmatter (set from the calendar's settings panel), so a
    // vault can have several calendars each synced with a different Google calendar. The
    // `enabled`/`calendarId`/`basePath` keys below are LEGACY — kept only so an existing single
    // mapping keeps working and migrates onto its base's per-calendar keys.
    googleCalendar: object({
        enabled: {
            type: 'boolean',
            default: false,
            doc: "LEGACY (now per-calendar): the old global on/off switch. Still honored as a migration fallback for the base named by `basePath` — new calendars use each base's own `googleCalendarSync` frontmatter key.",
        },
        calendarId: {
            type: 'string',
            default: 'primary',
            doc: 'LEGACY (now per-calendar): the old global Google calendar id. Still honored for the base named by `basePath`; new calendars set `googleCalendarId` in their own frontmatter.',
        },
        basePath: {
            type: 'string',
            default: '',
            doc: "LEGACY (now per-calendar): the old global 'which calendar base to sync'. Kept as a migration pointer; new setups enable sync per calendar in that calendar's settings instead.",
        },
        conflictPolicy: {
            type: enumType(['lastWriteWins', 'googleWins', 'bismuthWins']),
            default: 'lastWriteWins',
            doc: 'How to resolve an event changed on BOTH sides since the last sync: lastWriteWins (newest edit wins) // googleWins // bismuthWins. Applies to every synced calendar.',
        },
        syncIntervalMinutes: {
            type: 'number',
            default: 15,
            min: 1,
            max: 1440,
            doc: 'Auto-sync cadence in minutes for every synced calendar (manual sync is always available).',
        },
        timeZone: {
            type: 'string',
            default: '',
            doc: 'IANA timezone applied to naive (untimed) events when pushing to Google (blank = system timezone).',
        },
    }),
    ui: object({
        // Vertical tab rail: hide the horizontal top strip and show the open tabs as a narrow
        // icon rail on the RIGHT edge of the app, which expands to reveal full names on hover.
        // Off = the classic horizontal tab bar. Toggled via the `.has-rail` layout class in App.tsx.
        paletteTopOffset: {
            type: 'string',
            default: '12vh',
            doc: 'How far down the screen the command palette appears (CSS length, e.g. 12vh).',
        },
        paneDividerWidth: {
            type: 'number',
            default: 5,
            min: 3,
            max: 12,
            doc: 'Grab width of the divider between split panes (px). The visible line is always the 1px app border; this is the invisible strip around it you can drag.',
        },
        cardGridMinWidth: {
            type: 'number',
            default: 220,
            min: 150,
            max: 360,
            doc: 'Minimum card width in the Bases cards view (px).',
        },
        kanbanColumnMinWidth: {
            type: 'number',
            default: 248,
            min: 180,
            max: 360,
            doc: 'Minimum Bases kanban column width (px).',
        },
        kanbanColumnMaxWidth: {
            type: 'number',
            default: 288,
            min: 220,
            max: 420,
            doc: 'Maximum Bases kanban column width (px).',
        },
        mapMinHeight: {
            type: 'number',
            default: 480,
            min: 300,
            max: 800,
            doc: 'Minimum height of the Bases map view (px).',
        },
        tableMinColWidth: {
            type: 'number',
            default: 60,
            min: 30,
            max: 150,
            doc: 'Minimum column width when resizing a Bases table (px).',
        },
    }),
    layout: object({
        sidebarSide: {
            type: enumType(['left', 'right']),
            default: 'left',
            doc: 'Which window edge the sidebar sits on. When the tab rail is on the same side, the sidebar is outermost and the rail sits between it and the editor.',
        },
        tabRailSide: {
            type: enumType(['left', 'right']),
            default: 'right',
            doc: 'Which window edge the vertical tab rail sits on. When the sidebar is on the same side, the rail sits between the sidebar and the editor.',
        },
        sidebar: {
            type: { kind: 'list', item: enumType([...SIDEBAR_SECTIONS]) },
            default: ['toolbar', 'files', 'graph'],
            doc: 'The sidebar sections from top to bottom (toolbar, files, graph); leave an id out to hide that section. Leaving out graph removes the docked mini graph while a note is open.',
        },
        statusBar: {
            type: 'boolean',
            default: true,
            doc: 'Show the status bar along the bottom edge of the window.',
        },
    }),
    server: object({
        fileWatchDebounceMs: {
            type: 'number',
            default: 250,
            min: 50,
            max: 2000,
            doc: 'Coalesce rapid file changes for this long before rebuilding caches (ms).',
        },
        sseHeartbeatMs: {
            type: 'number',
            default: 5000,
            min: 1000,
            max: 30000,
            doc: 'Keepalive ping interval for the live-update stream (ms).',
        },
    }),
    // Daemon supervision. Bismuth reads/writes the daemon's shared state
    // files (device list + owner-device selection) under its home dir. The owner
    // device is the single source of truth in owner.json — NOT a setting here.
    daemon: object({
        enabled: {
            type: 'boolean',
            default: false,
            doc: "Master switch for this vault's daemon — the per-vault assistant that runs crons/processes in the background, injects this vault's memory into its Claude sessions, and shows the 3rd-brain graph mode + the daemon's own page. Off = dormant: state is preserved on disk and the .daemon folder is hidden. Set automatically from the first-run intro; toggle anytime. The daemon's NAME lives in its identity file (.daemon/identity.md frontmatter), not here.",
        },
        inboxRetentionDays: {
            type: 'number',
            default: 7,
            min: 1,
            max: 90,
            doc: "How long a resolved daemon-inbox page (sent/discarded/failed) stays listed before it's garbage-collected (days). GC runs opportunistically whenever the inbox is read — no separate cron or ticker.",
        },
        backend: {
            type: enumType(DAEMON_BACKEND_IDS),
            default: DEFAULT_BACKEND,
            doc: 'Which agent CLI runs this vault\'s daemon brain (unattended, resumable, headless): "claude" (default) or "codex". This is a REQUEST, not a guarantee — resolveDaemonBackend (daemon/src/daemon/session.ts) refuses any non-Claude backend for a vault with even one hidden/chat-only note (only Claude Code can enforce the visibility gate) and degrades to "claude" instead, logging why. Clear the vault\'s hidden notes to actually run another backend.',
        },
        inheritUserMcp: {
            type: 'boolean',
            default: false,
            doc: "Let this vault's daemon sessions use the MCP servers and plugins installed for your own `claude` CLI (user scope: ~/.claude.json servers + ~/.claude/settings.json plugins), on top of the always-present vault-targeted `bismuth` server. Off by default because a cron runs UNATTENDED with permissions bypassed and no confirmation prompt — turning this on hands it every tool those servers expose. Project- and local-scope settings are never loaded regardless: the session's cwd is the vault root, so a `.mcp.json` sitting in your notes would otherwise auto-execute.",
        },
        recall: object({
            enabled: {
                type: 'boolean',
                default: true,
                doc: "Master switch for every AUTOMATIC memory injection into agent sessions — the prompt-time recall, mid-turn recall, session-start memory and subagent memory. Off = agents only see memory they ask for through the remember/recall/forget tools. Requires daemon.enabled (the 3rd brain is off without it). Cost when on: a small keyword lookup per prompt; the heavier costs are the two switches below.",
            },
            midTurn: {
                type: 'boolean',
                default: true,
                doc: 'Run one memory recall per agent tool batch (between tool calls, inside a long turn), not only when you send a prompt. Cost: one extra lookup for each batch of tool calls an agent makes, so a long agentic turn does that many extra recalls. Off = memory is recalled at the prompt only. Has no effect when recall.enabled is off.',
            },
            semantic: {
                type: 'boolean',
                default: true,
                doc: 'Use embedding (meaning-based) search in recall. Cost: on first use core starts a separate helper process holding a ~35MB embedding model (about 260-280MB of RAM while it runs, a little CPU while it embeds); core itself grows by under 10MB. The helper exits after 10 minutes idle, which returns all of that memory. Off = keyword-only recall and the helper is never started. Has no effect when recall.enabled is off.',
            },
        }),
    }),
    // Bismuth-app self-update. The bundled app can git-pull + rebuild + swap itself
    // (see core/src/selfUpdate.ts); by default that's manual via the update banner.
    update: object({
        autoUpdate: {
            type: 'boolean',
            default: false,
            doc: 'Auto-apply Bismuth app updates on launch in the background, then relaunch when the rebuild is ready (off = manual via the update banner).',
        },
    }),
    terminal: object({
        fontSize: {
            type: 'number',
            default: 13,
            min: 9,
            max: 20,
            doc: 'Terminal font size (px).',
        },
        lineHeight: {
            type: 'number',
            default: 1.5,
            min: 1.2,
            max: 2,
            doc: 'Terminal line height (multiplier).',
        },
    }),
    chat: object({
        // Derived from the agent-backend catalog — no hand-maintained copy to drift from BACKEND_IDS.
        provider: {
            type: enumType(CHAT_PROVIDER_IDS),
            default: AUTO_PROVIDER,
            doc: CHAT_PROVIDER_DOC,
        },
        // Saved provider + model + effort combinations, picked from the chat's model dialog
        // (app/src/chat/ChatPresetList.tsx, above the connectors) — the dialog's `+ save` appends one, its `[x]`
        // removes one. Pure list rules: app/src/chat/chatPresets.ts.
        presets: {
            type: {
                kind: 'list',
                item: {
                    kind: 'object',
                    fields: {
                        name: {
                            type: 'string',
                            doc: 'What the preset is called in the model dialog.',
                        },
                        provider: {
                            type: enumType(CHAT_PROVIDER_IDS),
                            doc: 'Which chat connector the preset runs on.',
                        },
                        model: {
                            type: 'string',
                            doc: "The model id as the connector reports it. Empty = the connector's own default.",
                        },
                        effort: {
                            type: 'string',
                            doc: "Reasoning effort (low, medium, high, xhigh, max — whatever the model supports). Empty = the model's own default.",
                        },
                    },
                },
            },
            default: [],
            doc: 'Saved provider + model + effort combinations for chat and the daemon chat, applied from the model dialog. Picking one on another connector starts a new conversation, as switching connector always does.',
        },
    }),
    // Open models through the EXISTING chat connectors (core/src/agentBackends/localModel.ts): any
    // OpenAI/Anthropic-compatible local server — LM Studio, Ollama, llama.cpp, vLLM. Applied at spawn
    // time through env/argv only, so the user's own CLI configs are never edited and only Bismuth's
    // chats go local. Which backends honor it is the catalog's `localModel` capability.
    localModel: object({
        enabled: {
            type: 'boolean',
            default: false,
            doc: "Run chats on a local model server instead of each CLI's own account. Applies to Claude Code, Codex, opencode and Goose chats (other backends run as normal) from the next chat or turn. Never edits those CLIs' own config files.",
        },
        url: {
            type: 'string',
            default: 'http://localhost:1234',
            doc: "Base URL of the local model server, without /v1 — LM Studio is http://localhost:1234, Ollama is http://localhost:11434. Claude Code needs the server's Anthropic /v1/messages (LM Studio 0.4.1+, Ollama 0.14+); Codex needs /v1/responses (LM Studio 0.3.29+, Ollama 0.13.3+); opencode and Goose use /v1/chat/completions.",
        },
        model: {
            type: 'string',
            default: '',
            doc: 'Model id to run, as the server lists it at /v1/models (e.g. "qwen/qwen3-coder-30b" or "gpt-oss:20b"). Empty = the first model the server lists. Pick a model that supports tool calling, with a 25k+ context window.',
        },
        apiKey: {
            type: 'string',
            default: '',
            doc: 'Sent as a bearer token when set. Most local servers ignore it; LM Studio needs it only when its server authentication is on.',
        },
    }),
    // Multi-CLI MCP registration (core/src/agentBackends/mcpRegistrars.ts): which OTHER agent CLIs,
    // besides Claude Code (which always auto-registers on boot via bismuthInstall.ts), also get
    // Bismuth's stdio MCP server (docs + bismuth CLI + memory tools) written into their own global
    // config. Deliberately opt-in and empty by default — writing into a user's Codex/Cline/OpenClaw/
    // Gemini/Qwen/Copilot/Amp/Droid/Crush/Goose config uninvited is intrusive in a way `claude mcp
    // add` isn't for a Claude-first app. Register via `bismuth install --mcp <cli>` (or `--mcp
    // all`); this setting just records the user's chosen set for a future UI toggle to read/write.
    mcp: object({
        registerWith: {
            type: { kind: 'list', item: 'string' },
            default: [],
            doc: 'Additional agent CLIs (besides Claude Code, which always auto-registers) to register Bismuth\'s MCP server with, e.g. ["codex", "gemini"] — so those CLIs get Bismuth\'s docs/CLI/memory tools. Registrar ids: codex, cline, openclaw, gemini, qwen, copilot, amp, droid, crush, goose. Listing a CLI here IS the opt-in: registration runs on the next app start (and on demand via `bismuth install --mcp <cli>` / `--mcp all`). Empty by default, so Bismuth never writes into another CLI\'s config uninvited. Registration is idempotent and never clobbers an entry it didn\'t write.',
        },
    }),
    // OpenAI Codex-specific opt-ins (core/src/agentBackends/agentsMd.ts + codexHooks.ts). Codex has no
    // system-prompt flag and no PATH-shim hook mechanism — AGENTS.md and a project-scoped
    // .codex/hooks.json are its OWN designed channels for memory + session telemetry (the daemon's
    // persona travels separately, via `developer_instructions`), but both mean
    // writing into files the user may hand-edit, so — same precedent as mcp.registerWith — both
    // default off and are opt-in.
    codex: object({
        writeAgentsMd: {
            type: 'boolean',
            default: false,
            doc: "Let Bismuth write/refresh a managed block in this vault's AGENTS.md with a short persona/memory note for the Codex CLI (`codex exec` has no system-prompt flag — AGENTS.md is Codex's own designed channel for this, and Cursor/Amp/Droid share the same convention). Optional: the daemon's persona reaches a Codex brain regardless, through `developer_instructions`. The block is delimited by markers and never touches surrounding prose; off by default because writing into a file you may hand-edit is opt-in.",
        },
        installRelayHooks: {
            type: 'boolean',
            default: false,
            doc: "Let Bismuth write a project-scoped .codex/hooks.json (+ its small reporting script) into this vault so a Codex session run in a Bismuth terminal tab or chat reports its lifecycle into Bismuth's in-process relay registry — the same role Claude Code's relay plugin plays. Off by default: writing into the vault is opt-in.",
        },
    }),
    srs: object({
        baseEase: {
            type: 'number',
            default: 250,
            min: 130,
            max: 400,
            doc: 'Starting ease factor for a new flashcard (SM-2; higher = longer intervals).',
        },
        easyBonus: {
            type: 'number',
            default: 1.3,
            min: 1,
            max: 2,
            doc: "Extra interval multiplier when a card is rated 'easy'.",
        },
        lapsesIntervalChange: {
            type: 'number',
            default: 0.5,
            min: 0.1,
            max: 1,
            doc: "Interval multiplier when a card is rated 'hard' (lapse penalty).",
        },
        minEase: {
            type: 'number',
            default: 130,
            min: 50,
            max: 250,
            doc: "Floor on a card's ease factor.",
        },
        easeStep: {
            type: 'number',
            default: 20,
            min: 5,
            max: 50,
            doc: 'Ease change per review.',
        },
        easyGraduatingInterval: {
            type: 'number',
            default: 4,
            min: 1,
            max: 14,
            doc: "Days until next review when a new card is rated 'easy'.",
        },
        goodGraduatingInterval: {
            type: 'number',
            default: 1,
            min: 1,
            max: 3,
            doc: "Days until next review when a new card is rated 'good'/'hard'.",
        },
    }),
    templates: object({
        folder: {
            type: { kind: 'path', only: 'dir' },
            default: 'Templates',
            doc: 'Vault folder holding template .md files. Option+T inserts one at the cursor.',
        },
        // Mirrors dailyNotes[].template: a `path`/`scope:"templates"` pointer to a template .md,
        // expanded via the same {{...}} engine (core/src/templates.ts) and applied by
        // core/src/newNoteTemplate.ts. Empty (the default) = no template — a brand-new note is
        // created empty exactly as before this setting existed.
        newNote: {
            type: { kind: 'path', scope: 'templates' },
            default: '',
            doc: 'Vault path to a template .md used to pre-fill a brand-new note (the New Note command and the file-tree "New File" action). Empty = no template (plain empty note).',
        },
    }),
    // The vault-wide property registry. Free-form `{name: typeString}`, validated
    // leniently by registry.loadRegistry — seeded empty on first launch.
    properties: {
        type: { kind: 'object', fields: {} },
        doc: 'Vault property registry: map each frontmatter key to a type.',
    },
    // Per-folder icons. Free-form `{folderPath: iconName}` (folders have no
    // frontmatter), seeded empty and written via POST /folder-icon.
    folderIcons: {
        type: { kind: 'object', fields: {} },
        doc: 'Per-folder icons: map a folder path to a Lucide icon name or emoji.',
    },
    // Per-folder visibility (folders have no frontmatter). Free-form
    // `{folderPath: "chat-only"|"hidden"}`, seeded empty and written via
    // POST /folder-visibility. Nearest-ancestor-wins; see core/src/visibility.ts.
    folderVisibility: {
        type: { kind: 'object', fields: {} },
        doc: 'Per-folder AI visibility: map a folder path to "chat-only" or "hidden" (restricts the daemon + in-app chat, not you).',
    },
    // Sidebar header bar buttons, in order. Each runs a command-palette command.
    // Seeded with the three built-ins so a fresh install is unchanged.
    toolbar: {
        type: {
            kind: 'list',
            item: {
                kind: 'object',
                fields: {
                    command: {
                        type: {
                            kind: 'enum',
                            values: COMMAND_IDS,
                            allowPrefixes: ['daily-note:'],
                        },
                        doc: 'Which command this button runs (a catalog id or daily-note:<id>). Use command: OR commands:, not both.',
                    },
                    commands: {
                        type: {
                            kind: 'list',
                            item: {
                                kind: 'enum',
                                values: COMMAND_IDS,
                                allowPrefixes: ['daily-note:'],
                            },
                        },
                        doc: 'Multiple commands to run in sequence (alternative to command: field). Use command: OR commands:, not both.',
                    },
                    icon: {
                        type: 'icon',
                        doc: 'Lucide icon name (e.g. "FilePlus") or an emoji shown on the button.',
                    },
                    tooltip: {
                        type: 'string',
                        doc: "Optional hover text (defaults to the command's label).",
                    },
                },
            },
        },
        default: [
            { command: 'create-menu', icon: 'Plus' },
            { command: 'search', icon: 'Search' },
            // The daemon inbox lives here by default (hidden while the daemon is off; carries a
            // due-count badge — see App.tsx's toolbar render). Removable/movable like any button.
            { command: 'open-inbox', icon: 'Inbox' },
        ],
        doc: 'Buttons in the sidebar header bar, in order. Each runs a command-palette command.',
    },
    // The TAB-BAR action buttons (right of the tab strip) — same item shape and rendering as
    // `toolbar`, so both bars are configured the same way. Defaults match what used to be
    // hardcoded (new tab + terminal) plus the new-chat button the user asked for.
    tabBar: {
        type: {
            kind: 'list',
            item: {
                kind: 'object',
                fields: {
                    command: {
                        type: {
                            kind: 'enum',
                            values: COMMAND_IDS,
                            allowPrefixes: ['daily-note:'],
                        },
                        doc: 'Which command this button runs (a catalog id or daily-note:<id>). Use command: OR commands:, not both.',
                    },
                    commands: {
                        type: {
                            kind: 'list',
                            item: {
                                kind: 'enum',
                                values: COMMAND_IDS,
                                allowPrefixes: ['daily-note:'],
                            },
                        },
                        doc: 'Multiple commands to run in sequence (alternative to command: field). Use command: OR commands:, not both.',
                    },
                    icon: {
                        type: 'icon',
                        doc: 'Lucide icon name (e.g. "FilePlus") or an emoji shown on the button.',
                    },
                    tooltip: {
                        type: 'string',
                        doc: "Optional hover text (defaults to the command's label).",
                    },
                },
            },
        },
        default: [
            { command: 'new-tab', icon: 'SquarePlus' },
            { command: 'terminal', icon: 'SquareTerminal' },
            { command: 'new-claude-chat', icon: 'MessageSquare' },
        ],
        doc: 'Buttons in the tab bar (right of the tab strip), in order. Same shape as `toolbar`.',
    },
    statusBar: {
        type: {
            kind: 'list',
            item: {
                kind: 'object',
                fields: {
                    builtin: {
                        type: enumType([...STATUS_BUILTINS]),
                        doc: 'A built-in readout: location (focused file path), connection (shown only while disconnected), inbox, daemon. Use ONE of builtin:, text:, query:, run:.',
                    },
                    text: {
                        type: 'string',
                        doc: 'Text with {tokens}: {files} {notes} {folders} {tags} {tasks.open} {tasks.done} {tasks.due} {tasks.overdue} {date}, plus {count} with query: and {output} with run:. e.g. "files: {files}".',
                    },
                    query: {
                        type: {
                            kind: 'object',
                            fields: {
                                source: {
                                    type: enumType([...STATUS_QUERY_SOURCES]),
                                    doc: 'notes, tasks, or base.',
                                },
                                ref: {
                                    type: 'string',
                                    doc: 'A base as "[[Name]]" — the base to count (source: base), or the base whose notes to scope to (notes/tasks).',
                                },
                                where: {
                                    type: 'string',
                                    doc: 'A Bases filter expression, e.g. status == "reading" or date(due) <= today().',
                                },
                            },
                        },
                        doc: 'Count rows from the vault; the number is {count} (shown alone when text: is omitted).',
                    },
                    run: {
                        type: 'string',
                        doc: 'A shell command, run in the vault folder; its first output line is {output}. Runs only after you click [ allow ] in the bar, once per command per machine.',
                    },
                    every: {
                        type: 'number',
                        min: 5,
                        doc: 'Seconds between re-runs of run: (default 60).',
                    },
                    align: {
                        type: enumType(['left', 'right']),
                        doc: 'Which end of the bar (default right; location/connection default left).',
                    },
                    tone: {
                        type: enumType([...STATUS_TONES]),
                        doc: 'Text colour.',
                    },
                    command: {
                        type: {
                            kind: 'enum',
                            values: COMMAND_IDS,
                            allowPrefixes: ['daily-note:'],
                        },
                        doc: 'A command to run when the segment is clicked.',
                    },
                    tooltip: { type: 'string', doc: 'Hover text.' },
                    icon: {
                        type: 'icon',
                        doc: 'Lucide icon name or emoji shown before the text.',
                    },
                },
            },
        },
        default: DEFAULT_STATUS_BAR,
        doc: 'The bottom status bar, in order. Each item is a built-in readout, a {token} template, a query count, or a shell command. See docs/settings/status-bar.md.',
    },
    homePage: {
        type: { kind: 'path', only: 'file' },
        default: '',
        doc: 'What a new tab (Cmd+T), first launch and closing the last tab open. Empty = the knowledge graph. Point it at a note to make your own home page.',
    },
    // Daily-note types. Each registers a `daily-note:<id>` command (see core/commands)
    // that you reference from `toolbar` to get a button. Pressing it opens today's note
    // for that type, creating it from `template` the first time. Top-level list, read
    // via readDailyNotesFrom (mirrors toolbar/folderIcons).
    dailyNotes: {
        type: {
            kind: 'list',
            item: {
                kind: 'object',
                fields: {
                    id: {
                        type: 'string',
                        doc: 'Stable id; forms the command id daily-note:<id>.',
                    },
                    label: {
                        type: 'string',
                        doc: 'Command-palette label and default button tooltip.',
                    },
                    icon: {
                        type: 'icon',
                        doc: 'Lucide icon name (e.g. "BookOpen") or an emoji.',
                    },
                    folder: {
                        type: { kind: 'path', only: 'dir' },
                        doc: 'Vault folder for entries ("" = vault root).',
                    },
                    fileName: {
                        type: 'string',
                        doc: 'Filename via {{...}} tokens, no .md. e.g. {{date}} journal.',
                    },
                    template: {
                        type: { kind: 'path', scope: 'templates' },
                        doc: 'Vault path to a template .md to pre-fill the note (optional).',
                    },
                },
            },
        },
        default: [
            {
                id: 'journal',
                label: 'Journal',
                icon: 'BookOpen',
                folder: 'Journal',
                fileName: '{{date}} journal',
                template: 'Templates/Journal.md',
            },
        ],
        doc: 'Daily-note types. Each adds a daily-note:<id> command you can put on the toolbar.',
    },
    // Global keyboard shortcuts — placed LAST so it sits at the end of a fresh
    // settings.yaml. One key per app-level action; the value is a `keybind` combo
    // string (e.g. "Mod+P" — Mod = Cmd on macOS / Ctrl elsewhere). Comma-separate
    // alternatives ("Mod+`, Mod+J"). The `keybind` type drives the smart, order-free
    // shortcut autocomplete + "record shortcut" option (app/src/editor/settingsComplete).
    // Defaults equal the previously hardcoded combos; fields derive from KEYBINDING_CATALOG.
    keybindings: object(keybindingFields),
}

/** Recursively materialize the `default` of every leaf into a plain nested object. */
function deriveDefaults(schema: Schema): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(schema)) {
        if (typeof entry.type === 'object' && entry.type.kind === 'object') {
            out[key] = deriveDefaults(entry.type.fields)
        } else if (entry.default !== undefined) {
            out[key] = entry.default
        }
    }
    return out
}

// AppSettings is the structural shape the frontend store consumes; deriving it
// from the schema keeps it in lockstep with the documented defaults.
export type AppSettings = ReturnType<typeof deriveDefaults>

export const DEFAULTS: AppSettings = deriveDefaults(SETTINGS_SCHEMA)
