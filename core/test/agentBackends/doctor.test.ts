import { test, expect, describe } from "bun:test";
import { adapterPackageFor, interpretProbe, surfaceSummary, versionArgs } from "../../src/agentBackends/doctor";
import { BACKENDS } from "../../src/agentBackends/catalog";

describe("adapterPackageFor", () => {
  // Regression: every npx-invoked adapter reported version "11.11.0" — npm's own version — behind a
  // confident ✓, because its catalog `binary` is the package RUNNER, not the backend. An adapter is
  // fetched on first use, so there is no installed version to report and a ✓ would be a lie in the
  // direction that hurts.
  test("names the package for npx-fetched ACP adapters", () => {
    expect(adapterPackageFor("claude-code-acp")).toBe("@zed-industries/claude-code-acp");
    expect(adapterPackageFor("codex-acp")).toBe("@agentclientprotocol/codex-acp");
  });
  test("skips the -y flag when picking the package out of the argv", () => {
    // The package is the first NON-flag arg; returning "-y" would render nonsense in the table.
    expect(adapterPackageFor("claude-code-acp")?.startsWith("-")).toBe(false);
  });
  test("returns null for natively-installed CLIs, which DO get a real version probe", () => {
    expect(adapterPackageFor("claude")).toBeNull();
    expect(adapterPackageFor("opencode")).toBeNull();
    expect(adapterPackageFor("cline")).toBeNull();
  });
  test("an unknown id is not an adapter (never throws on a stale/typo'd id)", () => {
    expect(adapterPackageFor("does-not-exist")).toBeNull();
  });
});

describe("interpretProbe", () => {
  test("takes the first non-empty line as the version", () => {
    expect(interpretProbe({ exitCode: 0, stdout: "2.1.220 (Claude Code)\n" }).version).toBe("2.1.220 (Claude Code)");
  });
  test("accepts a version printed to stderr — some CLIs do, and they are not broken", () => {
    const r = interpretProbe({ exitCode: 0, stdout: "", stderr: "OpenClaw 2026.3.23-2\n" });
    expect(r.version).toBe("OpenClaw 2026.3.23-2");
    expect(r.problem).toBeUndefined();
  });
  test("a timeout reports a problem, not a version", () => {
    const r = interpretProbe({ timedOut: true });
    expect(r.version).toBeNull();
    expect(r.problem).toContain("no response");
  });
  test("no output at all is a problem carrying the exit code", () => {
    const r = interpretProbe({ exitCode: 1, stdout: "", stderr: "" });
    expect(r.version).toBeNull();
    expect(r.problem).toContain("1");
  });
  test("a non-zero exit that still printed something keeps the text AND flags it", () => {
    // Usually a CLI spelling its version flag differently — the output says so, so surface both.
    const r = interpretProbe({ exitCode: 2, stdout: "unknown flag: --version\n" });
    expect(r.version).toBe("unknown flag: --version");
    expect(r.problem).toContain("2");
  });
  test("leading blank lines are skipped rather than reported as an empty version", () => {
    expect(interpretProbe({ exitCode: 0, stdout: "\n\n  1.18.4\n" }).version).toBe("1.18.4");
  });
});

describe("versionArgs", () => {
  test("asks every known backend for its version without running a turn", () => {
    for (const d of Object.values(BACKENDS)) {
      const args = versionArgs(d.binary);
      expect(args.length).toBeGreaterThan(0);
      // The probe must never be capable of starting an agent, a daemon, or a login flow.
      for (const a of args) {
        expect(a).not.toMatch(/^(run|exec|serve|gateway|hub|auth|login|acp|onboard|configure)$/);
      }
    }
  });
});

describe("surfaceSummary", () => {
  test("mirrors the catalog rather than restating it (claude supports every surface)", () => {
    const s = surfaceSummary(BACKENDS.claude);
    expect(s).toEqual({
      chat: true,
      terminal: true,
      agentsGraph: "hooks",
      daemon: true,
      mcp: "cli",
      memory: "hooks",
    });
  });
  test("reports a backend that cannot run a daemon as such", () => {
    // Only Claude can enforce the vault visibility gate, so only Claude runs a vault brain today.
    expect(surfaceSummary(BACKENDS.opencode).daemon).toBe(false);
    expect(surfaceSummary(BACKENDS.cline).daemon).toBe(false);
  });
});
