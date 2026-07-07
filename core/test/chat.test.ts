import { test, expect, describe, afterEach } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  sendMessage,
  respondPermission,
  closeChat,
  newChatId,
  chatSessionCount,
  listChatSessions,
  sessionHistoryFrames,
  stripEditorContext,
  makeUserMessage,
  abortTurn,
  extractEditorContextPaths,
  unstreamedAssistantFrames,
  type ChatFrame,
} from "../src/chat";
import { whichClaude } from "../src/claudeWhich";

// extractEditorContextPaths backs captureToMemory's visibility gate (skip capturing a session
// that touched a chat-only/hidden file) — it parses the SAME preamble format app/src/
// chatEditorContext.ts's buildEditorContextText produces, so these fixtures mirror that shape.
describe("extractEditorContextPaths (captureToMemory's visibility gate)", () => {
  test("extracts the active file", () => {
    const text = "<editor-context>\nActive file: a.md\n</editor-context>\n\nsummarize this";
    expect(extractEditorContextPaths(text)).toEqual(["a.md"]);
  });

  test("extracts open tabs (comma-separated)", () => {
    const text = "<editor-context>\nOpen tabs: a.md, b.md, private/c.md\n</editor-context>\n\nhi";
    expect(extractEditorContextPaths(text)).toEqual(["a.md", "b.md", "private/c.md"]);
  });

  test("extracts the selection's source file", () => {
    const text = "<editor-context>\nCurrent selection (from secret.md):\n```\nhello\n```\n</editor-context>\n\nwhat is this?";
    expect(extractEditorContextPaths(text)).toEqual(["secret.md"]);
  });

  test("extracts all three when present, active file first", () => {
    const text =
      "<editor-context>\nActive file: a.md\nOpen tabs: a.md, b.md\nCurrent selection (from b.md):\n```\nx\n```\n</editor-context>\n\nq";
    expect(extractEditorContextPaths(text)).toEqual(["a.md", "a.md", "b.md", "b.md"]);
  });

  test("returns [] when there's no editor-context block at all", () => {
    expect(extractEditorContextPaths("just a normal question")).toEqual([]);
  });

  test("returns [] for an empty editor-context block", () => {
    expect(extractEditorContextPaths("<editor-context>\n</editor-context>\n\nhi")).toEqual([]);
  });
});

// The visual chat prepends a `<editor-context>…</editor-context>` preamble to the WIRE message
// (grounding context for Claude, never user prose). On history REPLAY the bubble is rebuilt from the
// SDK-persisted content, so the preamble must be stripped there or it leaks into the rendered bubble.
describe("stripEditorContext (chat history replay)", () => {
  test("strips a leading editor-context preamble, leaving only the typed text", () => {
    const wire = "<editor-context>\nActive file: Project.md\nOpen tabs: Project.md\n</editor-context>\n\nsummarize this";
    expect(stripEditorContext(wire)).toBe("summarize this");
  });

  test("strips a multi-line preamble that includes a selection block", () => {
    const wire =
      "<editor-context>\nActive file: A.md\nCurrent selection (from A.md):\n```\nhello\nworld\n```\n</editor-context>\n\nwhat does this mean?";
    expect(stripEditorContext(wire)).toBe("what does this mean?");
  });

  test("leaves an ordinary message (no preamble) untouched", () => {
    expect(stripEditorContext("just a normal question")).toBe("just a normal question");
  });

  test("only strips a LEADING preamble, not one that appears mid-text", () => {
    const text = "look at <editor-context>\nx\n</editor-context>\n\ninline";
    expect(stripEditorContext(text)).toBe(text);
  });
});

// makeUserMessage's content SHAPE is load-bearing (pure, no `claude` needed):
//  - no images → a PLAIN STRING so the spawned CLI runs slash-command detection/expansion
//    ("/compact", "/clear", custom commands only execute for string content — an array-of-blocks
//    shape is forwarded to the model as literal text and never runs).
//  - images present → an ARRAY: an optional leading text block, then one base64 image block each.
describe("makeUserMessage (content shape)", () => {
  test("no images → content is a plain STRING (so slash commands expand)", () => {
    const msg = makeUserMessage("/compact");
    expect(msg.type).toBe("user");
    expect((msg.message as { role: string }).role).toBe("user");
    expect(msg.message.content).toBe("/compact");
  });

  test("an empty images array is treated as no images → still a string", () => {
    expect(makeUserMessage("hello world", []).message.content).toBe("hello world");
  });

  test("images present → an ARRAY: a leading text block then one image block per attachment", () => {
    const msg = makeUserMessage("look at this", [{ media_type: "image/png", data: "AAAA" }]);
    const content = msg.message.content as unknown[];
    expect(Array.isArray(content)).toBe(true);
    expect(content).toEqual([
      { type: "text", text: "look at this" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
    ]);
  });

  test("image-only (empty text) → array with ONLY the image block(s), no empty text block", () => {
    const msg = makeUserMessage("", [
      { media_type: "image/jpeg", data: "BBBB" },
      { media_type: "image/webp", data: "CCCC" },
    ]);
    const content = msg.message.content as unknown[];
    expect(content).toEqual([
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "BBBB" } },
      { type: "image", source: { type: "base64", media_type: "image/webp", data: "CCCC" } },
    ]);
  });
});

