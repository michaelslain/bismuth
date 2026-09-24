// Pure, DOM-free vault-attachment-path helpers shared by a note-body image drop (Editor.tsx) and
// a kanban card image drop (bases/kanbanImageDrop.ts + bases/cardImageDrop.ts), so both land an
// attachment in the same place for the same settings.attachments.folder + note path. No framework
// or settings imports — callers pass the resolved folder string in.

/** The basename of a path, tolerant of both `/` and `\` separators (native OS paths are `\` on
 *  Windows). Returns the input unchanged when it has no separator. */
export function baseName(path: string): string {
    return path.split(/[\\/]/).pop() ?? path
}

/** Vault-relative destination for a new attachment, honoring settings.attachments.folder:
 *  "" = vault root, "." = the note's own folder, else a named subfolder. Leading/trailing slashes
 *  on the folder are stripped so a stray `folder: /attachments` still resolves vault-relative (the
 *  backend rejects absolute-looking paths). */
export function attachmentTarget(
    folder: string,
    fileName: string,
    notePath: string | null,
): string {
    const f = folder.trim().replace(/^\/+|\/+$/g, '')
    if (f === '.') {
        const slash = (notePath ?? '').lastIndexOf('/')
        return (
            (slash === -1 ? '' : (notePath ?? '').slice(0, slash + 1)) +
            fileName
        )
    }
    return f ? `${f}/${fileName}` : fileName
}
