import { test, expect, describe, afterEach } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
  type ChatFrame,
} from "../src/chat";
import { whichClaude } from "../src/claudeWhich";

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
    expect(chatSessionCount()).toBeGreaterThan(0);

    const manifest = await waitFor((f) => f.type === "manifest");
    expect(manifest.type).toBe("manifest");
    if (manifest.type === "manifest") {
      // The command list comes off the init manifest — never hardcoded — and is non-empty.
      expect(manifest.manifest.slashCommands.length).toBeGreaterThan(0);
      expect(typeof manifest.manifest.model).toBe("string");
    }

    await waitFor((f) => f.type === "done");
    expect(frames.some((f) => f.type === "assistant-text")).toBe(true);
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
