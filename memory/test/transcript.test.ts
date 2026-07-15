import { describe, expect, test } from "bun:test";
import {
  extractTurns,
  trimToBudget,
  buildAutoNoteBody,
  PER_MESSAGE_CHARS,
  MAX_BODY_CHARS,
  type TranscriptEntry,
} from "../src/transcript";

const user = (text: string): TranscriptEntry => ({ type: "user", message: { role: "user", content: text } });
const assistant = (text: string): TranscriptEntry => ({
  type: "assistant",
  message: { role: "assistant", content: [{ type: "text", text }] },
});
/** A tool-result carrier: a `user` envelope with NO top-level text blocks. */
const toolResult = (): TranscriptEntry => ({
  type: "user",
  message: { role: "user", content: [{ type: "tool_result", text: undefined } as never] },
});
const toolUse = (): TranscriptEntry => ({
  type: "assistant",
  message: { role: "assistant", content: [{ type: "tool_use" } as never] },
});

describe("extractTurns", () => {
  test("pairs a prompt with everything Claude said across tool round-trips as ONE turn", () => {
    const turns = extractTurns([
      user("fix the bug"),
      assistant("Looking at it."),
      toolUse(),
      toolResult(), // never a false boundary
      assistant("Found it — patched."),
      user("thanks, now add a test"),
      assistant("Done."),
    ]);
    expect(turns).toHaveLength(2);
    expect(turns[0].user).toBe("fix the bug");
    expect(turns[0].claude).toBe("Looking at it.\n\nFound it — patched.");
    expect(turns[1].user).toBe("thanks, now add a test");
    expect(turns[1].claude).toBe("Done.");
  });

  test("dedupes adjacent byte-identical assistant chunks", () => {
    const turns = extractTurns([user("go"), assistant("same"), assistant("same"), assistant("different")]);
    expect(turns[0].claude).toBe("same\n\ndifferent");
  });

  test("clamps a single oversized message with a marker", () => {
    const big = "x".repeat(PER_MESSAGE_CHARS + 500);
    const turns = extractTurns([user("q"), assistant(big)]);
    expect(turns[0].claude.length).toBeLessThanOrEqual(PER_MESSAGE_CHARS + 8);
    expect(turns[0].claude.endsWith("[…]")).toBe(true);
  });

  test("strips injected memory/editor-context blocks from user prompts", () => {
    const turns = extractTurns([
      user("<editor-context>\nActive file: a.md\n</editor-context>\n\nreal question"),
      assistant("answer"),
    ]);
    expect(turns[0].user).toBe("real question");
  });

  test("strips the demarcated <bismuth-memory> recall envelope (isolation: 3rd brain never re-collected)", () => {
    const injected = [
      "<bismuth-memory>",
      "The notes below are recalled from THIS VAULT'S Bismuth memory — a store SEPARATE from your own.",
      "",
      "# Memories",
      "",
      "## auth (fact) [security]",
      "JWT tokens expire in 15 minutes.",
      "</bismuth-memory>",
      "",
      "what expiry should I use?",
    ].join("\n");
    const turns = extractTurns([user(injected), assistant("15 minutes, per the note.")]);
    // Only the human's real prompt survives — no wrapper, no recalled memory content.
    expect(turns[0].user).toBe("what expiry should I use?");
    expect(turns[0].user).not.toContain("bismuth-memory");
    expect(turns[0].user).not.toContain("JWT tokens");
  });

  test("back-compat: still fires the legacy BARE '# Memories' guard (best-effort, pre-envelope transcripts)", () => {
    // The legacy bare-block guard is inherently PARTIAL — a pre-envelope `# Memories` block had no
    // closing delimiter, so there's no robust way to tell where recalled memory ends and the user's
    // prompt begins (exactly the ambiguity the <bismuth-memory> envelope now removes). We keep the
    // guard for transcripts recorded before this change: it still drops the `# Memories` marker and
    // preserves the human's real prompt. New sessions use the envelope, fully stripped above.
    const legacy = "# Memories\n\n## n (fact) []\nold recalled fact\n\nthe actual question";
    const turns = extractTurns([user(legacy), assistant("ok")]);
    expect(turns[0].user).not.toContain("# Memories");
    expect(turns[0].user).toContain("the actual question");
  });
});

describe("trimToBudget", () => {
  test("keeps whole turns and inserts one omission marker, never splitting a turn", () => {
    const turns = Array.from({ length: 40 }, (_, i) => ({
      user: `question ${i} ` + "u".repeat(300),
      claude: `answer ${i} ` + "c".repeat(300),
    }));
    const trimmed = trimToBudget(turns, 5000);
    const marker = trimmed.find((t) => t.claude.includes("omitted"));
    expect(marker).toBeDefined();
    // Every surviving real turn is intact (both sides present, unsliced).
    for (const t of trimmed) {
      if (t === marker) continue;
      expect(t.user.startsWith("question ")).toBe(true);
      expect(t.claude.startsWith("answer ")).toBe(true);
    }
    // First and last real turns survive (openings set context, endings carry conclusions).
    expect(trimmed[0].user.startsWith("question 0 ")).toBe(true);
    expect(trimmed[trimmed.length - 1].user.startsWith("question 39 ")).toBe(true);
  });

  test("no-op under budget", () => {
    const turns = [{ user: "a", claude: "b" }];
    expect(trimToBudget(turns)).toBe(turns);
  });
});

describe("buildAutoNoteBody", () => {
  test("renders the paired format", () => {
    const body = buildAutoNoteBody([user("what is bismuth? ".repeat(3)), assistant("a knowledge tool ".repeat(3))]);
    expect(body).toContain("## Turn 1");
    expect(body).toContain("**You:** what is bismuth?");
    expect(body).toContain("**Claude:** a knowledge tool");
  });

  test("MIN check sums BOTH roles — a tiny prompt with real work is kept", () => {
    const body = buildAutoNoteBody([user("continue"), assistant("I refactored the entire parser and added twelve tests.")]);
    expect(body).not.toBeNull();
  });

  test("drops trivial and cron-fired sessions", () => {
    expect(buildAutoNoteBody([user("hi"), assistant("hey")])).toBeNull();
    expect(buildAutoNoteBody([user("[Cron: dream] consolidate memory now please and thanks"), assistant("done, consolidated everything")])).toBeNull();
  });

  test("respects the whole-body cap", () => {
    const entries: TranscriptEntry[] = [];
    for (let i = 0; i < 60; i++) {
      entries.push(user(`q${i} ` + "u".repeat(400)), assistant(`a${i} ` + "c".repeat(400)));
    }
    const body = buildAutoNoteBody(entries)!;
    expect(body.length).toBeLessThanOrEqual(MAX_BODY_CHARS + 200);
    expect(body).toContain("omitted");
  });

  test("SDK SessionMessage-shaped input produces identical output to raw JSONL shape", () => {
    const raw: TranscriptEntry[] = [user("hello there friend of mine"), assistant("greetings, wonderful human being")];
    // SDK SessionMessages have the same {type, message:{role, content}} shape.
    const sdk: TranscriptEntry[] = JSON.parse(JSON.stringify(raw));
    expect(buildAutoNoteBody(sdk)).toBe(buildAutoNoteBody(raw));
  });
});
