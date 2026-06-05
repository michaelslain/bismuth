// The single IO seam for the whole logic pipeline. Every module that builds
// graphs, runs search/replace, or feeds the Bases engine reads/writes the vault
// through this interface — never `files.ts` / `Bun` / `node:fs` directly.
//
// Desktop/Bun: the lazy default below pulls the real `files.ts` impl on first use
// (a dynamic import, so `Bun.Glob` & `node:fs` stay OUT of the static dep graph —
// the WebView bundle never includes them). iPad: the mobile entrypoint calls
// `setFileAccess()` with a `tauri-plugin-fs`-backed impl before the first read,
// so the dynamic import never fires and no Bun-coupled code loads.
import type { TreeEntry } from "./graph";

/** Minimal file stat the Bases feed needs (size + timestamps in ms). */
export interface FileStat {
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  birthtimeMs: number;
}

export interface FileAccess {
  /** All markdown files under the vault, vault-relative. */
  listMarkdown(root: string): Promise<string[]>;
  /** The full file/folder tree (md + .base + .sheet + .draw + folders) for the sidebar. */
  listTree(root: string): Promise<TreeEntry[]>;
  /** Read one note's UTF-8 contents (vault-relative path). */
  readNote(root: string, rel: string): Promise<string>;
  /** Write one note's UTF-8 contents (vault-relative path). */
  writeNote(root: string, rel: string, contents: string): Promise<void>;
  /** All `.base` files under the vault, vault-relative. */
  listBases(root: string): Promise<string[]>;
  /** Stat one note; resolves null if it vanished since listing. */
  statNote(root: string, rel: string): Promise<FileStat | null>;
  /** Canonicalize an absolute path for cycle detection; best-effort (returns input on failure). */
  realPath(path: string): Promise<string>;
}

let access: FileAccess | null = null;

/** Install the active file access (e.g. a tauri-plugin-fs one on iOS). Desktop
 *  and tests never call this and fall through to the lazy `files.ts` default. */
export function setFileAccess(a: FileAccess): void {
  access = a;
}

/** Resolve the active FileAccess, lazily building the Bun/`files.ts`-backed
 *  default the first time it's needed. The dynamic imports keep `files.ts`,
 *  `node:fs`, and `node:path` out of this module's static dependency graph. */
export async function getFileAccess(): Promise<FileAccess> {
  if (access) return access;
  const files = await import("./files");
  const { stat } = await import("node:fs/promises");
  const { realpath } = await import("node:fs/promises");
  const { join } = await import("node:path");
  access = {
    listMarkdown: files.listMarkdown,
    listTree: files.listTree,
    readNote: files.readNote,
    writeNote: files.writeNote,
    listBases: files.listBases,
    statNote: async (root, rel) => {
      const st = await stat(join(root, rel)).catch(() => null);
      if (!st) return null;
      return {
        size: st.size,
        mtimeMs: st.mtimeMs,
        ctimeMs: st.ctimeMs,
        birthtimeMs: st.birthtimeMs || st.ctimeMs,
      };
    },
    realPath: async (path) => realpath(path).catch(() => path),
  };
  return access;
}
