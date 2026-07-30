import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { claudeSpawnEnv } from "../../src/claudeWhich";
import { buildPtyEnv } from "../../src/terminal";

// BISMUTH_AGENT_CHANNEL is what makes the CLI self-gate fire (core/src/visibilityCliGate.ts).
// Its ABSENCE means "the vault owner's own hand — no gate", so a driver that forgets to stamp it
// hands its agent an ungated `bismuth` CLI: the agent can simply run `bismuth read <hidden note>`
// and walk around every other layer. This was a real gap in the opencode driver, found by the
// implementer that owned the CLI gate rather than by a test, which is why the scan below exists.

const SRC = join(import.meta.dir, "..", "..", "src");

describe("agent spawn envs carry the channel", () => {
  test("claudeSpawnEnv stamps the channel when asked, and omits it when not", () => {
    expect(claudeSpawnEnv({}, "chat").BISMUTH_AGENT_CHANNEL).toBe("chat");
    expect(claudeSpawnEnv({}, "daemon").BISMUTH_AGENT_CHANNEL).toBe("daemon");
    // Omitted, NOT set to "" — the gate distinguishes absent (owner) from present (agent).
    expect(claudeSpawnEnv({}).BISMUTH_AGENT_CHANNEL).toBeUndefined();
  });

  test("a terminal PTY is deliberately NOT stamped — it is the owner's own shell", () => {
    // docs/vault/visibility.md scopes interactive terminal sessions OUT: they run as the user, with
    // full OS filesystem access. Stamping here would restrict the owner in their own terminal, which
    // the threat model explicitly forbids. If this test ever fails, read that doc before "fixing" it.
    const env = buildPtyEnv({
      base: {},
      relayUrl: "http://localhost:4321",
      terminalId: "t1",
      shimAvailable: false,
      realClaude: null,
      pluginDir: "/p",
      shimDir: "/s",
      zdotDir: "/z",
    });
    expect(env.BISMUTH_AGENT_CHANNEL).toBeUndefined();
  });

  // A structural guard rather than a behavioural one, on purpose: each driver builds its env in its
  // own private helper, so there is no shared seam to assert against — and the failure mode is a NEW
  // driver being added without the stamp, which only a scan can catch.
  test("every chat driver passes a channel to claudeSpawnEnv", () => {
    const drivers = [
      "chatProviders/opencode.ts",
      "chatProviders/opencodeServer.ts",
      "chatProviders/acp/driver.ts",
      "chatProviders/codex/driver.ts",
    ];
    const offenders: string[] = [];
    for (const rel of drivers) {
      const src = readFileSync(join(SRC, rel), "utf8");
      // A bare `claudeSpawnEnv(...)` whose argument list has no channel string.
      for (const m of src.matchAll(/claudeSpawnEnv\(([^)]*)\)/g)) {
        const args = m[1] ?? "";
        if (!args.includes('"chat"') && !args.includes('"daemon"')) {
          offenders.push(`${rel}: claudeSpawnEnv(${args.trim()})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
