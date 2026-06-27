// core/test/daemonInstall.test.ts
// The bundled-daemon installer is mostly thin spawn() wrappers over the daemon binary; here we
// cover the pure, side-effect-free branches (path resolution + the no-binary / no-bundle
// degradations) without a real binary or touching ~/.bismuth.
import { test, expect, afterEach } from "bun:test";
import { join } from "node:path";
import { homedir } from "node:os";
import { daemonBinPath, installStatus, installDaemonFromBundle } from "../src/daemonInstall";

afterEach(() => {
  delete process.env.BISMUTH_DAEMON_BIN;
  delete process.env.BISMUTH_DAEMON_BUNDLE;
});

test("daemonBinPath honors BISMUTH_DAEMON_BIN, else ~/.bismuth/bin/bismuth-daemon", () => {
  delete process.env.BISMUTH_DAEMON_BIN;
  expect(daemonBinPath()).toBe(join(homedir(), ".bismuth", "bin", "bismuth-daemon"));
  process.env.BISMUTH_DAEMON_BIN = "/tmp/x/bismuth-daemon";
  expect(daemonBinPath()).toBe("/tmp/x/bismuth-daemon");
});

test("installStatus reports not-installed when the binary is absent (never throws)", async () => {
  process.env.BISMUTH_DAEMON_BIN = join("/tmp", "no-such-daemon-binary-xyz");
  const s = await installStatus();
  expect(s.installed).toBe(false);
  expect(s.running).toBe(false);
});

test("installDaemonFromBundle is a no-op when BISMUTH_DAEMON_BUNDLE is unset (dev)", async () => {
  delete process.env.BISMUTH_DAEMON_BUNDLE;
  await expect(installDaemonFromBundle()).resolves.toBeUndefined(); // no throw, no work
});
