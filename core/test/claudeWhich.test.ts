import { describe, expect, test, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { nvmBinPaths, claudeLookupPath, claudeSpawnEnv } from "../src/claudeWhich";

// The real OS username, resolved the SAME way claudeSpawnEnv does (`id -un`), not via node:os's
// userInfo() — Bun's userInfo().username is exactly the thing BUG #8 discovered is unreliable
// once $USER/$LOGNAME are absent (falls back to the literal string "unknown" instead of resolving
// via the OS user db like Node's own implementation does), so the test must not lean on it either.
const realUsername = Bun.spawnSync(["/usr/bin/id", "-un"]).stdout.toString().trim();

const tmps: string[] = [];
afterEach(() => {
  for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true });
});

function makeNvm(versions: string[], defaultAlias?: string): string {
  const root = mkdtempSync(join(tmpdir(), "nvm-test-"));
  tmps.push(root);
  for (const v of versions) mkdirSync(join(root, "versions", "node", v, "bin"), { recursive: true });
  if (defaultAlias !== undefined) {
    mkdirSync(join(root, "alias"), { recursive: true });
    writeFileSync(join(root, "alias", "default"), defaultAlias + "\n");
  }
  return root;
}
const bin = (root: string, v: string) => join(root, "versions", "node", v, "bin");

describe("nvmBinPaths", () => {
  test("returns nothing when NVM_DIR is absent", () => {
    expect(nvmBinPaths({ NVM_DIR: join(tmpdir(), "nvm-missing-xyz-123") })).toEqual([]);
  });

  test("lists installed version bins newest-first (numeric-aware, not lexicographic)", () => {
    const dir = makeNvm(["v8.17.0", "v20.11.0", "v18.16.0"]);
    expect(nvmBinPaths({ NVM_DIR: dir })).toEqual([
      bin(dir, "v20.11.0"),
      bin(dir, "v18.16.0"),
      bin(dir, "v8.17.0"),
    ]);
  });

  test("prefers the default-alias version stored without a v prefix", () => {
    const dir = makeNvm(["v20.11.0", "v18.16.0"], "18.16.0");
    const out = nvmBinPaths({ NVM_DIR: dir });
    expect(out[0]).toBe(bin(dir, "v18.16.0"));
    expect(out).toContain(bin(dir, "v20.11.0"));
  });

  test("prefers the default-alias version stored with a v prefix", () => {
    const dir = makeNvm(["v20.11.0", "v18.16.0"], "v20.11.0");
    expect(nvmBinPaths({ NVM_DIR: dir })[0]).toBe(bin(dir, "v20.11.0"));
  });

  test("falls back to newest-first when the default alias is unresolvable (e.g. 'node')", () => {
    const dir = makeNvm(["v20.11.0", "v18.16.0"], "node");
    expect(nvmBinPaths({ NVM_DIR: dir })[0]).toBe(bin(dir, "v20.11.0"));
  });
});

describe("claudeLookupPath", () => {
  test("keeps the user's PATH first, then appends homebrew/local and nvm bins", () => {
    const dir = makeNvm(["v20.11.0"]);
    const out = claudeLookupPath({ PATH: "/usr/bin", NVM_DIR: dir });
    expect(out.indexOf("/usr/bin")).toBeLessThan(out.indexOf("/opt/homebrew/bin"));
    expect(out).toContain(bin(dir, "v20.11.0"));
  });

  // BUG #8 (4th bounce) ROOT CAUSE, part 1: reproduced a real failure where `env.PATH` was
  // completely empty/undefined — the augmented PATH used to carry ONLY the extra dirs
  // (homebrew/bun/local/nvm), missing `/usr/bin` entirely. `claude` shells out to
  // `/usr/bin/security` by bare name internally (see claudeSpawnEnv); without `/usr/bin` on
  // PATH that lookup silently fails and `claude` reports "Not logged in" even with a correct
  // $USER. The base POSIX dirs must always be present, not just relied on via env.PATH.
  test("always includes the base POSIX system dirs, even when env.PATH is empty/undefined", () => {
    const out = claudeLookupPath({});
    for (const dir of ["/usr/bin", "/bin", "/usr/sbin", "/sbin"]) expect(out.split(":")).toContain(dir);
  });
});

// BUG #8 (4th bounce) ROOT CAUSE: the spawned `claude` CHILD needs a working env to actually
// authenticate — reproduced two independent ways (see claudeSpawnEnv's doc comment): $USER/
// $LOGNAME missing (Keychain account lookup misses), or $PATH missing `/usr/bin` (the `security`
// shellout itself can't be found). Either way `claude` reports "Not logged in · Please run
// /login" as a normal-looking result message, even though the user genuinely is logged in.
describe("claudeSpawnEnv (BUG #8 4th-bounce root cause: a bare/partial env breaks claude auth)", () => {
  test("fills USER/LOGNAME/HOME/PATH from the OS when the host env has none of them", () => {
    const out = claudeSpawnEnv({});
    expect(out.USER).toBe(realUsername);
    expect(out.LOGNAME).toBe(realUsername);
    expect(out.HOME).toBe(homedir());
    expect(out.PATH).toContain("/opt/homebrew/bin"); // claudeLookupPath's augmentation applied too
    expect(out.PATH).toContain("/usr/bin"); // …including the base POSIX dirs `security` needs
  });

  test("never clobbers an already-correct USER/LOGNAME/HOME (only fills gaps)", () => {
    const out = claudeSpawnEnv({ USER: "alice", LOGNAME: "alice", HOME: "/Users/alice", PATH: "/usr/bin" });
    expect(out.USER).toBe("alice");
    expect(out.LOGNAME).toBe("alice");
    expect(out.HOME).toBe("/Users/alice");
    expect(out.PATH).toContain("/usr/bin");
    expect(out.PATH).toContain("/opt/homebrew/bin");
  });

  test("preserves every other inherited env var (spread, not a replacement)", () => {
    const out = claudeSpawnEnv({ SOME_OTHER_VAR: "kept" });
    expect(out.SOME_OTHER_VAR).toBe("kept");
  });
});
