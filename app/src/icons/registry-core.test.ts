// app/src/icons/registry-core.test.ts
import { test, expect } from "bun:test";
import { createIconRegistry, normalizeIconKey } from "./registry-core";

// A fake manifest standing in for lucide-solid's `icons` (PascalCase -> component).
// Values are sentinel strings so we can assert which icon resolved.
const manifest: Record<string, string> = {
  House: "house-cmp",
  CarFront: "carfront-cmp",
  Signpost: "signpost-cmp", // Lucide spells it "Signpost", vault has "LiSignPost"
  Grid3x2: "grid-cmp",
  List: "list-cmp", // guards against over-eager "Li" stripping
  Library: "library-cmp",
  FileText: "filetext-cmp",
};

test("normalizeIconKey lowercases and strips non-alphanumerics", () => {
  expect(normalizeIconKey("CarFront")).toBe("carfront");
  expect(normalizeIconKey("car-front")).toBe("carfront");
  expect(normalizeIconKey("Grid3x2")).toBe("grid3x2");
});

test("resolves canonical PascalCase names", () => {
  const r = createIconRegistry(manifest);
  expect(r.resolve("House")).toBe("house-cmp");
  expect(r.resolve("FileText")).toBe("filetext-cmp");
});

test("resolves kebab-case and arbitrary casing", () => {
  const r = createIconRegistry(manifest);
  expect(r.resolve("car-front")).toBe("carfront-cmp");
  expect(r.resolve("CARFRONT")).toBe("carfront-cmp");
  expect(r.resolve("filetext")).toBe("filetext-cmp");
});

test("resolves the legacy Li/Lu prefix as a fallback", () => {
  const r = createIconRegistry(manifest);
  expect(r.resolve("LiHouse")).toBe("house-cmp");
  expect(r.resolve("LuHouse")).toBe("house-cmp");
  // Vault has "LiSignPost" but Lucide is "Signpost" — case-insensitive match wins.
  expect(r.resolve("LiSignPost")).toBe("signpost-cmp");
});

test("direct match beats Li/Lu stripping", () => {
  const r = createIconRegistry(manifest);
  // "List" is a real icon — must NOT be stripped to "st".
  expect(r.resolve("List")).toBe("list-cmp");
  expect(r.resolve("LiList")).toBe("list-cmp"); // direct "lilist" misses, strip -> "List"
  // "Library" normalizes directly to "library" even though it starts with "Li".
  expect(r.resolve("Library")).toBe("library-cmp");
  expect(r.resolve("LiBrary")).toBe("library-cmp");
});

test("returns null for emoji / arbitrary glyphs / empty", () => {
  const r = createIconRegistry(manifest);
  expect(r.resolve("🪶")).toBeNull();
  expect(r.resolve("✨")).toBeNull();
  expect(r.resolve("not-an-icon-xyz")).toBeNull();
  expect(r.resolve("")).toBeNull();
  expect(r.resolve("   ")).toBeNull();
  expect(r.resolve(null)).toBeNull();
  expect(r.resolve(undefined)).toBeNull();
});

test("all() and names() are sorted by canonical name", () => {
  const r = createIconRegistry(manifest);
  const names = r.names();
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  expect(names).toContain("CarFront");
  expect(r.all().find((e) => e.name === "House")?.Component).toBe("house-cmp");
});
