import { stat, type Stats } from "node:fs/promises";
import { join } from "node:path";
import { listMarkdown, readNote } from "./files";
import { parseFrontmatter } from "./frontmatter";
import { extractTags } from "./tags";
import { extractWikilinks } from "./wikilinks";
import { pathParts } from "./vault";
import type { FileMeta, Row } from "./bases/types";

function fileMeta(rel: string, st: Stats | null, tags: string[], links: string[]): FileMeta {
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

export async function buildVaultRows(root: string): Promise<Row[]> {
  const files = await listMarkdown(root);
  // Read body and stat each file concurrently (one Promise.all over both async calls)
  // instead of a synchronous statSync per file in the build loop. stat() resolves to null
  // on failure (file deleted since list) — matching the old try/catch-to-zero behavior.
  const contents = await Promise.all(
    files.map(async (rel) => {
      const [raw, st] = await Promise.all([
        readNote(root, rel),
        stat(join(root, rel)).catch(() => null),
      ]);
      return { rel, raw, st };
    })
  );
  const rows: Row[] = [];
  for (const { rel, raw, st } of contents) {
    const { data, body } = parseFrontmatter(raw);
    const tags = extractTags(data, body);
    const links = extractWikilinks(raw);
    rows.push({ file: fileMeta(rel, st, tags, links), note: data, formula: {} });
  }
  return rows;
}
