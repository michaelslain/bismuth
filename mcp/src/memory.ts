// The per-session memory tools (remember / recall / forget), exposed by the Bismuth MCP
// server ONLY when the daemon is enabled for this vault — terminal.ts injects
// BISMUTH_MEMORY_DIR, which the MCP child inherits. They delegate to the shared
// @bismuth/memory graph, so these tools, the daemon writer, and the relay collect-hook all
// read/write ONE note format against <vault>/.daemon/memory.
import { writeNote, deleteNote, readNote, query, parseNoteRef, type NoteType, type MemoryNote } from "@bismuth/memory";

/** The active vault's memory dir, or null when the daemon is disabled / not a Bismuth session. */
export function memoryDir(): string | null {
  return process.env.BISMUTH_MEMORY_DIR || null;
}

const today = (): string => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export async function remember(
  args: { name: string; type?: string; tags?: string[]; content: string; folder?: string },
  dir: string,
): Promise<{ ok: true; name: string }> {
  const folder = args.folder || undefined;
  const date = today();
  // Preserve an existing note's type/created when overwriting (matches the old behavior).
  const existing = await readNote(args.name, dir, folder);
  await writeNote(
    args.name,
    {
      type: (args.type as NoteType) ?? existing?.frontmatter.type ?? "fact",
      tags: args.tags ?? existing?.frontmatter.tags ?? [],
      created: existing?.frontmatter.created ?? date,
      updated: date,
    },
    args.content,
    dir,
    folder,
  );
  return { ok: true, name: folder ? `${folder}/${args.name}` : args.name };
}

export async function recall(
  args: { query: string; folder?: string },
  dir: string,
): Promise<{ ok: true; count: number; notes: MemoryNote[] }> {
  const results = await query(args.query, dir, args.folder || undefined);
  return { ok: true, count: results.length, notes: results };
}

export async function forget(args: { name: string }, dir: string): Promise<{ ok: boolean; name: string }> {
  const ref = parseNoteRef(args.name);
  const deleted = await deleteNote(ref.name, dir, ref.folder);
  return { ok: deleted, name: args.name };
}
