import { statSync } from "node:fs";
import { join } from "node:path";
import { listMarkdown, readNote } from "./files";
import { parseFrontmatter } from "./frontmatter";
import { extractTags } from "./tags";
import { extractWikilinks } from "./wikilinks";
import type { FileMeta, Row } from "./bases/types";

function fileMeta(root: string, rel: string, tags: string[], links: string[]): FileMeta {
  // Parse folder and filename from path
  const lastSlash = rel.lastIndexOf("/");
  const folder = lastSlash >= 0 ? rel.slice(0, lastSlash) : "";
  const filename = lastSlash >= 0 ? rel.slice(lastSlash + 1) : rel;

  // Parse name and extension from filename
  const lastDot = filename.lastIndexOf(".");
  const name = lastDot >= 0 ? filename.slice(0, lastDot) : filename;
  const ext = lastDot >= 0 ? filename.slice(lastDot + 1) : "";

  // Get file stats if available
  let size = 0, ctime = 0, mtime = 0;
  try {
    const stat = statSync(join(root, rel));
    size = stat.size;
    ctime = stat.birthtimeMs || stat.ctimeMs;
    mtime = stat.mtimeMs;
  } catch {
    // file may have been deleted since list
  }

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
