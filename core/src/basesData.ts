import { statSync } from "node:fs";
import { join } from "node:path";
import { listMarkdown, readNote } from "./files";
import { parseFrontmatter } from "./frontmatter";
import { extractTags } from "./tags";
import { extractWikilinks } from "./wikilinks";
import type { FileMeta, Row } from "./bases/types";

function fileMeta(root: string, rel: string, tags: string[], links: string[]): FileMeta {
  const slash = rel.lastIndexOf("/");
  const folder = slash >= 0 ? rel.slice(0, slash) : "";
  const filename = slash >= 0 ? rel.slice(slash + 1) : rel;
  const dot = filename.lastIndexOf(".");
  const ext = dot >= 0 ? filename.slice(dot + 1) : "";
  const name = dot >= 0 ? filename.slice(0, dot) : filename;
  let size = 0, ctime = 0, mtime = 0;
  try {
    const st = statSync(join(root, rel));
    size = st.size; ctime = st.birthtimeMs || st.ctimeMs; mtime = st.mtimeMs;
  } catch { /* file may have just been deleted */ }
  return { name, basename: name, path: rel, folder, ext, size, ctime, mtime, tags, links };
}

export async function buildVaultRows(root: string): Promise<Row[]> {
  const files = await listMarkdown(root);
  const contents = await Promise.all(
    files.map(async (rel) => ({ rel, raw: await readNote(root, rel) }))
  );
  const rows: Row[] = [];
  for (const { rel, raw } of contents) {
    const { data, body } = parseFrontmatter(raw);
    const tags = extractTags(data, body);
    const links = extractWikilinks(raw);
    rows.push({ file: fileMeta(root, rel, tags, links), note: data, formula: {} });
  }
  return rows;
}

// Also expose .base file discovery here for reuse.
export async function listBases(root: string): Promise<string[]> {
  const glob = new Bun.Glob("**/*.base");
  const out: string[] = [];
  for await (const p of glob.scan({ cwd: root, dot: false })) out.push(p);
  return out.sort();
}
