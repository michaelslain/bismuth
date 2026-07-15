// core/test/gcal/manifest.test.ts
// The per-base sync manifest: round-trip, per-base keying, and MIGRATION of the old
// single-base shape ({ links, basePath }) into { bases: { [basePath]: … } }.
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readManifest, writeManifest, baseSyncOf, gcalDir, type SyncManifest } from "../../src/gcal/manifest";

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "bismuth-gcal-man-")); });
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

const writeRaw = (obj: unknown) => {
  mkdirSync(gcalDir(home), { recursive: true });
  writeFileSync(join(gcalDir(home), "sync.json"), JSON.stringify(obj));
};

test("absent manifest → empty per-base map", () => {
  expect(readManifest(home)).toEqual({ bases: {} });
});

test("round-trips a per-base manifest", () => {
  const m: SyncManifest = {
    bases: {
      "Work.md": { calendarId: "work", syncToken: "t1", lastSyncAt: "2026-01-01", links: { "g1": { bismuthId: "b1", etag: "e1" } } },
      "Home.md": { calendarId: "home", links: {} },
    },
  };
  writeManifest(m, home);
  expect(readManifest(home)).toEqual(m);
});

test("baseSyncOf creates a fresh entry and mutations persist", () => {
  const m = readManifest(home);
  const bs = baseSyncOf(m, "New.md");
  expect(bs).toEqual({ links: {} });
  bs.calendarId = "cal-x";
  bs.links["gid"] = { bismuthId: "bid" };
  writeManifest(m, home);
  expect(readManifest(home).bases["New.md"]).toEqual({ calendarId: "cal-x", links: { gid: { bismuthId: "bid" } } });
});

test("two bases keep independent link maps", () => {
  const m = readManifest(home);
  baseSyncOf(m, "A.md").links["ga"] = { bismuthId: "a" };
  baseSyncOf(m, "B.md").links["gb"] = { bismuthId: "b" };
  writeManifest(m, home);
  const back = readManifest(home);
  expect(Object.keys(back.bases["A.md"].links)).toEqual(["ga"]);
  expect(Object.keys(back.bases["B.md"].links)).toEqual(["gb"]);
});

test("MIGRATION: legacy single-base manifest nests under its bound base path", () => {
  writeRaw({
    lastSyncAt: "2026-05-01",
    syncToken: "old-token",
    basePath: "Legacy Calendar.md",
    links: { "g-old": { bismuthId: "b-old", etag: "e", updated: "u", sig: "s" } },
  });
  const m = readManifest(home);
  expect(m.bases["Legacy Calendar.md"]).toEqual({
    lastSyncAt: "2026-05-01",
    syncToken: "old-token",
    links: { "g-old": { bismuthId: "b-old", etag: "e", updated: "u", sig: "s" } },
  });
});

test("MIGRATION: a legacy manifest with no basePath drops to empty (nothing to bind)", () => {
  writeRaw({ links: { "g": { bismuthId: "b" } } });
  expect(readManifest(home)).toEqual({ bases: {} });
});
