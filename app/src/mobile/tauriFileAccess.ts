// FileAccess backed by tauri-plugin-fs — the on-device (iPad/iOS) vault IO layer.
// Installed via setFileAccess(tauriFileAccess()) in the mobile entrypoint, it
// replaces the Bun `files.ts` default so the whole logic pipeline (graph, search,
// bases, tasks, srs) reads/writes the real device vault with no Bun/node:fs.
//
// The vault `root` is an absolute, security-scoped directory the user granted
// (see startAccessingSecurityScopedResource in the mobile entry). Paths are POSIX.
import { readTextFile, writeTextFile, readDir, stat } from "@tauri-apps/plugin-fs";
import type { FileAccess, FileStat } from "../../../core/src/fileAccess";
import type { TreeEntry } from "../../../core/src/graph";

const join = (a: string, b: string): string => (a.endsWith("/") ? a + b : `${a}/${b}`);

/** Recursively walk the vault, invoking `onEntry` for every non-hidden file/dir. */
async function walk(
  absRoot: string,
  relDir: string,
  onEntry: (rel: string, isDir: boolean) => void,
): Promise<void> {
  let entries;
  try {
    entries = await readDir(relDir ? join(absRoot, relDir) : absRoot);
  } catch {
    return; // unreadable dir — skip (parity with the Bun walkDir try/catch)
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue; // skip dotfiles/.git/.obsidian like desktop
    const rel = relDir ? `${relDir}/${e.name}` : e.name;
    onEntry(rel, e.isDirectory);
    if (e.isDirectory) await walk(absRoot, rel, onEntry);
  }
}

async function collectByExt(root: string, ext: string): Promise<string[]> {
  const out: string[] = [];
  await walk(root, "", (rel, isDir) => {
    if (!isDir && rel.endsWith(ext)) out.push(rel);
  });
  return out;
}

/** File types shown in the sidebar tree (mirrors the desktop listTree set). */
const TREE_EXTS = [".md", ".base", ".sheet", ".draw"];

export function tauriFileAccess(): FileAccess {
  return {
    listMarkdown: (root) => collectByExt(root, ".md"),
    listBases: (root) => collectByExt(root, ".base"),

    listTree: async (root) => {
      const out: TreeEntry[] = [];
      await walk(root, "", (path, isDir) => {
        if (isDir) out.push({ path, kind: "dir" });
        else if (TREE_EXTS.some((x) => path.endsWith(x))) out.push({ path, kind: "file" });
      });
      return out;
    },

    readNote: (root, rel) => readTextFile(join(root, rel)),
    writeNote: (root, rel, contents) => writeTextFile(join(root, rel), contents),

    statNote: async (root, rel): Promise<FileStat | null> => {
      try {
        const st = await stat(join(root, rel));
        const mtimeMs = st.mtime ? st.mtime.getTime() : 0;
        const birthtimeMs = st.birthtime ? st.birthtime.getTime() : 0;
        return { size: st.size, mtimeMs, ctimeMs: birthtimeMs, birthtimeMs };
      } catch {
        return null;
      }
    },

    // iOS has no realpath via the plugin; cycle detection on the logical path is
    // sufficient (symlink-vaults aren't a mobile concern). Best-effort identity.
    realPath: async (path) => path,
  };
}