// unstreamedAssistantFrames is the BUG #19 de-dupe rule: a locally-executed built-in slash command
// (/context, /help, …) delivers its output as a complete assistant text block with NO stream_event
// deltas, so the drain loop (which normally skips already-streamed text) must emit it directly. Pure,
// no `claude` needed.
describe("unstreamedAssistantFrames (BUG #19: slash-command output de-dupe)", () => {
  const asstMsg = (blocks: unknown[]) => ({ message: { content: blocks } });

  test("nothing streamed → emit the assistant text block (the /context case)", () => {
    const msg = asstMsg([{ type: "text", text: "## Context Usage\n2%" }]);
    expect(unstreamedAssistantFrames(msg, 0, 0)).toEqual([
      { type: "assistant-text", text: "## Context Usage\n2%" },
    ]);
  });

  test("text already streamed (len>0) → skip the final text block (no double-emit)", () => {
    const msg = asstMsg([{ type: "text", text: "hello world" }]);
    expect(unstreamedAssistantFrames(msg, 11, 0)).toEqual([]);
  });

  test("thinking not streamed → emit it; text streamed → skip it", () => {
    const msg = asstMsg([
      { type: "thinking", thinking: "hmm" },
      { type: "text", text: "streamed reply" },
    ]);
    expect(unstreamedAssistantFrames(msg, 14, 0)).toEqual([{ type: "thinking", text: "hmm" }]);
  });

  test("tool_use blocks are never emitted here (translateSdkMessage owns those)", () => {
    const msg = asstMsg([{ type: "tool_use", id: "t1", name: "Bash", input: {} }]);
    expect(unstreamedAssistantFrames(msg, 0, 0)).toEqual([]);
  });

  test("empty text block is not emitted", () => {
    const msg = asstMsg([{ type: "text", text: "" }]);
    expect(unstreamedAssistantFrames(msg, 0, 0)).toEqual([]);
  });

  test("non-array content (a plain string) yields nothing", () => {
    expect(unstreamedAssistantFrames({ message: { content: "plain" } }, 0, 0)).toEqual([]);
  });
});

// These are real round-trips: they spawn the user's `claude` binary (machine-login auth, no API
// key) against a TEMP dir — NEVER the vault. Guarded to skip gracefully when claude isn't on PATH
// or can't be reached, so the suite stays green in environments without it.
const HAS_CLAUDE = whichClaude() !== null;
const describeOrSkip = HAS_CLAUDE ? describe : describe.skip;

if (!HAS_CLAUDE) {
  // eslint-disable-next-line no-console
  console.warn("[chat.test] `claude` not found on PATH — skipping visual Claude Code smoke tests.");
}

/**
 * A tolerant async frame collector. Records every ChatFrame pushed to its sink and lets a test
 * await a frame matching a predicate (or time out). This absorbs the timing variance of a live CLI.
 *
 * `onPermission` (optional) is called for EVERY "permission" frame as it arrives — a live turn may
 * request approval for several tools (the model often pokes around before the operation under test),
 * so a test that answers only the first one would stall the rest of the turn.
 */
