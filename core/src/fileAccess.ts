// The single IO seam for the whole logic pipeline. Every module that builds
// graphs, runs search/replace, or feeds the Bases engine reads/writes the vault
// through this interface — never `files.ts` / `Bun` / `node:fs` directly.
//
// Desktop/Bun: the lazy default below pulls the real `files.ts` impl on first use
// (a dynamic import, so `Bun.Glob` & `node:fs` stay OUT of the static dep graph —
// the WebView bundle never includes them). iPad: the mobile entrypoint calls
// `setFileAccess()` with a `tauri-plugin-fs`-backed impl before the first read,
// so the dynamic import never fires and no Bun-coupled code loads.
import type { TreeEntry } from './graph'

/** Minimal file stat the Bases feed needs (size + timestamps in ms). */
export interface FileStat {
    size: number
    mtimeMs: number
    ctimeMs: number
    birthtimeMs: number
}

export interface FileAccess {
    /** All markdown files under the vault, vault-relative. */
    listMarkdown(root: string): Promise<string[]>
    /** Every `*.base.jsonl` base under the vault, vault-relative; dot-dirs skipped like listMarkdown. */
    listBases(root: string): Promise<string[]>
    /** The full file/folder tree (md + .base + .sheet + .draw + folders) for the sidebar. */
    listTree(root: string): Promise<TreeEntry[]>
    /** Read one note's UTF-8 contents (vault-relative path). */
    readNote(root: string, rel: string): Promise<string>
    /** Write one note's UTF-8 contents (vault-relative path). */
    writeNote(root: string, rel: string, contents: string): Promise<void>
    /** Read one file's raw bytes (vault-relative path). Rejects when the file is missing. */
    readBinary(root: string, rel: string): Promise<Uint8Array>
    /** Write raw bytes to a vault-relative path, creating parent dirs. Atomic where the platform
     *  allows: a reader never sees a half-written file. */
    writeBinary(root: string, rel: string, bytes: Uint8Array): Promise<void>
    /** Append bytes to an existing file that must still be `expectedSize` long (rejects otherwise).
     *  Optional: a PDF increment then falls back to writeBinary of the whole file. */
    appendBinary?(root: string, rel: string, bytes: Uint8Array, expectedSize: number): Promise<void>
    /** Stat one note; resolves null if it vanished since listing. */
    statNote(root: string, rel: string): Promise<FileStat | null>
    /** Entry names (files and folders, no path prefix) directly inside a vault-relative dir, dotfiles
     *  included. Resolves [] when the dir is missing or unreadable; never throws. */
    listDir(root: string, rel: string): Promise<string[]>
    /** Canonicalize an absolute path for cycle detection; best-effort (returns input on failure). */
    realPath(path: string): Promise<string>
}

let access: FileAccess | null = null

/** Install the active file access (e.g. a tauri-plugin-fs one on iOS). Desktop
 *  and tests never call this and fall through to the lazy `files.ts` default. */
export function setFileAccess(a: FileAccess): void {
    access = a
}

/** Resolve the active FileAccess, lazily building the Bun/`files.ts`-backed
 *  default the first time it's needed. The dynamic imports keep `files.ts`,
 *  `node:fs`, and `node:path` out of this module's static dependency graph. */
export async function getFileAccess(): Promise<FileAccess> {
    if (access) return access
    const files = await import('./files')
    const { stat, realpath, readdir } = await import('node:fs/promises')
    const { join } = await import('node:path')
    access = {
        listMarkdown: files.listMarkdown,
        listBases: files.listBases,
        listTree: files.listTree,
        readNote: files.readNote,
        writeNote: files.writeNote,
        readBinary: files.readBinary,
        writeBinary: files.writeBinaryAtomic,
        appendBinary: files.appendBinary,
        statNote: async (root, rel) => {
            const st = await stat(join(root, rel)).catch(() => null)
            if (!st) return null
            return {
                size: st.size,
                mtimeMs: st.mtimeMs,
                ctimeMs: st.ctimeMs,
                birthtimeMs: st.birthtimeMs || st.ctimeMs,
            }
        },
        listDir: async (root, rel) => readdir(join(root, rel)).catch(() => []),
        realPath: async path => realpath(path).catch(() => path),
    }
    return access
}
