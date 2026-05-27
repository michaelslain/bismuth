import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeNote } from "../src/files";

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
