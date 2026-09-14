// FileAccess backed by tauri-plugin-fs — the on-device (iPad/iOS) vault IO layer.
// Installed via setFileAccess(tauriFileAccess()) in the mobile entrypoint, it
// replaces the Bun `files.ts` default so the whole logic pipeline (graph, search,
// bases, tasks, srs) reads/writes the real device vault with no Bun/node:fs.
//
// The vault `root` is an absolute, security-scoped directory the user granted
// (see startAccessingSecurityScopedResource in the mobile entry). Paths are POSIX.
import {
    readTextFile,
    writeTextFile,
    readDir,
    stat,
} from '@tauri-apps/plugin-fs'
import type { FileAccess, FileStat } from '../../../core/src/fileAccess'
import type { TreeEntry } from '../../../core/src/graph'
import {
    isTreeListedName,
    isCompanionable,
    binaryForCompanion,
} from '../../../core/src/fileKinds'

const join = (a: string, b: string): string =>
    a.endsWith('/') ? a + b : `${a}/${b}`

/** Recursively walk the vault, invoking `onEntry` for every non-hidden file/dir. */
async function walk(
    absRoot: string,
    relDir: string,
    onEntry: (rel: string, isDir: boolean) => void,
): Promise<void> {
    let entries
    try {
        entries = await readDir(relDir ? join(absRoot, relDir) : absRoot)
    } catch {
        return // unreadable dir — skip (parity with the Bun walkDir try/catch)
    }
    for (const e of entries) {
        if (e.name.startsWith('.')) continue // skip dotfiles/.git/.obsidian like desktop
        const rel = relDir ? `${relDir}/${e.name}` : e.name
        onEntry(rel, e.isDirectory)
        if (e.isDirectory) await walk(absRoot, rel, onEntry)
    }
}

async function collectByExt(root: string, ext: string): Promise<string[]> {
    const out: string[] = []
    await walk(root, '', (rel, isDir) => {
        if (!isDir && rel.endsWith(ext)) out.push(rel)
    })
    return out
}

// File types shown in the sidebar tree — mirrors core/src/files.ts's listTree, whose extension
// set (md/draw/sheet/yaml/yml + images/PDFs) lives in fileKinds.ts's isTreeListedName. A base is a
// `type: base` md file, not a distinct extension, so `.base` is deliberately absent.
function isTreeFile(path: string): boolean {
    // Skip generated .draw export sidecars first, same as files.ts does near the top
    // of its own filter — otherwise isTreeListedName below would re-admit a
    // `foo.draw.png` export artifact as though it were a plain image.
    if (path.endsWith('.draw.png') || path.endsWith('.draw.pdf')) return false
    return isTreeListedName(path)
}

export function tauriFileAccess(): FileAccess {
    return {
        listMarkdown: root => collectByExt(root, '.md'),

        listTree: async root => {
            const out: TreeEntry[] = []
            await walk(root, '', (path, isDir) => {
                if (isDir) out.push({ path, kind: 'dir' })
                else if (isTreeFile(path)) out.push({ path, kind: 'file' })
            })
            // Mirrors files.ts's listTree: hide a binary's own companion note (`<file>.md`) and
            // ink sidecar (`<file>.draw`) when `<file>` itself is a companionable binary present
            // in this same listing — the binary's row stands for both. An orphan sidecar (the
            // binary was deleted elsewhere) has no such sibling and stays visible.
            const present = new Set(
                out.filter(e => e.kind === 'file').map(e => e.path),
            )
            return out.filter(e => {
                if (e.kind !== 'file') return true
                if (e.path.endsWith('.md')) {
                    const binary = binaryForCompanion(e.path)
                    return !(binary && present.has(binary))
                }
                if (e.path.endsWith('.draw')) {
                    const binary = e.path.slice(0, -'.draw'.length)
                    return !(isCompanionable(binary) && present.has(binary))
                }
                return true
            })
        },

        readNote: (root, rel) => readTextFile(join(root, rel)),
        writeNote: (root, rel, contents) =>
            writeTextFile(join(root, rel), contents),

        statNote: async (root, rel): Promise<FileStat | null> => {
            try {
                const st = await stat(join(root, rel))
                const mtimeMs = st.mtime ? st.mtime.getTime() : 0
                const birthtimeMs = st.birthtime ? st.birthtime.getTime() : 0
                return {
                    size: st.size,
                    mtimeMs,
                    ctimeMs: birthtimeMs,
                    birthtimeMs,
                }
            } catch {
                return null
            }
        },

        // iOS has no realpath via the plugin; cycle detection on the logical path is
        // sufficient (symlink-vaults aren't a mobile concern). Best-effort identity.
        realPath: async path => path,
    }
}
