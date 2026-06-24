// core/test/gcal/lock.test.ts
import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withSyncLock, SyncLocked } from "../../src/gcal/lock";

test("withSyncLock serializes: a second acquire while held throws SyncLocked, then frees", async () => {
  const home = mkdtempSync(join(tmpdir(), "gcal-lock-"));
  try {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const first = withSyncLock(async () => { await held; return "first"; }, home);
    await new Promise((r) => setTimeout(r, 10)); // let `first` acquire

    await expect(withSyncLock(async () => "second", home)).rejects.toBeInstanceOf(SyncLocked);

    release();
    expect(await first).toBe("first");
    // released → re-acquirable, and the lock file is gone.
    expect(await withSyncLock(async () => "third", home)).toBe("third");
    expect(existsSync(join(home, ".bismuth", "gcal", "sync.lock"))).toBe(false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("withSyncLock releases the lock even if the body throws", async () => {
  const home = mkdtempSync(join(tmpdir(), "gcal-lock-"));
  try {
    await expect(withSyncLock(async () => { throw new Error("boom"); }, home)).rejects.toThrow("boom");
    expect(existsSync(join(home, ".bismuth", "gcal", "sync.lock"))).toBe(false);
    expect(await withSyncLock(async () => "ok", home)).toBe("ok"); // not stuck
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
