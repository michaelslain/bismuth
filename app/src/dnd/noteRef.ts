// app/src/dnd/noteRef.ts
// Pure helpers shared by the drag-drop drop handlers (Row 74): turning a dragged
// note path into a wikilink / chat reference, and reading the note path back off a
// DragDescriptor regardless of whether the drag started from the sidebar or a tab/pane.
// Kept dependency-light (the DragDescriptor type + the CHAT_PREFIX string constant) so
// it's unit-testable headlessly.
import type { DragDescriptor } from './viewDrag'
import type { Zone } from './geometry'
import { CHAT_PREFIX } from '../tabIds'
import { isImagePath, isPdfPath } from '../../../core/src/fileKinds'
import { linkTargetFor } from '../../../core/src/linkTarget'

/** True for a markdown note path (the only thing a `[[wikilink]]` / chat mention makes sense for). */
export function isMarkdown(path: string): boolean {
    return /\.(md|markdown)$/i.test(path)
}

/** The wikilink-visible name of a note path: its basename with the markdown extension stripped
 *  (wikilinks resolve by filename, not path — `Projects/Gamma.md` → `Gamma`). */
export function noteNameFromPath(path: string): string {
    const base = path.split('/').pop() ?? path
    return base.replace(/\.(md|markdown)$/i, '')
}

/** `[[Name]]` for a note path — inserted into an editor (drop-to-link) or a chat draft
 *  (drop-to-mention). `noteIds` are every note's graph id (vault path, `.md` stripped) — when more
 *  than one shares `path`'s basename, `linkTargetFor` path-qualifies the link instead of writing a
 *  bare name that would resolve ambiguously. */
export function wikilinkFor(path: string, noteIds: Iterable<string>): string {
    const id = path.replace(/\.md$/i, '')
    return `[[${linkTargetFor(id, noteIds)}]]`
}

/** The filesystem path a descriptor would MOVE (Row 73): notes + folders from the sidebar, and a
 *  tab/pane that carries its file path. Null when the descriptor isn't backed by a vault path
 *  (e.g. a chat/terminal/graph tab). Extension-agnostic — any file or folder can be moved. */
export function descriptorMovePath(d: DragDescriptor | null): string | null {
    if (!d) return null
    if (d.kind === 'note' || d.kind === 'folder') return d.path
    if (d.kind === 'tab' || d.kind === 'pane') return d.path ?? null
    return null
}

/** The path a descriptor can be REFERENCED by in an EDITOR (Row 74 drop-to-[[wikilink]]): a markdown
 *  note only — folders and non-markdown files (`.sheet`/`.draw`/…) return null. */
export function descriptorNotePath(d: DragDescriptor | null): string | null {
    if (!d || d.kind === 'folder') return null
    const p = descriptorMovePath(d)
    return p && isMarkdown(p) ? p : null
}

/** The path a descriptor can REFERENCE inside a CHAT (Row 74 + Row 79b): ANY file or folder that
 *  carries a vault path — a sidebar note/folder, or a path-backed tab/pane. Broader than
 *  descriptorNotePath (markdown notes only, for editor wikilink drops): a chat mention just NAMES
 *  the file for the model to pull in, so non-markdown files and folders are fair game too. Currently
 *  identical to descriptorMovePath, kept as its own name so a chat-reference call site reads clearly. */
export function descriptorChatRefPath(d: DragDescriptor | null): string | null {
    return descriptorMovePath(d)
}

/** The path a descriptor can be EMBEDDED as an image/PDF into a note (Row 74's binary-drop
 *  variant of drop-to-[[wikilink]]): a tree image/PDF file, or a path-backed tab/pane showing
 *  one. Null for markdown notes, folders, and any other file kind — `descriptorNotePath` covers
 *  the markdown case, and the two never overlap. */
export function descriptorEmbedPath(d: DragDescriptor | null): string | null {
    const p = descriptorMovePath(d)
    if (!p) return null
    return isImagePath(p) || isPdfPath(p) ? p : null
}

/** `![[basename]]` for a binary path — the markdown embed syntax, resolved (like a wikilink) by
 *  filename rather than full path. Unlike `wikilinkFor`, the extension is KEPT: an embed target
 *  must still resolve to the actual image/PDF file on disk, not a note-style stripped name. */
export function embedFor(path: string): string {
    const base = path.split('/').pop() ?? path
    return `![[${base}]]`
}

/** True when dropping `descriptor` onto a pane showing `content` should insert a CHAT REFERENCE
 *  (a `[[mention]]` in that chat's composer) rather than split/graft the pane: the pane is a chat and
 *  the payload carries a referenceable path. This is the SHARED predicate the drop HANDLER (App) and
 *  the drop-AFFORDANCE highlight (PaneTree) both call — so the split-quadrant overlay is suppressed
 *  EXACTLY when the drop won't split (Row 74: no more confusing four-quadrant highlight over a chat). */
export function isChatReferenceDrop(
    content: string | undefined,
    descriptor: DragDescriptor | null,
): boolean {
    return (
        !!content &&
        content.startsWith(CHAT_PREFIX) &&
        descriptorChatRefPath(descriptor) !== null
    )
}

/** True when dropping `descriptor` onto a pane showing `content`, in `zone`, should insert an
 *  editor reference (a `[[wikilink]]` or `![[embed]]` at the drop point, Row 74c) rather than
 *  split/graft the pane: `content` is a markdown note, `zone` is `center`, `hasEditor` is true (the
 *  pane hosts a LIVE CodeMirror view — a `type: base` note has none), and the payload is a
 *  referenceable note or embeddable file that isn't the pane's own content. This is the SHARED
 *  predicate the drop HANDLER (App) and the drop-AFFORDANCE cue (PaneLeaf) both call, mirroring
 *  `isChatReferenceDrop` for the note-editor case. */
export function isEditorReferenceDrop(
    content: string | undefined,
    descriptor: DragDescriptor | null,
    zone: Zone,
    hasEditor: boolean,
): boolean {
    if (!content || !isMarkdown(content) || zone !== 'center') return false
    if (!hasEditor) return false
    const refPath = descriptorNotePath(descriptor) ?? descriptorEmbedPath(descriptor)
    return refPath !== null && refPath !== content
}

/** Whether a pane drop uses the large reference zone (`referenceZoneForPoint`) instead of the
 *  split-replace box (`dropZoneForPoint`, Row 74's center box): only a SIDEBAR tree row
 *  (`kind === 'note'`) with a linkable path (`descriptorNotePath` ?? `descriptorEmbedPath`), over
 *  a pane hosting a live note editor. Tab/pane drags keep `dropZoneForPoint` so pane rearranging
 *  isn't regressed by the much larger reference band. */
export function usesReferenceGeometry(
    descriptor: DragDescriptor | null,
    hasEditor: boolean,
): boolean {
    if (!hasEditor || !descriptor || descriptor.kind !== 'note') return false
    return (
        descriptorNotePath(descriptor) !== null ||
        descriptorEmbedPath(descriptor) !== null
    )
}