function makeCollector(onPermission?: (f: Extract<ChatFrame, { type: "permission" }>) => void) {
  const frames: ChatFrame[] = [];
  const waiters: { match: (f: ChatFrame) => boolean; resolve: (f: ChatFrame) => void }[] = [];

  const sink = (frame: ChatFrame) => {
    frames.push(frame);
    if (frame.type === "permission") onPermission?.(frame);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].match(frame)) {
        waiters[i].resolve(frame);
        waiters.splice(i, 1);
      }
    }
  };

  function waitFor(match: (f: ChatFrame) => boolean, timeoutMs = 120_000): Promise<ChatFrame> {
    const already = frames.find(match);
    if (already) return Promise.resolve(already);
    return new Promise<ChatFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = waiters.findIndex((w) => w.resolve === wrapped);
        if (idx >= 0) waiters.splice(idx, 1);
        reject(new Error("timeout waiting for frame; saw: " + JSON.stringify(frames.map((f) => f.type))));
      }, timeoutMs);
      const wrapped = (f: ChatFrame) => {
        clearTimeout(timer);
        resolve(f);
      };
      waiters.push({ match, resolve: wrapped });
    });
  }

  return { sink, frames, waitFor };
}

describeOrSkip("visual Claude Code chat driver (live)", () => {
  const tempDirs: string[] = [];
  const chatIds: string[] = [];

  afterEach(async () => {
    for (const id of chatIds.splice(0)) closeChat(id);
    for (const dir of tempDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  async function newTempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "bismuth-chat-test-"));
    tempDirs.push(dir);
    return dir;
  }

  test("manifest + assistant text + done on a trivial turn", async () => {
    const cwd = await newTempDir();
    const chatId = newChatId();
    chatIds.push(chatId);
    const { sink, frames, waitFor } = makeCollector();

    sendMessage(chatId, "Reply with exactly: ok", cwd, sink);

    const manifest = await waitFor((f) => f.type === "manifest");
    // Registration now lands after an async visibility-deny-list build (buildDenyPaths), so it's
    // no longer synchronous with the sendMessage() call above — but the session is guaranteed
    // registered by the time its `manifest` frame streams (drain() only runs after `sessions.set`).
    expect(chatSessionCount()).toBeGreaterThan(0);
    expect(manifest.type).toBe("manifest");
    if (manifest.type === "manifest") {
      // The command list comes off the init manifest — never hardcoded — and is non-empty.
      expect(manifest.manifest.slashCommands.length).toBeGreaterThan(0);
      expect(typeof manifest.manifest.model).toBe("string");
    }

    await waitFor((f) => f.type === "done");
    expect(frames.some((f) => f.type === "assistant-text")).toBe(true);
  }, 180_000);

  test("BUG #19: a built-in slash command (/context) produces visible assistant output", async () => {
    // /context runs LOCALLY and returns its output as a complete assistant text block with NO
    // streaming deltas. Before the fix the drain loop dropped it (it skips already-streamed text),
    // so the command appeared to do nothing. Assert the output actually reaches the client.
    const cwd = await newTempDir();
    const chatId = newChatId();
    chatIds.push(chatId);
    const { sink, frames, waitFor } = makeCollector();

    sendMessage(chatId, "/context", cwd, sink);

    await waitFor((f) => f.type === "done");
    const texts = frames.filter((f): f is Extract<ChatFrame, { type: "assistant-text" }> => f.type === "assistant-text");
    expect(texts.length).toBeGreaterThan(0);
    expect(texts.map((t) => t.text).join("")).toMatch(/context/i);
  }, 180_000);

  test("permission ALLOW: approving Write creates the file", async () => {
    const cwd = await newTempDir();
    const chatId = newChatId();
    chatIds.push(chatId);
    // Allow every tool the model asks to use this turn (it may approve a couple before the Write).
    let sawPermission = false;
    const { sink, waitFor } = makeCollector((perm) => {
      sawPermission = true;
      respondPermission(chatId, perm.id, "allow");
    });

    sendMessage(chatId, "Create a file named t.txt containing the text hi. Do nothing else.", cwd, sink);

    await waitFor((f) => f.type === "done");
    expect(sawPermission).toBe(true); // the Write was gated through canUseTool
    const body = await readFile(join(cwd, "t.txt"), "utf8");
    expect(body).toContain("hi");
  }, 180_000);

  test("permission DENY: denying Write leaves no file and the turn still completes", async () => {
    const cwd = await newTempDir();
    const chatId = newChatId();
    chatIds.push(chatId);
    // Deny every tool — the file must never be written, and the turn must still finish cleanly.
    let sawPermission = false;
    const { sink, waitFor } = makeCollector((perm) => {
      sawPermission = true;
      respondPermission(chatId, perm.id, "deny");
    });

    sendMessage(chatId, "Create a file named t.txt containing the text hi. Do nothing else.", cwd, sink);

    await waitFor((f) => f.type === "done");
    expect(sawPermission).toBe(true);
    let exists = true;
    try {
      await readFile(join(cwd, "t.txt"), "utf8");
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);
  }, 180_000);

  // Escape/Stop in the UI calls abortTurn(), which interrupt()s the in-flight turn. The Claude
  // Agent SDK reports an interrupted turn's `result` as an ERROR (subtype "error_during_execution",
  // is_error: true, terminal_reason "aborted_streaming") — indistinguishable on the wire from a
  // real failure. Without ChatSession.aborting (chat.ts), that would surface in the UI as "The
  // turn ended with an error." for a perfectly deliberate Stop.
  test("abortTurn: an interrupted turn's result frame is NOT reported as an error", async () => {
    const cwd = await newTempDir();
    const chatId = newChatId();
    chatIds.push(chatId);
    const { sink, waitFor } = makeCollector();

    sendMessage(
      chatId,
      "Count slowly from 1 to 50, one number per line, with a short reasoning sentence before each number.",
      cwd,
      sink,
    );
    // Let the turn actually start before interrupting it mid-stream.
    await waitFor((f) => f.type === "assistant-text" || f.type === "thinking" || f.type === "tool-use");
    abortTurn(chatId);

    const result = await waitFor((f) => f.type === "result");
    expect(result.type).toBe("result");
    if (result.type === "result") expect(result.isError).toBe(false);
    await waitFor((f) => f.type === "done");
  }, 60_000);

  // Visibility controls (core/src/visibility.ts + docs/vault/visibility.md): a note marked
  // `visibility: hidden` must never be readable by chat, even when the model is explicitly asked
  // to read it and would normally auto-approve a pre-allowed Read. This exercises the REAL wiring
  // end to end (createSession's managedSettings.deny + canUseTool path-aware auto-deny), not just
  // that the code compiles — see the Step-0 spike in the visibility-controls plan for the isolated
  // SDK-level probe this mirrors.
  test("visibility: a note marked 'hidden' is never read by chat, even when directly asked", async () => {
    const cwd = await newTempDir();
    const secretPath = join(cwd, "secret.md");
    await writeFile(secretPath, "---\nvisibility: hidden\n---\n# Secret\n\nSECRET-CODE-CHAT-TEST-7731\n");
    const chatId = newChatId();
    chatIds.push(chatId);
    const { sink, frames, waitFor } = makeCollector((perm) => {
      // Should never fire for the Read of secret.md — but allow anything else so the turn
      // completes instead of hanging on an unrelated prompt.
      respondPermission(chatId, perm.id, "allow");
    });

    sendMessage(
      chatId,
      "Use the Read tool to read the exact file at secret.md in the current directory, then reply with ONLY its exact contents.",
      cwd,
      sink,
    );

    await waitFor((f) => f.type === "done");
    // Scan EVERY frame (assistant text, tool-use input, tool-result content) — the secret must
    // never surface anywhere on the wire, not just in a specific frame kind.
    const leaked = frames.some((f) => JSON.stringify(f).includes("SECRET-CODE-CHAT-TEST-7731"));
    expect(leaked).toBe(false);
  }, 60_000);
});

