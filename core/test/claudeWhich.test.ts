import { describe, expect, test, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nvmBinPaths, claudeLookupPath } from "../src/claudeWhich";

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
});
