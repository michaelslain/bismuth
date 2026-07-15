import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { tmpdir } from "os";
import { randomBytes } from "crypto";
import { rm } from "fs/promises";
import { writeNote, type MemoryNote } from "../src/graph.ts";
import { recallMemory, formatRecall, MEMORY_BLOCK_TAG } from "../src/recall.ts";
import { stripInjectedBlocks } from "../src/transcript.ts";

function makeTempDir(): string {
  return join(tmpdir(), `bismuth-recall-test-${randomBytes(8).toString("hex")}`);
}

const today = "2026-01-01";

describe("formatRecall", () => {
  test("wraps the '# Memories' block + per-note content in the demarcated envelope", () => {
    const note: MemoryNote = {
      name: "auth-project",
      frontmatter: { type: "project", tags: ["authentication", "login"], created: today, updated: today },
      content: "JWT tokens with a 15 minute expiry.",
      backlinks: [],
    };
    const out = formatRecall([note]);
    // ISOLATION: the recalled block is wrapped so a session opened in Bismuth can tell the vault's
    // 3rd brain apart from the host model's OWN native memory.
    expect(out.startsWith(`<${MEMORY_BLOCK_TAG}>`)).toBe(true);
    expect(out.trimEnd().endsWith(`</${MEMORY_BLOCK_TAG}>`)).toBe(true);
    // The `# Memories` content still lives INSIDE the envelope.
    expect(out).toContain("# Memories");
    expect(out).toContain("## auth-project (project) [authentication, login]");
    expect(out).toContain("JWT tokens with a 15 minute expiry.");
  });

  test("the banner names it as a store SEPARATE from the model's own memory (no cross-write)", () => {
    const out = formatRecall([{
      name: "n", frontmatter: { type: "fact", tags: [], created: today, updated: today },
      content: "body", backlinks: [],
    }]);
    // The demarcation must explicitly tell the model this is NOT its own memory and must not be
    // copied into it — the isolation guarantee at the injection layer.
    expect(out.toLowerCase()).toContain("separate from your own");
    expect(out).toContain("3rd brain");
    expect(out.toLowerCase()).toContain("do not copy it");
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

  test("round-trips with stripInjectedBlocks — the injected 3rd brain never survives into a note", () => {
    // ISOLATION (the recall→collect direction): whatever formatRecall injects as additionalContext
    // must be fully removed by stripInjectedBlocks before a transcript is collected, so Bismuth's
    // recalled memory can neither amplify back into Bismuth memory NOR bleed into the model's own.
    const block = formatRecall([{
      name: "pref", frontmatter: { type: "preference", tags: ["style"], created: today, updated: today },
      content: "Be direct.", backlinks: [],
    }]);
    // formatRecall keys the strip on the <bismuth-memory> envelope, in lockstep with transcript.ts.
    expect(block).toContain(`<${MEMORY_BLOCK_TAG}>`);
    const userPrompt = "how should I structure the auth module?";
    // The injected block is prepended to the user's real prompt in the recorded turn; stripping it
    // must leave ONLY what the human typed — no memory content leaks through.
    expect(stripInjectedBlocks(`${block}\n\n${userPrompt}`)).toBe(userPrompt);
    // And nothing from the recalled note survives.
    expect(stripInjectedBlocks(`${block}\n\n${userPrompt}`)).not.toContain("Be direct.");
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
