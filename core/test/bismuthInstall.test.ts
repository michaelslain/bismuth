import { test, expect } from "bun:test";
import { ensureBismuthInstalled, getBismuthStatus, type InstallIO } from "../src/bismuthInstall";

// A fully-faked InstallIO so we exercise the version-gated decision logic without touching
// the real filesystem / ~/.claude.json. `calls` records the effectful operations performed.
function fakeIO(opts: {
  hash?: string | null;
  marker?: string | null;
  cli?: boolean;
  mcp?: boolean;
  registerMcp?: () => Promise<{ ok: boolean; warning?: string }>;
} = {}): { io: InstallIO; calls: string[] } {
  const calls: string[] = [];
  let marker = opts.marker ?? null;
  const io: InstallIO = {
    hashSrc: async () => (opts.hash === undefined ? "HASH1" : opts.hash),
    readMarker: () => marker,
    writeMarker: (h) => { calls.push("writeMarker"); marker = h; },
    cliLinked: () => ({ linked: opts.cli ?? false, path: opts.cli ? "/usr/local/bin/bismuth" : null }),
    mcpRegistered: async () => opts.mcp ?? false,
    installFiles: () => { calls.push("installFiles"); },
    linkCli: () => { calls.push("linkCli"); return { ok: true, path: "/usr/local/bin/bismuth" }; },
    registerMcp: opts.registerMcp ?? (async () => { calls.push("registerMcp"); return { ok: true }; }),
  };
  return { io, calls };
}

test("no-ops when already installed and up to date", async () => {
  const { io, calls } = fakeIO({ hash: "H", marker: "H", cli: true, mcp: true });
  const r = await ensureBismuthInstalled("/src", io);
  expect(r.action).toBe("up-to-date");
  expect(calls).toEqual([]); // zero side effects
});

test("reinstalls when the source hash changed", async () => {
  const { io, calls } = fakeIO({ hash: "H2", marker: "H1", cli: true, mcp: true });
  const r = await ensureBismuthInstalled("/src", io);
  expect(r.action).toBe("updated");
  expect(calls).toEqual(["installFiles", "linkCli", "registerMcp", "writeMarker"]);
});

test("first install when no marker present", async () => {
  const { io } = fakeIO({ hash: "H", marker: null });
  expect((await ensureBismuthInstalled("/src", io)).action).toBe("installed");
});

test("reinstalls when marker matches but the cli symlink is missing", async () => {
  const { io, calls } = fakeIO({ hash: "H", marker: "H", cli: false, mcp: true });
  const r = await ensureBismuthInstalled("/src", io);
  expect(r.action).toBe("updated");
  expect(calls).toContain("linkCli");
});

test("skipped when no src or no compiled binaries", async () => {
  expect((await ensureBismuthInstalled(undefined, fakeIO().io)).action).toBe("skipped-no-src");
  expect((await ensureBismuthInstalled("/src", fakeIO({ hash: null }).io)).action).toBe("skipped-no-src");
});

test("dry-run performs no side effects", async () => {
  const { io, calls } = fakeIO({ hash: "H2", marker: "H1", cli: true, mcp: true });
  const r = await ensureBismuthInstalled("/src", io, { dryRun: true });
  expect(r.action).toBe("would-update");
  expect(calls).toEqual([]);
});

test("installs but warns when claude/mcp registration is unavailable", async () => {
  const { io } = fakeIO({ hash: "H", marker: null, registerMcp: async () => ({ ok: false, warning: "claude not found" }) });
  const r = await ensureBismuthInstalled("/src", io);
  expect(r.action).toBe("installed");
  expect(r.warnings).toContain("claude not found");
});

test("getBismuthStatus reflects marker + link + mcp", async () => {
  const s = await getBismuthStatus(fakeIO({ marker: "H", cli: true, mcp: true }).io);
  expect(s).toMatchObject({ installed: true, version: "H", cliLinked: true, mcpRegistered: true });
});
