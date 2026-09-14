// app/src/tabIds.ts
// Sentinel content ids that aren't real note paths. No real path begins with "::".
import { previewKind } from './preview/previewKind'

// NOTE: there is no ::search sentinel anymore — search is the Cmd+O switcher takeover (#8:
// "the search tab and the cmd+o should be the same thing"). Persisted "::search" tabs from
// older builds are migrated to ::graph on restore (see LEGACY_CONTENT_IDS in panes.ts).
export const EMPTY_PANE = '::empty'
// The Knowledge Graph as a first-class tab (the "Open graph view" / "New tab" commands open this).
export const GRAPH_TAB = '::graph'
// Embedded terminal session: TERMINAL_PREFIX + "<uuid>".
export const TERMINAL_PREFIX = '::term:'
// Export options screen for a file: EXPORT_PREFIX + "<file path>".
export const EXPORT_PREFIX = '::export:'
// Chat session with Claude Code: CHAT_PREFIX + "<chat id>".
export const CHAT_PREFIX = '::chat:'
// The daemon page — the living face, crons + services, inbox + log, and a docked chat. One tab,
// like GRAPH_TAB (not per-instance, unlike CHAT_PREFIX/TERMINAL_PREFIX). It replaced the old
// `::inbox` tab, which persisted layouts migrate to this (LEGACY_CONTENT_IDS in panes.ts).
export const DAEMON_TAB = '::daemon'
// The daemon page's docked chat is ONE persistent conversation: content id CHAT_PREFIX +
// DAEMON_CHAT_ID. chatSessionStore keys by chat id, so it resumes across closes and relaunches.
export const DAEMON_CHAT_ID = 'daemon'
// RETIRED: the old ANNOTATE surface's content id, ANNOTATE_PREFIX + "<file path>". Nothing creates
// one any more (images/PDFs are drawn on in place in their preview), but a tab persisted before
// that change can still carry it, so PaneContent routes it to the file's preview and the label
// and icon below read as that file's.
export const ANNOTATE_PREFIX = '::annotate:'

// The app's "settings page" is the single hidden `.settings` file (YAML) opened as an ordinary
// file tab (there is no ::settings sentinel). We treat it as a first-class app: shown as "settings"
// with a gear icon rather than a raw filename.
export const SETTINGS_FILE = '.settings'
export function isSettingsFile(content: string): boolean {
    return content === SETTINGS_FILE || content.endsWith('/' + SETTINGS_FILE)
}

export function isSentinel(content: string): boolean {
    return content.startsWith('::')
}

// Chat tabs are labeled by an injected provider (tabIds stays framework-free): App wires it to
// the per-session conversation title (chatTitles) with the daemon's identity name as fallback,
// so precedence is title > daemon persona > "Chat". Because the provider reads signals, any
// JSX/memo calling contentLabel stays reactive to both. Receives the full content id
// ("::chat:<id>") so it can key the title lookup.
let chatLabelProvider: ((content: string) => string | null) | null = null
export function setChatLabelProvider(
    fn: (content: string) => string | null,
): void {
    chatLabelProvider = fn
}

// Chat tabs also get an injected ICON provider (same seam/reasoning as the label provider above):
// App wires it to the tab's resolved daemon-vs-user origin (app/src/chatOrigin.ts), so the tab bar +
// pane header show a distinct glyph for a chat bound to a DAEMON session (a cron chat opened from
// History's daemon scope) vs one the user started. Falls back to the plain chat icon when unset/null
// (a brand-new tab, or before App has wired it).
let chatIconProvider: ((content: string) => string | null) | null = null
export function setChatIconProvider(
    fn: (content: string) => string | null,
): void {
    chatIconProvider = fn
}

// Bare note name from a vault path ("a/b/c.md" -> "c"). Config buffers (.yaml/.yml) and
// app docs (.draw/.sheet) drop their extension too, so a tab reads as a name, not a file.
function noteName(path: string): string {
    return path
        .split('/')
        .pop()!
        .replace(/\.(md|draw|sheet|ya?ml)$/, '')
}

// Human label for a pane/tab content id — used by both the tab bar and pane headers.
// `terminalIndex` lets the caller pass the 1-based position among open terminal tabs
// (terminals don't have intrinsic names), so the label can be "Terminal N".
export function contentLabel(content: string, terminalIndex?: number): string {
    if (content === GRAPH_TAB) return 'New tab' // the graph IS the home/new tab; label reads as such (icon stays Share2)
    if (content === DAEMON_TAB) return 'Daemon'
    if (content === EMPTY_PANE) return '' // blank header — an empty pane reads as truly empty
    if (content.startsWith(EXPORT_PREFIX))
        return `Export: ${noteName(content.slice(EXPORT_PREFIX.length))}`
    if (content.startsWith(CHAT_PREFIX))
        return chatLabelProvider?.(content) ?? 'Chat'
    if (content.startsWith(TERMINAL_PREFIX))
        return `Terminal ${terminalIndex ?? '?'}`
    // A restored (retired) annotate tab: label as the bare filename, like the preview it opens.
    if (content.startsWith(ANNOTATE_PREFIX))
        return content.slice(ANNOTATE_PREFIX.length).split('/').pop() ?? content
    if (isSettingsFile(content)) return 'settings'
    return noteName(content)
}

// icon NAME for a pane/tab content id, or undefined for plain notes / empty panes.
// Rendered before the label by the tab bar and pane headers.
export function contentIcon(content: string): string | undefined {
    if (content === GRAPH_TAB) return 'Share2'
    if (content === DAEMON_TAB) return 'Bot'
    if (content.startsWith(EXPORT_PREFIX)) return 'Download'
    if (content.startsWith(CHAT_PREFIX))
        return chatIconProvider?.(content) ?? 'MessageSquare'
    if (content.startsWith(TERMINAL_PREFIX)) return 'SquareTerminal'
    // A restored (retired) annotate tab opens the file's preview, so it wears that icon.
    if (content.startsWith(ANNOTATE_PREFIX))
        return contentIcon(content.slice(ANNOTATE_PREFIX.length))
    if (isSettingsFile(content)) return 'Settings'
    if (content.endsWith('.sheet')) return 'Table'
    if (content.endsWith('.draw')) return 'PenTool'
    // Preview tabs (images/PDFs/code/binary) get a kind-specific glyph.
    switch (previewKind(content)) {
        case 'image':
            return 'Image'
        case 'pdf':
            return 'FileText'
        case 'code':
            return 'Code'
        case 'external':
            return 'File'
    }
    return undefined
}

// True for a fresh, never-renamed note ("Untitled.md" / "Untitled-<uuid>.md"). Used to
// suppress a tab icon for these — a brand-new note reads as a blank slate until it's
// actually named.
export function isUnnamedNote(content: string): boolean {
    const base = (content.split('/').pop() ?? content).replace(
        /\.(md|ya?ml|draw|sheet)$/,
        '',
    )
    return base === 'Untitled' || base.startsWith('Untitled-')
}
