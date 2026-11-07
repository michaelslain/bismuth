// app/src/editor/linkClicks.ts
// Clicking a rendered link in a markdown CodeMirror view: a `[[wikilink]]` opens its note (with a
// `#heading` anchor), a `~slug` opens its memory note, a `[text](url)` or a bare URL opens in the
// browser. Shared by the note editor and every read-only note view (a chat message), so a link
// behaves the same wherever note markdown is shown.
import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import {
    isFolderTarget,
    parseWikilink,
    resolveNotePath,
    wikilinkOpenPath,
    type NoteCandidate,
} from './wikilink'
import {
    MEMORY_REF_RE,
    memoryRefPath,
    resolveMemorySlug,
    type MemoryCandidate,
} from '../../../core/src/memoryRef'
import { findBareUrls } from './urls'
import { openExternalUrl } from '../appWindow'
import { openNote, revealFolder } from '../ui/openNote'

export type LinkClickOptions = {
    /** Vault notes a `[[wikilink]]` resolves against, by file name. */
    noteNames: () => NoteCandidate[]
    /** Memory notes a `~slug` resolves against. */
    memoryNames: () => MemoryCandidate[]
}

export function noteLinkClicks(opts: LinkClickOptions): Extension {
    return EditorView.domEventHandlers({
        mousedown: (e, view) => {
            // Only navigate when the click actually lands on a RENDERED link — live
            // preview marks links/wikilinks/bare-urls with `.cm-link` / `.cm-wikilink`
            // (livePreview.ts). Without this gate, a click in the empty space below a
            // note whose last content is a link resolves (via nearest-position mode) to
            // the doc end, which sits inside that trailing link, and wrongly navigates.
            // (Links on the caret's own line render raw with no class, so a plain click
            // there places the cursor to edit instead of navigating — Obsidian-like.)
            const tgt = e.target as HTMLElement | null
            if (!tgt?.closest?.('.cm-link, .cm-wikilink')) return false
            // `false` = nearest-position mode: precise mode returns null when the click
            // lands between glyphs or on padding, which made links intermittently dead.
            // Safe now that the DOM-class gate above has confirmed we're on a link.
            const pos = view.posAtCoords(
                {
                    x: (e as MouseEvent).clientX,
                    y: (e as MouseEvent).clientY,
                },
                false,
            )
            if (pos == null) return false
            const line = view.state.doc.lineAt(pos)
            // `(?<!!)` skips EMBEDS (`![[...]]`): clicking one while editing must not
            // navigate to it as a note (it's rendered media, not a link).
            for (const m of line.text.matchAll(/(?<!!)\[\[([^\]]+?)\]\]/g)) {
                const s = line.from + (m.index ?? 0),
                    en = s + m[0].length
                if (pos >= s && pos <= en) {
                    const { target, heading } = parseWikilink(m[1])
                    // `[[Folder/]]` names a folder: show it in the file tree.
                    if (isFolderTarget(target)) {
                        revealFolder(target)
                        return true
                    }
                    // Wikilinks are filename-based: resolve the basename to its real vault
                    // path so subfolder notes open (and highlight) correctly. An unresolved
                    // target opens as a new note at the typed name (read falls back to "").
                    const resolved = resolveNotePath(target, opts.noteNames())
                    // Object detail (not a bare string) so a `#heading` anchor rides along —
                    // App routes it through pendingAnchor → the opened editor scrolls to it.
                    // wikilinkOpenPath (not a bare "+ .md") so an unresolved target naming a
                    // previewable attachment (e.g. `[[Screenshot ….png]]`) opens as-is instead of
                    // routing to a blank nonexistent note (#38).
                    openNote(wikilinkOpenPath(target, resolved), heading)
                    return true
                }
            }
            // `~slug` memory references — open the memory note the slug names. Placed after the
            // wikilink scan (the two grammars can't overlap: a slug has no `[`) and before the
            // markdown-link scan. Resolve against the known memory notes so a subfoldered note
            // opens by basename too, exactly like a wikilink; an unresolved slug still opens its
            // canonical path (`.daemon/memory/<slug>.md`) rather than doing nothing.
            for (const m of line.text.matchAll(
                new RegExp(MEMORY_REF_RE.source, 'g'),
            )) {
                const s2 = line.from + (m.index ?? 0) + m[1].length
                const en = s2 + 1 + m[2].length
                if (pos >= s2 && pos <= en) {
                    const resolved = resolveMemorySlug(m[2], opts.memoryNames())
                    openNote(memoryRefPath(resolved ?? m[2]))
                    return true
                }
            }
            // markdown links [text](url) — open the destination in the browser.
            for (const m of line.text.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
                const s = line.from + (m.index ?? 0),
                    en = s + m[0].length
                if (pos >= s && pos <= en) {
                    void openExternalUrl(m[2])
                    return true
                }
            }
            // bare (inexplicit) URLs — a plain https://… typed without link syntax.
            for (const { start, end, url } of findBareUrls(line.text)) {
                if (pos >= line.from + start && pos <= line.from + end) {
                    void openExternalUrl(url)
                    return true
                }
            }
            return false
        },
    })
}
