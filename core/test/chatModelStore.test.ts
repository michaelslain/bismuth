import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  upsertSessionModel,
  lookupSessionModel,
  saveSessionModel,
  loadSessionModel,
  chatStateDir,
  type ChatModelEntry,
} from "../src/chatModelStore";

// Bug #89: the durable per-SESSION model store. Keyed by SDK session_id (not the chat tab), so a
// conversation resumed into ANY tab / after any restart comes back on the model it was last set to.

const e = (sessionId: string, model: string, at: number): ChatModelEntry => ({ sessionId, model, at });

describe("upsertSessionModel (pure)", () => {
  test("appends a new entry", () => {
    expect(upsertSessionModel([], "s1", "opus[1m]", 1)).toEqual([e("s1", "opus[1m]", 1)]);
  });

  test("replaces an existing entry for the same session (most-recent last)", () => {
    const list = [e("s1", "haiku", 1), e("s2", "sonnet", 2)];
    expect(upsertSessionModel(list, "s1", "opus[1m]", 3)).toEqual([
      e("s2", "sonnet", 2),
      e("s1", "opus[1m]", 3),
    ]);
  });

  test("caps the list by dropping the oldest entries", () => {
    const list = [e("a", "haiku", 1), e("b", "sonnet", 2), e("c", "opus[1m]", 3)];
    expect(upsertSessionModel(list, "d", "haiku", 4, 3)).toEqual([
      e("b", "sonnet", 2),
      e("c", "opus[1m]", 3),
      e("d", "haiku", 4),
    ]);
  });
});

describe("lookupSessionModel (pure)", () => {
  test("finds the entry for a session", () => {
    const list = [e("s1", "haiku", 1), e("s2", "sonnet", 2)];
    expect(lookupSessionModel(list, "s2")).toBe("sonnet");
  });
  test("null for an unknown session", () => {
    expect(lookupSessionModel([e("s1", "haiku", 1)], "nope")).toBeNull();
  });
  test("a (defensive) duplicate resolves to the most recent entry", () => {
    const list = [e("s1", "haiku", 1), e("s1", "opus[1m]", 2)];
    expect(lookupSessionModel(list, "s1")).toBe("opus[1m]");
  });
});

describe("save/loadSessionModel (file round-trip via BISMUTH_CHAT_DIR)", () => {
  let dir: string;
  let prevEnv: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "bismuth-chat-models-"));
    prevEnv = process.env.BISMUTH_CHAT_DIR;
    process.env.BISMUTH_CHAT_DIR = dir;
  });
  afterEach(() => {
    if (prevEnv === undefined) delete process.env.BISMUTH_CHAT_DIR;
    else process.env.BISMUTH_CHAT_DIR = prevEnv;
    rmSync(dir, { recursive: true, force: true });
  });

  test("chatStateDir honors the env override", () => {
    expect(chatStateDir()).toBe(dir);
  });

  test("round-trips a model per session", () => {
    saveSessionModel("sess-a", "opus[1m]");
    saveSessionModel("sess-b", "haiku");
    expect(loadSessionModel("sess-a")).toBe("opus[1m]");
    expect(loadSessionModel("sess-b")).toBe("haiku");
    expect(loadSessionModel("sess-c")).toBeNull();
  });

  test("a re-save overwrites the session's previous model", () => {
    saveSessionModel("sess-a", "haiku");
    saveSessionModel("sess-a", "sonnet");
    expect(loadSessionModel("sess-a")).toBe("sonnet");
  });

  test("empty args are no-ops", () => {
    saveSessionModel("", "haiku");
    saveSessionModel("sess-a", "");
    expect(loadSessionModel("")).toBeNull();
    expect(loadSessionModel("sess-a")).toBeNull();
  });

  test("a corrupt store degrades to 'no saved models' (and heals on the next save)", () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "models.json"), "{not json!");
    expect(loadSessionModel("sess-a")).toBeNull();
    saveSessionModel("sess-a", "opus[1m]");
    expect(loadSessionModel("sess-a")).toBe("opus[1m]");
  });

  test("non-entry garbage in the file is filtered out", () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "models.json"),
      JSON.stringify([{ sessionId: "ok", model: "haiku", at: 1 }, { bogus: true }, null, 42]),
    );
    expect(loadSessionModel("ok")).toBe("haiku");
    expect(loadSessionModel("bogus")).toBeNull();
    // A save keeps only the valid entries.
    saveSessionModel("ok2", "sonnet");
    const raw = JSON.parse(readFileSync(join(dir, "models.json"), "utf8"));
    expect(raw).toEqual([
      { sessionId: "ok", model: "haiku", at: 1 },
      expect.objectContaining({ sessionId: "ok2", model: "sonnet" }),
    ]);
  });
});
