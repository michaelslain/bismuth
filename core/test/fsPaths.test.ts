import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listFsPaths } from "../src/fsPaths";

// A fake home with a few dirs + files to complete against. Never touches the real home.
let home: string;

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "fspaths-"));
  await mkdir(join(home, ".claude-bot"));
  await mkdir(join(home, ".claude"));
  await mkdir(join(home, "Documents"));
  await writeFile(join(home, ".profile"), "x");
  await writeFile(join(home, ".claude-bot", "device-id"), "uuid");
  await mkdir(join(home, ".claude-bot", "crons"));
});

afterAll(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("listFsPaths", () => {
  test('"~/.cl" completes the matching dotdirs under home', async () => {
    const entries = await listFsPaths("~/.cl", undefined, home);
    expect(entries.map((e) => e.path).sort()).toEqual(["~/.claude", "~/.claude-bot"]);
    expect(entries.every((e) => e.kind === "dir")).toBe(true);
  });

  test('only:"dir" filters out files', async () => {
    // "~/." matches both the dotdirs and ".profile"; only:"dir" drops the file.
    const all = await listFsPaths("~/.", undefined, home);
    expect(all.map((e) => e.path)).toContain("~/.profile");
    const dirs = await listFsPaths("~/.", "dir", home);
    expect(dirs.map((e) => e.path)).not.toContain("~/.profile");
    expect(dirs.map((e) => e.path).sort()).toEqual(["~/.claude", "~/.claude-bot"]);
  });

  test("drills into a subdirectory by trailing slash", async () => {
    const entries = await listFsPaths("~/.claude-bot/", undefined, home);
    expect(entries.map((e) => e.path).sort()).toEqual([
      "~/.claude-bot/crons",
      "~/.claude-bot/device-id",
    ]);
  });

  test("dirs sort before files", async () => {
    const entries = await listFsPaths("~/.claude-bot/", undefined, home);
    expect(entries[0].kind).toBe("dir"); // crons (dir) before device-id (file)
  });

  test("no slash yet → suggests absolute ~/ rows under home", async () => {
    const entries = await listFsPaths("Doc", undefined, home);
    expect(entries.map((e) => e.path)).toEqual(["~/Documents"]);
  });

  test("matching is case-insensitive", async () => {
    const entries = await listFsPaths("~/doc", undefined, home);
    expect(entries.map((e) => e.path)).toEqual(["~/Documents"]);
  });

  test("absolute paths resolve against the real filesystem root", async () => {
    const entries = await listFsPaths(home + "/.claude-b", undefined, home);
    expect(entries.map((e) => e.path)).toEqual([home + "/.claude-bot"]);
  });

  test("missing / unreadable parent → [] (no throw)", async () => {
    expect(await listFsPaths("~/does-not-exist/x", undefined, home)).toEqual([]);
  });

  test("relative paths (no ~ or /) under a slash are unsupported → []", async () => {
    expect(await listFsPaths("rel/ative", undefined, home)).toEqual([]);
  });

  test("a dangling symlink is skipped rather than throwing", async () => {
    await symlink(join(home, "nowhere"), join(home, "dangling"));
    const entries = await listFsPaths("~/dang", undefined, home);
    expect(entries).toEqual([]); // stat on the broken link fails → entry skipped
    await rm(join(home, "dangling"));
  });
});
