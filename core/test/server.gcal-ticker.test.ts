import { test, expect, spyOn } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../src/server";

// Throwaway machine dirs for the two boot writes createServer makes against a vault path: the
// daemon machine registry (registerVaultRoot) and the run registry (writeRunRecord). Neither may
// land in the real ~/.bismuth for the never-existed vaults below. Both writes are SYNCHRONOUS
// inside createServer, so these are set around the test rather than at module scope — a
// module-scope assignment here would silently override the same variables that server.test.ts,
// ownerToken.test.ts and daemon.test.ts each pin to their OWN temp dir for the whole process.
const machineDir = mkdtempSync(join(tmpdir(), "bismuth-gcal-tick-machine-"));
const runDir = mkdtempSync(join(tmpdir(), "bismuth-gcal-tick-run-"));

// A throwaway ~/.bismuth/gcal holding a CONNECTED-looking account, so the auto-sync ticker gets
// past its `gcalStatus().connected` gate without the test ever reading the developer's real
// Google credentials. The token is never used: every tick below fails in the vault scan that
// precedes the first Google call, so nothing in this file can reach the network.
const gcalHome = mkdtempSync(join(tmpdir(), "bismuth-gcal-tick-state-"));
writeFileSync(
  join(gcalHome, "state.json"),
  JSON.stringify({
    clientId: "test-client",
    clientSecret: "test-secret",
    refreshToken: "test-refresh-token-never-used",
    account: "nobody@example.invalid",
  }),
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Set env vars, returning a restore that puts each back exactly as it was (deleting the ones
 *  that were unset) — so nothing this file does outlives it. */
function setEnv(vars: Record<string, string>): () => void {
  const prev = Object.keys(vars).map((k) => [k, process.env[k]] as const);
  for (const [k, v] of Object.entries(vars)) process.env[k] = v;
  return () => {
    for (const [k, v] of prev) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}

/**
 * A vault path that can never come into existence: a child of a regular FILE, so every mkdir
 * under it fails with ENOTDIR. createServer's boot writes (settings reconcile) would otherwise
 * create a merely-missing dir, and a readable vault makes the ticker's scan succeed silently —
 * which is precisely the shape of "the assertion passed because nothing happened".
 */
function unmakeableVaultPath(tag: string): string {
  const file = join(mkdtempSync(join(tmpdir(), "bismuth-gcal-tick-")), `${tag}-not-a-dir`);
  writeFileSync(file, "");
  return join(file, "vault");
}

/**
 * The auto-sync ticker belongs to the server that created it: stopping the server stops the
 * ticker. Observed through the ticker's only externally visible act — the vault scan it logs
 * when the vault is unreadable — with a second, identically-built server left RUNNING as the
 * in-test control, so "the stopped server never ticked" cannot pass by the tick mechanism
 * having been broken or the window having been too short for either server.
 */
test("stopping a server stops its Google Calendar auto-sync ticker", async () => {
  const keptVault = unmakeableVaultPath("kept");
  const stoppedVault = unmakeableVaultPath("stopped");

  const logged: string[] = [];
  const spy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    logged.push(args.map((a) => String(a)).join(" "));
  });
  const restore = setEnv({
    BISMUTH_GCAL_DIR: gcalHome,
    BISMUTH_GCAL_TICK_MS: "10",
    BISMUTH_DAEMON_DIR: machineDir,
    BISMUTH_RUN_DIR: runDir,
  });

  const kept = createServer({ vault: keptVault, port: 0 });
  const stopped = createServer({ vault: stoppedVault, port: 0 });
  await stopped.stop(true);

  try {
    const scans = (vault: string) =>
      logged.filter((m) => m.includes("[gcal] auto-sync scan failed") && m.includes(vault));

    // Control: the running server's ticker fires and reaches the vault scan. Without this the
    // assertion below would also hold if the ticker never ran for any reason at all.
    const deadline = Date.now() + 3_000;
    while (scans(keptVault).length === 0 && Date.now() < deadline) await sleep(10);
    expect(scans(keptVault).length).toBeGreaterThan(0);

    // Both servers were built the same way at the same moment and their first tick was due at
    // the same 10ms. Give the stopped one 30 further tick periods past the point where the
    // running one had already ticked.
    await sleep(300);
    expect(scans(stoppedVault)).toEqual([]);
  } finally {
    await kept.stop(true);
    spy.mockRestore();
    restore();
  }
});
