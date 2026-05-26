import { join, dirname } from "node:path";
import { mkdirSync } from "node:fs";

export async function listMarkdown(root: string): Promise<string[]> {
  const glob = new Bun.Glob("**/*.md");
  const out: string[] = [];
  for await (const rel of glob.scan({ cwd: root, dot: false })) out.push(rel);
  return out;
}

export async function readNote(root: string, rel: string): Promise<string> {
  return await Bun.file(join(root, rel)).text();
}

export async function writeNote(root: string, rel: string, contents: string): Promise<void> {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  await Bun.write(full, contents);
}
