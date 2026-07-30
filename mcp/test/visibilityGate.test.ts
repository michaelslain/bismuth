import { test, expect, describe } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decideCliGate, gateCliArgs, isContentScanningCommand, mcpChannel } from "../src/visibilityGate";

// The hole this gate closes, restated so a future reader knows what not to "simplify" away:
// `bismuth read Private/secret.md` returns a hidden note verbatim. Claude sessions were protected by
// the SDK-specific `disallowedTools: ["mcp__bismuth__bismuth_cli"]`. Bismuth registers this MCP with
// up to ten OTHER agent CLIs it cannot hand a disallowedTools list, so without this gate the
// visibility feature is Claude-only in practice while looking universal.

const RESTRICTED = [{ rel: "Private/secret.md", abs: "/vaults/v/Private/secret.md" }];

describe("mcpChannel", () => {
  test("defaults to the STRICTER daemon channel when unset or unrecognized", () => {
    // Fail-safe: a spawner that forgets to declare itself must not get the permissive answer.
    expect(mcpChannel({})).toBe("daemon");
    expect(mcpChannel({ BISMUTH_MCP_CHANNEL: "nonsense" })).toBe("daemon");
    expect(mcpChannel({ BISMUTH_MCP_CHANNEL: "" })).toBe("daemon");
  });
  test("honours an explicit chat channel", () => {
    expect(mcpChannel({ BISMUTH_MCP_CHANNEL: "chat" })).toBe("chat");
  });
});

describe("decideCliGate", () => {
  test("allows everything when the vault restricts nothing", () => {
    expect(decideCliGate(["read", "Private/secret.md"], []).allowed).toBe(true);
  });
  test("refuses a restricted path named relatively", () => {
    const d = decideCliGate(["read", "Private/secret.md"], RESTRICTED);
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain("Private/secret.md");
  });
  test("refuses the same file named ABSOLUTELY — both path forms are load-bearing", () => {
    // The exact bug docs/vault/visibility.md records for Claude's deny list: a gate keyed on one
    // path form silently fails on the other.
    expect(decideCliGate(["read", "/vaults/v/Private/secret.md"], RESTRICTED).allowed).toBe(false);
  });
  test("refuses a path embedded in a flag value or a query string", () => {
    expect(decideCliGate(["prop", "get", "--path=Private/secret.md"], RESTRICTED).allowed).toBe(false);
    expect(decideCliGate(["api", "GET", "/file?path=Private/secret.md"], RESTRICTED).allowed).toBe(false);
  });
  test("refuses a case-variant path — macOS filesystems are case-insensitive", () => {
    expect(decideCliGate(["read", "private/SECRET.md"], RESTRICTED).allowed).toBe(false);
  });
  test("allows an unrelated visible file while something else is restricted", () => {
    expect(decideCliGate(["read", "open.md"], RESTRICTED).allowed).toBe(true);
  });
  test("refuses content-scanning commands wholesale when ANYTHING is restricted", () => {
    // A per-path check cannot catch these: they surface a hidden file's matching LINES without ever
    // naming it. Same reason Claude disables Grep/Glob outright.
    for (const cmd of ["search", "replace", "api", "export", "grep"]) {
      const d = decideCliGate([cmd, "THE-SECRET"], RESTRICTED);
      expect(d.allowed).toBe(false);
      expect(d.reason).toContain(cmd);
    }
  });
  test("allows those same commands when nothing is restricted", () => {
    expect(decideCliGate(["search", "anything"], []).allowed).toBe(true);
  });
  test("does not refuse a command that merely CONTAINS a scanning command's name", () => {
    expect(isContentScanningCommand(["researcher"])).toBe(false);
    expect(isContentScanningCommand(["tree"])).toBe(false);
  });
});

describe("gateCliArgs (end to end against a real vault)", () => {
  function makeVault(): string {
    const root = mkdtempSync(join(tmpdir(), "bismuth-vis-gate-"));
    mkdirSync(join(root, "Private"), { recursive: true });
    writeFileSync(join(root, "Private", "secret.md"), "---\nvisibility: hidden\n---\nTHE-SECRET-STRING-42\n");
    writeFileSync(join(root, "Private", "chatty.md"), "---\nvisibility: chat-only\n---\nchat may see this\n");
    writeFileSync(join(root, "open.md"), "ordinary\n");
    return root;
  }

  test("refuses reading a hidden note — the regression this gate exists for", async () => {
    const root = makeVault();
    const d = await gateCliArgs(["read", "Private/secret.md"], { BISMUTH_VAULT: root });
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain("Private/secret.md");
  });

  test("allows reading an unrestricted note", async () => {
    const root = makeVault();
    expect((await gateCliArgs(["read", "open.md"], { BISMUTH_VAULT: root })).allowed).toBe(true);
  });

  test("a chat-only note is refused on the daemon channel but allowed on chat", async () => {
    // The whole point of the middle tier, and the reason the channel default matters.
    const root = makeVault();
    const asDaemon = await gateCliArgs(["read", "Private/chatty.md"], { BISMUTH_VAULT: root });
    const asChat = await gateCliArgs(["read", "Private/chatty.md"], { BISMUTH_VAULT: root, BISMUTH_MCP_CHANNEL: "chat" });
    expect(asDaemon.allowed).toBe(false);
    expect(asChat.allowed).toBe(true);
  });

  test("a hidden note stays refused even on the chat channel", async () => {
    const root = makeVault();
    const asChat = await gateCliArgs(["read", "Private/secret.md"], { BISMUTH_VAULT: root, BISMUTH_MCP_CHANNEL: "chat" });
    expect(asChat.allowed).toBe(false);
  });

  test("no vault configured allows through — nothing to protect, and docs/help need no vault", async () => {
    expect((await gateCliArgs(["--help"], {})).allowed).toBe(true);
  });

  test("an unreadable vault REFUSES rather than allowing", async () => {
    // A gate that opens when it malfunctions is not a gate. buildDenyPaths tolerates a missing dir by
    // returning [], so assert the stronger property directly: a thrown resolution refuses.
    const d = await gateCliArgs(["read", "x.md"], { BISMUTH_VAULT: "\0invalid" });
    expect(d.allowed).toBe(false);
  });
});
