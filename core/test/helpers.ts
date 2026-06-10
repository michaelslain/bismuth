import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeNote } from "../src/files";

/**
 * Build a throwaway vault from a `{ relativePath: content }` map in a fresh
 * tmpdir (parent dirs created as needed). Returns the vault root. Shared by the
 * search/replace tests so the fixture lives in one place.
 */
export function makeVault(files: Record<string, string>, prefix = "oa-vault-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}

/**
 * Build a throwaway sample vault + memory in tmpdirs, mirroring the notes the
 * server/cli tests assert against. Each call is isolated, so tests that mutate
 * the vault (writes, backups) can't bleed into one another.
 */
export async function makeSampleVault(): Promise<{ vault: string; memory: string }> {
  const vault = mkdtempSync(join(tmpdir(), "oa-vault-"));
  const memory = mkdtempSync(join(tmpdir(), "oa-memory-"));

  await writeNote(vault, "essay.md", "# Essay\n\nReligion and historical materialism.\n");
  await writeNote(
    vault,
    "housing.md",
    "---\nstatus: in-progress\npriority: 1\ntags: [logistics]\n---\n# Housing\n\nSigned the lease.\n",
  );
  await writeNote(vault, "internship.md", "# Internship\n\nApplying. Depends on [[housing]].\n");

  await writeNote(memory, "michael-profile.md", "Profile of the user. He is working on [[internship]] and [[essay]].\n");

  return { vault, memory };
}
