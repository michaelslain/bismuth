// core/test/gcal/percalendar.test.ts
// PER-CALENDAR sync: two calendar bases → two Google calendarIds → each syncs its OWN
// calendar, with independent manifest entries. Covers (1) discovery of sync-enabled bases +
// their resolved calendarId (flat top-level keys AND nested view keys), and (2) two bases
// reconciling against different calendars without cross-contaminating events or links.
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncEvents } from "../../src/gcal/sync";
import { readManifest } from "../../src/gcal/manifest";
import { listGcalSyncTargets } from "../../src/gcal/discover";
import { parseBaseFile } from "../../src/bases/parse";
import { reassemble } from "../../src/bases/rowOps";
import type { Row } from "../../src/bases/types";

const realFetch = globalThis.fetch;
let vault: string;
let home: string;

const BASE_T = Date.parse("2026-06-23T00:00:00Z");
let tick = 0;
const nextUpdated = () => new Date(BASE_T + ++tick * 1000).toISOString();
const at = (sec: number) => new Date(BASE_T + sec * 1000).toISOString();

function emptyFile(path: string): Row["file"] {
  const name = path.split("/").pop() ?? path;
  return { name, basename: name, path, folder: "", ext: "md", size: 0, ctime: 0, mtime: 0, tags: [], links: [] };
}
/** Write a calendar base at `path` with the given top-level frontmatter + event rows. */
function writeCal(path: string, frontmatter: string, notes: Array<Record<string, unknown>> = []) {
  const head = `---\ntype: base\nviews:\n  - type: calendar\ncategories: []\n${frontmatter}---\n`;
  const rows: Row[] = notes.map((note) => ({ file: emptyFile(path), note, formula: {} }));
  writeFileSync(join(vault, path), reassemble(head, rows));
}
function readRows(path: string): Array<Record<string, unknown>> {
  const name = path.split("/").pop() ?? path;
  return parseBaseFile(readFileSync(join(vault, path), "utf8"), { name, path }).rows.map((r) => r.note);
}

// A Google fake that stores events PER calendarId — so a sync against "work" can never see or
// touch "home"'s events. Supports list (full + token), insert (deterministic id), patch, delete.
class CalFakeGoogle {
  cals = new Map<string, Map<string, any>>();
  etagN = 1;
  version = 0;
  cal(id: string): Map<string, any> {
    let c = this.cals.get(id);
    if (!c) { c = new Map(); this.cals.set(id, c); }
    return c;
  }
  seed(calId: string, ev: Record<string, any>) {
    this.cal(calId).set(ev.id, { etag: `etag${this.etagN++}`, updated: nextUpdated(), status: "confirmed", ...ev, _v: ++this.version });
  }
  install() {
    globalThis.fetch = (async (input: any, init: any) => {
      const u = new URL(typeof input === "string" ? input : input.url);
      const method = (init?.method ?? "GET").toUpperCase();
      const headers = new Headers(init?.headers ?? {});
      const m = u.pathname.match(/\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/);
      const calId = m ? decodeURIComponent(m[1]) : "";
      const id = m && m[2] ? decodeURIComponent(m[2]) : undefined;
      const events = this.cal(calId);
      const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
      if (method === "GET" && !id) {
        const syncToken = u.searchParams.get("syncToken");
        let evs = [...events.values()];
        if (syncToken) { const since = Number(syncToken.slice(1)); evs = evs.filter((e) => e._v > since); }
        return json({ items: evs.map(({ _v, ...e }) => e), nextSyncToken: `v${this.version}` });
      }
      if (method === "GET" && id) {
        const e = events.get(id);
        if (!e) return new Response("nf", { status: 404 });
        const { _v, ...out } = e;
        return json(out);
      }
      if (method === "POST" && !id) {
        const body = JSON.parse(String(init.body));
        if (body.id && events.has(body.id)) return new Response("dup", { status: 409 });
        const newId = body.id ?? `srv-${events.size + 1}`;
        const ev = { ...body, id: newId, etag: `etag${this.etagN++}`, updated: nextUpdated(), status: "confirmed", _v: ++this.version };
        events.set(newId, ev);
        const { _v, ...out } = ev;
        return json(out);
      }
      if (method === "PATCH" && id) {
        const cur = events.get(id);
        const ifMatch = headers.get("If-Match");
        if (ifMatch && cur && ifMatch !== cur.etag) return new Response("pre", { status: 412 });
        const ev = { ...cur, ...JSON.parse(String(init.body)), id, etag: `etag${this.etagN++}`, updated: nextUpdated(), _v: ++this.version };
        events.set(id, ev);
        const { _v, ...out } = ev;
        return json(out);
      }
      if (method === "DELETE" && id) {
        events.delete(id);
        return new Response(null, { status: 204 });
      }
      return new Response("unhandled", { status: 500 });
    }) as unknown as typeof fetch;
  }
}

