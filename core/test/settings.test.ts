// core/test/settings.test.ts
import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeNote } from "../src/files";
import { readSettings, getVaultSchema } from "../src/settings";

async function emptyVault(): Promise<string> {
  return mkdtempSync(join(tmpdir(), "oa-settings-"));
}

test("readSettings returns null when settings.yaml is absent", async () => {
  const vault = await emptyVault();
  expect(await readSettings(vault)).toBeNull();
});

test("readSettings returns raw text + parsed data", async () => {
  const vault = await emptyVault();
  await writeNote(vault, "settings.yaml", "appearance:\n  theme: light\n");
  const res = await readSettings(vault);
  expect(res).not.toBeNull();
  expect(res!.raw).toContain("theme: light");
  expect(res!.data).toEqual({ appearance: { theme: "light" } });
});

test("readSettings tolerates malformed YAML by returning empty data", async () => {
  const vault = await emptyVault();
  await writeNote(vault, "settings.yaml", "appearance:\n  theme: : : broken\n");
  const res = await readSettings(vault);
  expect(res).not.toBeNull();
  expect(res!.data).toEqual({});
});

test("getVaultSchema parses the properties section into a registry", async () => {
  const vault = await emptyVault();
  await writeNote(
    vault,
    "settings.yaml",
    "properties:\n  due: date\n  status:\n    enum: [todo, doing, done]\n",
  );
  const schema = await getVaultSchema(vault);
  expect(schema.due.type).toBe("date");
  expect(schema.status.type).toEqual({ kind: "enum", values: ["todo", "doing", "done"] });
});

test("getVaultSchema is empty when there is no settings.yaml", async () => {
  const vault = await emptyVault();
  expect(await getVaultSchema(vault)).toEqual({});
});
