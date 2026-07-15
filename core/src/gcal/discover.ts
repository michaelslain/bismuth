// core/src/gcal/discover.ts
// Find every calendar base in the vault that has PER-CALENDAR Google sync enabled, so the
// background auto-sync ticker can reconcile each against its own Google calendar. Replaces
// the old single global `googleCalendar.basePath` the ticker used to sync.
//
// Cost: this walks the vault's markdown once per tick (default cadence 15 min) and only
// frontmatter-parses each note — cheap. Only `type: base` notes are fully base-parsed.
import { listMarkdown, readNote } from "../files";
import { parseFrontmatter } from "../frontmatter";
import { parseBaseFile } from "../bases/parse";
import { resolveGcalConfig, type LegacyGcalConfig } from "./config";

export interface GcalSyncTarget {
  basePath: string;
  calendarId: string;
}

/**
 * List the calendar bases whose Google sync is enabled, each with its resolved calendarId.
 * A base is a target when its default view has `googleCalendarSync: true`, OR it is the base
 * named by the legacy GLOBAL setting with `enabled: true` (migration — see config.ts).
 */
export async function listGcalSyncTargets(vault: string, legacy?: LegacyGcalConfig): Promise<GcalSyncTarget[]> {
  const files = await listMarkdown(vault);
  const targets: GcalSyncTarget[] = [];
  for (const rel of files) {
    let raw: string;
    try {
      raw = await readNote(vault, rel);
    } catch {
      continue; // deleted mid-walk
    }
    // Cheap gate: only `type: base` notes can be a calendar.
    if (parseFrontmatter(raw).data?.type !== "base") continue;
    const { config } = parseBaseFile(raw, { name: rel.split("/").pop() ?? rel, path: rel });
    const cfg = resolveGcalConfig(config.views[0], rel, legacy);
    if (cfg.enabled) targets.push({ basePath: rel, calendarId: cfg.calendarId });
  }
  return targets;
}
