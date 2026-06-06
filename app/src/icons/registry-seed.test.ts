// app/src/icons/registry-seed.test.ts
//
// Guards the eager icon seed: every icon the app's command catalog references
// MUST be in the seed so it renders instantly (no flash). This test is pure —
// it never imports registry.ts / lucide-solid (which throws outside a DOM) — it
// compares the command catalog against SEED_ICON_NAMES, the lucide-free mirror.
import { test, expect } from "bun:test";
import { COMMAND_CATALOG } from "../../../core/src/commands";
import { SEED_ICON_NAMES, assertSeedMatchesNames } from "./seedNames";
import { normalizeIconKey } from "./registry-core";

// Resolve a spec to a seeded name the same way registry-core does: direct
// normalized match, then the "…Icon" alias and "Li/Lu" prefix fallbacks.
const seedKeys = new Set(SEED_ICON_NAMES.map(normalizeIconKey));
const isSeeded = (spec: string): boolean => {
  const norm = normalizeIconKey(spec);
  if (seedKeys.has(norm)) return true;
  if (norm.endsWith("icon") && norm.length > 4 && seedKeys.has(norm.slice(0, -4))) return true;
  const m = /^(?:li|lu)(.+)$/.exec(norm);
  return !!m && seedKeys.has(m[1]);
};

test("every command-catalog icon is in the eager seed (renders instantly)", () => {
  const missing = COMMAND_CATALOG
    .map((c) => c.icon)
    .filter((icon): icon is string => typeof icon === "string" && icon.length > 0)
    .filter((icon) => !isSeeded(icon));
  expect(missing).toEqual([]);
});

test("assertSeedMatchesNames accepts a matching key set", () => {
  expect(() => assertSeedMatchesNames([...SEED_ICON_NAMES])).not.toThrow();
});

test("assertSeedMatchesNames throws on drift in either direction", () => {
  expect(() => assertSeedMatchesNames([...SEED_ICON_NAMES, "Banana"])).toThrow(/drift/);
  expect(() => assertSeedMatchesNames(SEED_ICON_NAMES.slice(1))).toThrow(/drift/);
});

test("seed names are unique and normalize uniquely", () => {
  expect(new Set(SEED_ICON_NAMES).size).toBe(SEED_ICON_NAMES.length);
  expect(new Set(SEED_ICON_NAMES.map(normalizeIconKey)).size).toBe(SEED_ICON_NAMES.length);
});
