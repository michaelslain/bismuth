import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateVaultFolder, findFreePort, spawnVaultBackend } from "../src/openFolder";

const tmp = () => mkdtempSync(join(tmpdir(), "oa-of-"));
const missing = () => join(tmpdir(), `oa-missing-${Math.random().toString(36).slice(2)}`);

describe("validateVaultFolder", () => {
  it("accepts an existing directory", () => {
    const dir = tmp();
    expect(validateVaultFolder(dir)).toBe(dir);
  });
  it("rejects a missing path", () => {
    expect(() => validateVaultFolder(missing())).toThrow();
  });
  it("rejects a file (not a directory)", () => {
    const f = join(tmp(), "x.md");
    writeFileSync(f, "hi");
    expect(() => validateVaultFolder(f)).toThrow();
  });
  it("rejects empty / non-string input", () => {
    expect(() => validateVaultFolder("")).toThrow();
    expect(() => validateVaultFolder("   ")).toThrow();
    expect(() => validateVaultFolder(undefined as unknown as string)).toThrow();
  });
});

describe("findFreePort", () => {
  it("returns a usable TCP port", async () => {
    const p = await findFreePort();
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(65536);
  });
});

describe("spawnVaultBackend", () => {
  it("validates the folder BEFORE spawning anything", async () => {
    let spawned = false;
    await expect(
      spawnVaultBackend({
        folder: missing(),
        memory: tmp(),
        serverEntry: "server.ts",
        spawn: () => { spawned = true; return { pid: 1, kill() {} }; },
        probe: async () => true,
      }),
    ).rejects.toThrow();
    expect(spawned).toBe(false);
  });

  it("requires a memory dir", async () => {
    await expect(
      spawnVaultBackend({
        folder: tmp(),
        memory: "",
        serverEntry: "server.ts",
        spawn: () => ({ pid: 1, kill() {} }),
        probe: async () => true,
      }),
    ).rejects.toThrow();
  });

  it("resolves to a url + pid once the child answers /version", async () => {
    const dir = tmp();
    const res = await spawnVaultBackend({
      folder: dir,
      memory: dir,
      serverEntry: "server.ts",
      spawn: () => ({ pid: 42, kill() {} }),
      probe: async () => true,
    });
    expect(res.vault).toBe(dir);
    expect(res.pid).toBe(42);
    expect(res.url).toMatch(/^http:\/\/localhost:\d+$/);
  });

  it("passes the resolved free port to the spawn command", async () => {
    const dir = tmp();
    let cmd: string[] = [];
    const res = await spawnVaultBackend({
      folder: dir,
      memory: dir,
      serverEntry: "/abs/server.ts",
      spawn: (c) => { cmd = c; return { pid: 1, kill() {} }; },
      probe: async () => true,
    });
    const portFromUrl = res.url.split(":").pop()!;
    expect(cmd).toContain("--port");
    expect(cmd[cmd.indexOf("--port") + 1]).toBe(portFromUrl);
    expect(cmd).toContain("/abs/server.ts");
    expect(cmd[cmd.indexOf("--vault") + 1]).toBe(dir);
  });

  it("drops a non-existent cwd (compiled-binary /$bunfs/... dir) so spawn inherits a valid cwd", async () => {
    const dir = tmp();
    let passedCwd: string | undefined = "sentinel";
    await spawnVaultBackend({
      folder: dir,
      memory: dir,
      serverEntry: "/abs/server.ts",
      cwd: "/no/such/$bunfs/root", // virtual path that doesn't exist on disk
      spawn: (_c, c) => { passedCwd = c; return { pid: 1, kill() {} }; },
      probe: async () => true,
    });
    expect(passedCwd).toBeUndefined();
  });

  it("passes through a cwd that does exist", async () => {
    const dir = tmp();
    let passedCwd: string | undefined;
    await spawnVaultBackend({
      folder: dir,
      memory: dir,
      serverEntry: "/abs/server.ts",
      cwd: dir, // a real directory
      spawn: (_c, c) => { passedCwd = c; return { pid: 1, kill() {} }; },
      probe: async () => true,
    });
    expect(passedCwd).toBe(dir);
  });

  it("fails fast (before the timeout) if the child exits early", async () => {
    const dir = tmp();
    const start = Date.now();
    await expect(
      spawnVaultBackend({
        folder: dir,
        memory: dir,
        serverEntry: "server.ts",
        waitMs: 5000, // long timeout — the early-exit detection should beat it
        spawn: () => ({ pid: 9, kill() {}, exited: Promise.resolve(1) }),
        probe: async () => false,
      }),
    ).rejects.toThrow(/exited before it was ready/);
    expect(Date.now() - start).toBeLessThan(2000); // didn't wait out the 5s timeout
  });

  it("kills the child and throws if it never becomes ready", async () => {
    let killed = false;
    const dir = tmp();
    await expect(
      spawnVaultBackend({
        folder: dir,
        memory: dir,
        serverEntry: "server.ts",
        waitMs: 250,
        spawn: () => ({ pid: 7, kill() { killed = true; } }),
        probe: async () => false,
      }),
    ).rejects.toThrow();
    expect(killed).toBe(true);
  });
});
