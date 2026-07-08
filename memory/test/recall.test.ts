import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { tmpdir } from "os";
import { randomBytes } from "crypto";
import { rm } from "fs/promises";
import { writeNote, type MemoryNote } from "../src/graph.ts";
import { recallMemory, formatRecall } from "../src/recall.ts";

function makeTempDir(): string {
  return join(tmpdir(), `bismuth-recall-test-${randomBytes(8).toString("hex")}`);
}

const today = "2026-01-01";

describe("formatRecall", () => {
  test("produces the load-bearing '# Memories' header + per-note block", () => {
    const note: MemoryNote = {
      name: "auth-project",
      frontmatter: { type: "project", tags: ["authentication", "login"], created: today, updated: today },
      content: "JWT tokens with a 15 minute expiry.",
      backlinks: [],
    };
    const out = formatRecall([note]);
    expect(out.startsWith("# Memories\n")).toBe(true);
    expect(out).toContain("## auth-project (project) [authentication, login]");
    expect(out).toContain("JWT tokens with a 15 minute expiry.");
  });

  test("emits a Links line only when the note has backlinks", () => {
    const withLinks: MemoryNote = {
      name: "n", frontmatter: { type: "fact", tags: [], created: today, updated: today },
      content: "body", backlinks: ["other", "thing"],
    };
    expect(formatRecall([withLinks])).toContain("Links: [[other]], [[thing]]");
    const noLinks: MemoryNote = { ...withLinks, backlinks: [] };
    expect(formatRecall([noLinks])).not.toContain("Links:");
  });

  test("leads with the exact '# Memories\\n' marker (in lockstep with stripInjectedBlocks)", () => {
    // The block is injected as a separate hook_additional_context transcript attachment, which
    // buildAutoNoteBody ignores — so it never re-collects (no recall→collect amplification).
    // stripInjectedBlocks keys on this leading marker as a belt-and-suspenders guard, so keep the
    // header verbatim.
    const block = formatRecall([{
      name: "pref", frontmatter: { type: "preference", tags: ["style"], created: today, updated: today },
      content: "Be direct.", backlinks: [],
    }]);
    expect(block.startsWith("# Memories\n")).toBe(true);
  });
});

describe("recallMemory (selection logic)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = makeTempDir();
    await writeNote(
      "auth-project",
      { type: "project", tags: ["authentication", "login", "security"], created: today, updated: today },
      "The authentication service uses JWT tokens with a 15 minute expiry. Login flow lives in the security module.",
      dir,
    );
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("returns null for a blank prompt (no work, no injection)", async () => {
    expect(await recallMemory(dir, "")).toBeNull();
    expect(await recallMemory(dir, "   \n\t ")).toBeNull();
  });

  test("returns null when the prompt has no keyword overlap with any note", async () => {
    expect(await recallMemory(dir, "unrelated banana zeppelin weather")).toBeNull();
  });

  test("returns a formatted # Memories block when a note matches the prompt", async () => {
    const ctx = await recallMemory(dir, "how does the authentication login flow work");
    expect(ctx).not.toBeNull();
    expect(ctx!).toContain("# Memories");
    expect(ctx!).toContain("auth-project");
    expect(ctx!).toContain("JWT tokens");
  });

  test("honors the time budget: a generous budget still returns the match (race doesn't drop the happy path)", async () => {
    // The budget races searchMemory against a timeout — under a generous budget the search wins and
    // results come through; under a bloated/slow graph the timeout wins and recall degrades to null
    // (the critical-path guard). Here we assert the happy path survives the race.
    const ctx = await recallMemory(dir, "authentication login security", 5000);
    expect(ctx).not.toBeNull();
    expect(ctx!).toContain("auth-project");
  });

  test("excludes notes hidden from the daemon channel (visibility gate)", async () => {
    await writeNote(
      "secret-auth",
      { type: "fact", tags: ["authentication"], created: today, updated: today, visibility: "hidden" },
      "The authentication master password is hunter2.",
      dir,
    );
    const ctx = await recallMemory(dir, "authentication login security");
    expect(ctx).not.toBeNull();
    expect(ctx!).not.toContain("hunter2");
    expect(ctx!).not.toContain("secret-auth");
  });

  test("never throws on a missing memory dir — returns null", async () => {
    const gone = makeTempDir(); // never created
    // searchMemory ensureDir-creates it (empty) → no match → null; must not reject.
    expect(await recallMemory(gone, "authentication")).toBeNull();
    await rm(gone, { recursive: true, force: true });
  });
});
