import { test, expect, describe } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  commandTier,
  decideCliGate,
  gateCliArgs,
  gateCliInvocation,
  mcpChannel,
  cliAgentChannel,
} from "../src/visibilityCliGate";

// The hole this gate closes, restated so a future reader knows what not to "simplify" away:
// `bismuth read Private/secret.md` returns a hidden note verbatim, whether run through the
// `bismuth_cli` MCP tool (gateCliArgs) OR as a bare Bash subprocess with no MCP layer at all
// (gateCliInvocation, hooked at the CLI's own dispatch point). Claude sessions were protected by
// the SDK-specific `disallowedTools: ["mcp__bismuth__bismuth_cli"]`, which touches only the MCP
// calling convention — Bash is deliberately never disallowed (the daemon needs `bismuth checkpoint`).

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

describe("cliAgentChannel", () => {
  test("ABSENT means the OWNER's own hand — 'owner', not a channel", () => {
    // This is the crux of the CLI's own gate: get this backwards and either the owner is locked
    // out of their own CLI, or every agent that forgets to stamp the var is ungated.
    expect(cliAgentChannel({})).toBe("owner");
  });
  test("an explicit chat/daemon value is honoured", () => {
    expect(cliAgentChannel({ BISMUTH_AGENT_CHANNEL: "chat" })).toBe("chat");
    expect(cliAgentChannel({ BISMUTH_AGENT_CHANNEL: "daemon" })).toBe("daemon");
  });
  test("a garbled NON-EMPTY value fails safe to 'daemon', NOT to 'owner'", () => {
    // Unset and garbled must not collapse to the same answer — a corrupted signal should still gate.
    expect(cliAgentChannel({ BISMUTH_AGENT_CHANNEL: "nonsense" })).toBe("daemon");
    // NOTE: an EMPTY value used to assert "daemon" here. The acceptance run showed that locks the
    // OWNER out of their own CLI (`export BISMUTH_AGENT_CHANNEL=` is ordinary in a human shell), and
    // Bismuth never writes an empty value itself. See the dedicated empty-value test below.
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
  test("refuses content-surfacing commands wholesale when ANYTHING is restricted", () => {
    // These return a hidden file's matching LINES without ever naming it, so no path check can catch
    // them. Same reason Claude disables Grep/Glob outright.
    for (const cmd of ["search", "replace", "api", "export"]) {
      const d = decideCliGate([cmd, "THE-SECRET"], RESTRICTED);
      expect(d.allowed).toBe(false);
      expect(d.reason).toContain(cmd);
    }
  });
  test("refuses `bismuth api` — a passthrough to ANY server route, including the ambient GET /file oracle", () => {
    expect(decideCliGate(["api", "GET", "/file?path=Private/secret.md"], RESTRICTED).allowed).toBe(false);
  });
  test("refuses `bismuth serve` when restricted — it spins up another unauthenticated content oracle", () => {
    // A restricted vault must not let an agent shell out to its OWN fresh core server and curl the
    // unfiltered GET /file / POST /search / POST /rows routes from the same Bash tool.
    expect(decideCliGate(["serve", "--port", "9999"], RESTRICTED).allowed).toBe(false);
  });
  test("allows `bismuth serve` when nothing is restricted", () => {
    expect(decideCliGate(["serve"], []).allowed).toBe(true);
  });
  test("refuses `checkpoint diff` — a git diff is the plaintext of every changed hidden note", () => {
    // The denylist this gate started with MISSED this one, and the daemon's PATH shim exists partly
    // to make `checkpoint` reachable. Found by red-teaming, not by writing more denylist entries.
    expect(decideCliGate(["checkpoint", "diff"], RESTRICTED).allowed).toBe(false);
  });
  test("allows `checkpoint advance`/`checkpoint ref` even when restricted — no content leaves either", () => {
    // Unlike `checkpoint diff`, these touch only a ref pointer. The daemon's own crons
    // (Feature #51 change-scoping) legitimately call these, and a restricted vault must not brick
    // that — this is why checkpoint needs a COMPOUND override rather than a whole-group tier.
    expect(decideCliGate(["checkpoint", "advance"], RESTRICTED).allowed).toBe(true);
    expect(decideCliGate(["checkpoint", "ref"], RESTRICTED).allowed).toBe(true);
  });
  test("refuses the other content-bearing commands the denylist missed", () => {
    for (const cmd of ["rows", "card", "task", "calendar", "graph", "tree", "daily", "note", "base", "row", "templates"]) {
      expect(decideCliGate([cmd, "x"], RESTRICTED).allowed).toBe(false);
    }
  });
  test("an UNKNOWN command refuses — a future CLI command must not fail open", () => {
    // The whole point of inverting the denylist: this build cannot know what the CLI grows next.
    expect(decideCliGate(["some-new-command", "x"], RESTRICTED).allowed).toBe(false);
    expect(commandTier(["some-new-command"])).toBe("refuse-when-restricted");
  });
  test("an UNKNOWN checkpoint subcommand refuses too — only advance/ref are overridden", () => {
    expect(decideCliGate(["checkpoint", "some-future-subcommand"], RESTRICTED).allowed).toBe(false);
  });
  test("machine/app/daemon plumbing stays usable in a restricted vault", () => {
    // A restricted vault must not brick the agent's ability to drive the app or report status.
    for (const cmd of ["backends", "app", "daemon", "install", "settings", "page"]) {
      expect(decideCliGate([cmd, "status"], RESTRICTED).allowed).toBe(true);
    }
    expect(decideCliGate(["--help"], RESTRICTED).allowed).toBe(true);
    expect(decideCliGate([], RESTRICTED).allowed).toBe(true);
  });
  test("allows those same commands when nothing is restricted", () => {
    expect(decideCliGate(["search", "anything"], []).allowed).toBe(true);
    expect(decideCliGate(["checkpoint", "diff"], []).allowed).toBe(true);
    expect(decideCliGate(["serve"], []).allowed).toBe(true);
  });
});

describe("gateCliArgs (the MCP path, end to end against a real vault)", () => {
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

  test("a --vault FLAG (not just the env var) is also honored, matching requireVault's own resolution", async () => {
    // mcp/src/cli.ts passes process.env through unchanged, but an agent can still pass --vault
    // explicitly in argv; a gate that only checked env would miss it entirely.
    const root = makeVault();
    const d = await gateCliArgs(["read", "Private/secret.md", "--vault", root], {});
    expect(d.allowed).toBe(false);
  });
});

describe("gateCliInvocation (the CLI's own dispatch-point gate)", () => {
  function makeVault(): string {
    const root = mkdtempSync(join(tmpdir(), "bismuth-vis-gate-direct-"));
    mkdirSync(join(root, "Private"), { recursive: true });
    writeFileSync(join(root, "Private", "secret.md"), "---\nvisibility: hidden\n---\nTHE-SECRET-STRING-42\n");
    writeFileSync(join(root, "open.md"), "ordinary\n");
    return root;
  }

  test("BISMUTH_AGENT_CHANNEL unset — the OWNER's own hand — reads a hidden note straight through", async () => {
    const root = makeVault();
    const d = await gateCliInvocation(["read", "Private/secret.md", "--vault", root], {});
    expect(d.allowed).toBe(true);
  });

  test("the SAME command, same vault, with BISMUTH_AGENT_CHANNEL=daemon — refuses", async () => {
    const root = makeVault();
    const d = await gateCliInvocation(["read", "Private/secret.md", "--vault", root], {
      BISMUTH_AGENT_CHANNEL: "daemon",
    });
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain("Private/secret.md");
  });

  test("BISMUTH_AGENT_CHANNEL=chat also refuses a HIDDEN note (hidden means hidden from chat too)", async () => {
    const root = makeVault();
    const d = await gateCliInvocation(["read", "Private/secret.md", "--vault", root], {
      BISMUTH_AGENT_CHANNEL: "chat",
    });
    expect(d.allowed).toBe(false);
  });

  test("an agent channel still reads an UNRESTRICTED note fine", async () => {
    const root = makeVault();
    const d = await gateCliInvocation(["read", "open.md", "--vault", root], { BISMUTH_AGENT_CHANNEL: "daemon" });
    expect(d.allowed).toBe(true);
  });

  test("resolves the vault from the --vault ARGV flag, exactly like requireVault — env alone is not enough", async () => {
    // The daemon's own Bash tool never gets BISMUTH_VAULT in its env (only the MCP server's own env
    // block sets it) — it passes --vault explicitly, using its cwd. A gate that only checked env
    // would be a no-op for exactly this, the primary invocation shape this file exists to cover.
    const root = makeVault();
    const d = await gateCliInvocation(["read", "Private/secret.md", "--vault", root], {
      BISMUTH_AGENT_CHANNEL: "daemon",
      BISMUTH_VAULT: undefined,
    });
    expect(d.allowed).toBe(false);
  });

  test("`checkpoint diff` refuses under an agent channel, resolving the vault from --dir alone (no --vault/env)", async () => {
    // checkpoint.ts's own flag is --dir, not --vault (it's generic over any tracked repo — the
    // dream cron points it at the memory dir). A gate that only checked --vault/BISMUTH_VAULT would
    // be a no-op for the exact invocation shape `bismuth checkpoint diff <ref> --dir <path>` uses.
    const root = makeVault();
    const d = await gateCliInvocation(["checkpoint", "diff", "some-ref", "--dir", root], {
      BISMUTH_AGENT_CHANNEL: "daemon",
    });
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain("checkpoint");
  });

  test("`checkpoint diff` is NOT refused for the owner (channel unset), --dir only", async () => {
    const root = makeVault();
    const d = await gateCliInvocation(["checkpoint", "diff", "some-ref", "--dir", root], {});
    expect(d.allowed).toBe(true);
  });

  test("`checkpoint advance`/`checkpoint ref` stay usable under an agent channel via --dir", async () => {
    const root = makeVault();
    for (const sub of ["advance", "ref"]) {
      const d = await gateCliInvocation(["checkpoint", sub, "some-ref", "--dir", root], {
        BISMUTH_AGENT_CHANNEL: "daemon",
      });
      expect(d.allowed).toBe(true);
    }
  });

  test("app/daemon/install plumbing stays usable under an agent channel, in a restricted vault", async () => {
    const root = makeVault();
    for (const args of [["app", "tabs"], ["daemon", "status"], ["install", "--status"], ["backends"]]) {
      const d = await gateCliInvocation(args, { BISMUTH_AGENT_CHANNEL: "daemon", BISMUTH_VAULT: root });
      expect(d.allowed).toBe(true);
    }
  });

  test("no vault at all allows through regardless of channel — nothing to protect", async () => {
    expect((await gateCliInvocation(["--help"], { BISMUTH_AGENT_CHANNEL: "daemon" })).allowed).toBe(true);
  });
});

test("an EMPTY channel value is the owner, not an agent — found by the acceptance run", () => {
  // `export BISMUTH_AGENT_CHANNEL=` is ordinary in a human's shell, and Bismuth never writes an
  // empty value itself, so an empty one can only be the owner's. Treating it as an agent locked the
  // owner out of their own CLI — a violation of the one non-negotiable this feature has.
  expect(cliAgentChannel({ BISMUTH_AGENT_CHANNEL: "" })).toBe("owner");
  expect(cliAgentChannel({ BISMUTH_AGENT_CHANNEL: "   " })).toBe("owner");
  expect(cliAgentChannel({})).toBe("owner");
  // A garbled NON-empty value still fails safe to the stricter channel.
  expect(cliAgentChannel({ BISMUTH_AGENT_CHANNEL: "nonsense" })).toBe("daemon");
  expect(cliAgentChannel({ BISMUTH_AGENT_CHANNEL: "chat" })).toBe("chat");
});
