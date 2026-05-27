import { join, dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { parseFrontmatter } from "./frontmatter";
import type { TreeEntry } from "./graph";

export async function listMarkdown(root: string): Promise<string[]> {
  const glob = new Bun.Glob("**/*.md");
  const out: string[] = [];
  for await (const rel of glob.scan({ cwd: root, dot: false })) out.push(rel);
  return out;
}

/** Like {@link listMarkdown}, but reads each note's `icon` frontmatter so the sidebar can render it. */
export async function listMarkdownWithIcons(root: string): Promise<TreeEntry[]> {
  const paths = await listMarkdown(root);
  return Promise.all(
    paths.map(async (path) => {
      const { data } = parseFrontmatter(await readNote(root, path));
      return typeof data.icon === "string" ? { path, icon: data.icon } : { path };
    }),
  );
}

export async function readNote(root: string, rel: string): Promise<string> {
  return await Bun.file(join(root, rel)).text();
}

export async function writeNote(root: string, rel: string, contents: string): Promise<void> {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  await Bun.write(full, contents);
}