let g: CalFakeGoogle;
const syncBase = (basePath: string, calendarId: string) =>
  syncEvents({ vault, basePath, calendarId, accessToken: "tok", policy: "lastWriteWins", timeZone: "UTC", manifestHome: home });

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "bismuth-vault-pc-"));
  home = mkdtempSync(join(tmpdir(), "bismuth-home-pc-"));
  tick = 0;
  g = new CalFakeGoogle();
  g.install();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  rmSync(vault, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

test("discovery lists each sync-enabled base with its own calendarId (flat + nested keys)", async () => {
  // Base A: flat top-level per-calendar keys.
  writeCal("Work.md", "googleCalendarSync: true\ngoogleCalendarId: work-cal\n");
  // Base B: keys nested inside the calendar view.
  writeFileSync(
    join(vault, "Home.md"),
    `---\ntype: base\nviews:\n  - type: calendar\n    googleCalendarSync: true\n    googleCalendarId: home-cal\ncategories: []\n---\n`,
  );
  // Base C: a calendar base with sync OFF → not a target.
  writeCal("Off.md", "googleCalendarSync: false\ngoogleCalendarId: nope\n");
  // A plain note (not a base) → ignored.
  writeFileSync(join(vault, "note.md"), `---\ntitle: hi\n---\nbody\n`);

  const targets = await listGcalSyncTargets(vault);
  expect(targets.sort((a, b) => a.basePath.localeCompare(b.basePath))).toEqual([
    { basePath: "Home.md", calendarId: "home-cal" },
    { basePath: "Work.md", calendarId: "work-cal" },
  ]);
});

test("discovery honors the legacy global mapping as a migration fallback", async () => {
  writeCal("Legacy.md", ""); // no per-base keys
  const targets = await listGcalSyncTargets(vault, { enabled: true, calendarId: "legacy-cal", basePath: "Legacy.md" });
  expect(targets).toEqual([{ basePath: "Legacy.md", calendarId: "legacy-cal" }]);
});

test("two bases sync to two different Google calendars, each isolated", async () => {
  // A remote event pre-exists in each calendar; each base also has one local event to push.
  g.seed("work-cal", { id: "w-remote", summary: "Work meeting", start: { date: "2026-06-24" }, end: { date: "2026-06-25" } });
  g.seed("home-cal", { id: "h-remote", summary: "Dinner", start: { date: "2026-06-24" }, end: { date: "2026-06-25" } });
  writeCal("Work.md", "googleCalendarSync: true\ngoogleCalendarId: work-cal\n",
    [{ id: "w-local", title: "Standup", date: "2026-06-25", startTime: "09:00", localUpdated: at(10) }]);
  writeCal("Home.md", "googleCalendarSync: true\ngoogleCalendarId: home-cal\n",
    [{ id: "h-local", title: "Groceries", date: "2026-06-25", startTime: "18:00", localUpdated: at(10) }]);

  const rw = await syncBase("Work.md", "work-cal");
  const rh = await syncBase("Home.md", "home-cal");

  // Each base pulled ONLY its own calendar's remote event + pushed ONLY its own local event.
  expect(rw.pulledNew).toBe(1);
  expect(rw.pushedNew).toBe(1);
  expect(rh.pulledNew).toBe(1);
  expect(rh.pushedNew).toBe(1);

  // Work base ended with its remote + local title; NOT the home base's.
  const workTitles = readRows("Work.md").map((n) => n.title).sort();
  expect(workTitles).toEqual(["Standup", "Work meeting"]);
  const homeTitles = readRows("Home.md").map((n) => n.title).sort();
  expect(homeTitles).toEqual(["Dinner", "Groceries"]);

  // The "work" Google calendar has the pushed local Standup; the "home" one does NOT.
  const workSummaries = [...g.cal("work-cal").values()].map((e) => e.summary).sort();
  expect(workSummaries).toEqual(["Standup", "Work meeting"]);
  const homeSummaries = [...g.cal("home-cal").values()].map((e) => e.summary).sort();
  expect(homeSummaries).toEqual(["Dinner", "Groceries"]);

  // The manifest keeps a SEPARATE entry per base, each remembering its own calendar target.
  const m = readManifest(home);
  expect(m.bases["Work.md"].calendarId).toBe("work-cal");
  expect(m.bases["Home.md"].calendarId).toBe("home-cal");
  // Two links each (the pulled remote + the pushed local), no cross-over.
  expect(Object.keys(m.bases["Work.md"].links)).toHaveLength(2);
  expect(Object.keys(m.bases["Home.md"].links)).toHaveLength(2);
});

test("re-pointing a base at a different calendar drops its old links + token", async () => {
  writeCal("Cal.md", "googleCalendarSync: true\ngoogleCalendarId: cal-1\n",
    [{ id: "e1", title: "Event", date: "2026-06-25", startTime: "09:00", localUpdated: at(10) }]);
  await syncBase("Cal.md", "cal-1");
  expect([...g.cal("cal-1").values()]).toHaveLength(1);
  const before = readManifest(home).bases["Cal.md"];
  expect(before.calendarId).toBe("cal-1");
  expect(before.syncToken).toBeTruthy();

  // Same base, now pointed at cal-2 → old links/token dropped, event re-pushed to cal-2.
  const r = await syncBase("Cal.md", "cal-2");
  expect(r.pushedNew).toBe(1);
  expect([...g.cal("cal-2").values()]).toHaveLength(1);
  const after = readManifest(home).bases["Cal.md"];
  expect(after.calendarId).toBe("cal-2");
});