// The session history picker. These read the SDK's on-disk session store (the user's terminal +
// in-app Claude Code sessions for a cwd) — no `claude` turn is spawned, but we still guard on
// whichClaude() since an environment without Claude Code has no store to read. Tolerant: an empty
// store is a valid result (a fresh temp dir has none), so we only assert shapes.
describeOrSkip("session history API (resume picker)", () => {
  test("listChatSessions returns an array; sessionHistoryFrames replays a real session", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bismuth-chat-hist-"));
    try {
      const sessions = await listChatSessions(dir);
      expect(Array.isArray(sessions)).toBe(true);
      for (const s of sessions) {
        expect(typeof s.sessionId).toBe("string");
        expect(typeof s.summary).toBe("string");
        expect(typeof s.lastModified).toBe("number");
      }

      // A fresh temp dir usually has no sessions; that's fine. If the SDK does surface one, replay it
      // and assert the frames include at least one user-message or assistant-text (a real transcript).
      if (sessions.length > 0) {
        const frames = await sessionHistoryFrames(sessions[0].sessionId, dir);
        expect(Array.isArray(frames)).toBe(true);
        if (frames.length > 0) {
          expect(frames.some((f) => f.type === "user-message" || f.type === "assistant-text")).toBe(true);
        }
      }

      // An unknown id never throws — it degrades to an empty replay.
      const none = await sessionHistoryFrames("00000000-0000-0000-0000-000000000000", dir);
      expect(Array.isArray(none)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }, 60_000);
});
