import { getFileAccess, type FileStat } from "./fileAccess";
import { parseFrontmatter } from "./frontmatter";
import { extractTags } from "./tags";
import { extractWikilinks } from "./wikilinks";
import { pathParts } from "./vault";
import type { FileMeta, Row } from "./bases/types";

function fileMeta(rel: string, st: FileStat | null, tags: string[], links: string[]): FileMeta {
  const { name, ext, folder } = pathParts(rel);

  // Use file stats if available (null when the file was deleted since the list).
  let size = 0, ctime = 0, mtime = 0;
  if (st) {
    size = st.size;
    ctime = st.birthtimeMs || st.ctimeMs;
    mtime = st.mtimeMs;
  }

  return { name, basename: name, path: rel, folder, ext, size, ctime, mtime, tags, links };
}

/** Build the single feed Row for one note from its raw content + stat. Shared by the
 *  full-vault build and the incremental patch so a patched row is byte-identical to a
 *  rebuilt one. */
function rowFor(rel: string, raw: string, st: FileStat | null): Row {
  const { data, body } = parseFrontmatter(raw);
  const tags = extractTags(data, body);
  const links = extractWikilinks(raw);
  return { file: fileMeta(rel, st, tags, links), note: data, formula: {} };
}

export async function buildVaultRows(root: string): Promise<Row[]> {
  const { listMarkdown, readNote, statNote } = await getFileAccess();
  const files = await listMarkdown(root);
  // Read body and stat each file concurrently (one Promise.all over both async calls)
  // instead of a synchronous statSync per file in the build loop. statNote() resolves to
  // null on failure (file deleted since list) — matching the old try/catch-to-zero behavior.
  const contents = await Promise.all(
    files.map(async (rel) => {
      const [raw, st] = await Promise.all([
        readNote(root, rel),
        statNote(root, rel),
      ]);
      return { rel, raw, st };
    })
  );
  return contents.map(({ rel, raw, st }) => rowFor(rel, raw, st));
}

/**
 * Incrementally patch the cached vault rows feed for the changed `paths` instead of
 * dropping it and re-walking + re-parsing the whole vault on the next base render (the
 * ~400ms cold cost paid after every note edit — the single biggest reason a base "loads
 * slowly" right after you type). Mirrors updateSearchIndex(): re-parse only the changed
 * notes and splice them into the cached Row[] in place, keeping every other row untouched.
 *
 * Falls back to a full invalidate (returns false) when there is nothing safe to patch:
 * no cached feed yet, or a changed path is a BRAND-NEW note not already in the feed —
 * appending it would put it out of the vault's file order, so we let the next read rebuild.
 * An edited note is replaced in place and a deleted one is spliced out, both order-preserving,
 * so a content edit (the common case) yields a feed byte-identical to a full rebuild.
 */
export async function patchVaultRows(
  root: string,
  paths: string[],
  cache: { peek(): Row[] | null; patch(mutate: (rows: Row[]) => void): boolean; invalidate(): void },
): Promise<void> {
  const current = cache.peek();
  const mdPaths = paths.filter((p) => p.endsWith(".md"));
  if (!current || mdPaths.length === 0) {
    // Nothing cached (next read builds fresh) or no note changed → drop only if there
    // is a stale value that a non-.md path shouldn't have touched (there isn't). No-op.
    if (!current && mdPaths.length) cache.invalidate();
    return;
  }
  const known = new Set(current.map((r) => r.file.path));
  const { readNote, statNote } = await getFileAccess();
  // Re-parse each changed note (null row = gone from disk).
  const reparsed = await Promise.all(
    mdPaths.map(async (rel): Promise<{ rel: string; row: Row | null }> => {
      try {
        const [raw, st] = await Promise.all([readNote(root, rel), statNote(root, rel)]);
        return { rel, row: rowFor(rel, raw, st) };
      } catch {
        return { rel, row: null }; // unreadable / removed
      }
    })
  );
  // A new note (present on disk, absent from the feed) can't be inserted order-preservingly,
  // so rebuild instead of guessing its position.
  if (reparsed.some(({ rel, row }) => row !== null && !known.has(rel))) {
    cache.invalidate();
    return;
  }
  const byPath = new Map(reparsed.map(({ rel, row }) => [rel, row] as const));
  const applied = cache.patch((rows) => {
    // Walk once: replace edited rows in place, drop deleted ones, preserving order.
    for (let i = rows.length - 1; i >= 0; i--) {
      const next = byPath.get(rows[i].file.path);
      if (next === undefined) continue; // unchanged note
      if (next === null) rows.splice(i, 1); // deleted
      else rows[i] = next; // edited → in-place replace
    }
  });
  if (!applied) cache.invalidate(); // raced with an invalidation → rebuild next read
}
