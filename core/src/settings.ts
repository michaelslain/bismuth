// core/src/settings.ts
// Lifecycle for the single vault `settings.yaml`. Backend-only (Bun fs OK).
// Reads/writes ride the existing files.ts path-traversal guard; the property
// registry is parsed by the shared pure schema engine so frontmatter and
// settings validation share one source of truth.
import { join } from "node:path";
import { existsSync, renameSync, copyFileSync, statSync, rmSync, readFileSync } from "node:fs";
import { parse, parseDocument, Document, YAMLMap, isMap } from "yaml";
import { readNote, writeNote } from "./files";
import { loadRegistry, BUILTIN_PROPERTIES } from "./schema/registry";
import { SETTINGS_SCHEMA, DEFAULTS } from "./schema/settingsSchema";
import type { Schema, SchemaEntry } from "./schema/types";
import type { DailyNoteConfig } from "./dailyNote";
import type { SrsConfig } from "./srs/scheduler";

/** The vault's settings live in a single hidden file `.settings` (YAML), at the vault root. */
export const SETTINGS_FILE = ".settings";
/** Legacy location (vault root) — migrated into `.settings` on first open. */
export const LEGACY_SETTINGS_FILE = "settings.yaml";

export interface ReadSettingsResult { raw: string; data: Record<string, unknown>; }

/**
 * One-time relocation of older settings layouts into the single `.settings` file. Handles two
 * legacy shapes: a vault-root `settings.yaml`, and the interim `.settings/settings.yaml` folder
 * from an earlier build of this branch. Idempotent (no-op once a `.settings` FILE exists). Uses
 * filesystem renames so user comments/values are preserved verbatim. Best-effort throughout.
 */
export function migrateSettingsLocation(vault: string): void {
  const next = join(vault, SETTINGS_FILE); // ".settings" (a file)
  // Already migrated — a `.settings` FILE exists. (Guard: an interim `.settings/` DIR also makes
  // existsSync true, so require isFile before bailing.)
  try { if (existsSync(next) && statSync(next).isFile()) return; } catch { /* fall through */ }

  // Interim layout: `.settings/settings.yaml` (a DIR). Collapse it to the `.settings` file via a
  // temp name (a file and a dir can't share the name `.settings`), then drop the empty dir.
  const interim = join(vault, ".settings", "settings.yaml");
  if (existsSync(interim)) {
    try {
      const tmp = join(vault, ".settings.migrating");
      renameSync(interim, tmp);
      rmSync(join(vault, ".settings"), { recursive: true, force: true });
      renameSync(tmp, next);
      return;
    } catch { /* fall through to the legacy-root path */ }
  }

  // Legacy layout: a vault-root `settings.yaml` → `.settings`.
  const legacy = join(vault, LEGACY_SETTINGS_FILE);
  if (existsSync(legacy) && !existsSync(next)) {
    try {
      renameSync(legacy, next);
    } catch {
      // rename can fail (a lock, an odd filesystem state). Fall back to a COPY so `.settings`
      // exists with the user's real settings — reconcile reads only SETTINGS_FILE, so without
      // this a failed move silently resets the vault to defaults. Legacy left as a backup.
      try { copyFileSync(legacy, next); } catch { /* give up — reconcile seeds defaults */ }
    }
  }
}

/**
 * Per-vault mutex for settings file mutations. Prevents concurrent POST /set-setting
 * requests from clobbering each other via TOCTOU race. Keys are vault paths;
 * values are promise chains that serialize all access to that vault's settings.yaml.
 */
const settingsMutexes = new Map<string, Promise<void>>();

/** Run a function serially within a per-vault mutex. */
async function withSettingsMutex<T>(
  vault: string,
  fn: () => Promise<T>,
): Promise<T> {
  // Chain this operation after any pending operations on this vault
  const existing = settingsMutexes.get(vault) ?? Promise.resolve();
  let result!: T;
  let error: Error | undefined;

  const next = existing
    .then(async () => {
      try {
        result = await fn();
      } catch (e) {
        error = e as Error;
      }
    });

  settingsMutexes.set(vault, next);

  // Wait for this operation to complete
  await next;
  if (error) throw error;
  return result;
}

/** Read settings.yaml. Returns null if absent; tolerant of malformed YAML (data → {}). */
export async function readSettings(vault: string): Promise<ReadSettingsResult | null> {
  const full = join(vault, SETTINGS_FILE);
  if (!(await Bun.file(full).exists())) return null;
  const raw = await readNote(vault, SETTINGS_FILE);
  let data: Record<string, unknown> = {};
  try {
    const parsed = parse(raw);
    if (parsed && typeof parsed === "object") data = parsed as Record<string, unknown>;
  } catch {
    data = {}; // corrupt file degrades to empty — callers fall back to defaults
  }
  return { raw, data };
}

/**
 * Synchronously read just `daemon.enabled` from the vault's `.settings` file. Needed on the
 * NARROW boot window before the async {@link loadAppConfig} resolves: the tree gates the
 * `.daemon` folder and the graph gates the 3rd brain on this flag, so the FIRST cached /tree +
 * /graph build must already see the real value — otherwise `.daemon` (and the 3rd brain) pop in a
 * beat late once the async load lands. Mirrors the sync identity.md read in daemonIdentityName.
 * Degrades to the schema default (false) on a missing/corrupt/partial file; never throws.
 */
export function readDaemonEnabledSync(vault: string): boolean {
  const fallback = (DEFAULTS as { daemon?: { enabled?: boolean } }).daemon?.enabled === true;
  try {
    const full = join(vault, SETTINGS_FILE);
    if (!existsSync(full)) return fallback;
    const parsed = parse(readFileSync(full, "utf8")) as Record<string, unknown> | null;
    const daemon = parsed && typeof parsed === "object" ? parsed.daemon : undefined;
    if (daemon && typeof daemon === "object" && typeof (daemon as Record<string, unknown>).enabled === "boolean") {
      return (daemon as { enabled: boolean }).enabled;
    }
  } catch {
    // missing/corrupt/unreadable → fall through to the schema default
  }
  return fallback;
}

/** Parse the `properties:` section of settings.yaml into a validation Schema,
 *  merged over the built-in properties (tags/aliases/cssclasses). */
export async function getVaultSchema(vault: string): Promise<Schema> {
  const res = await readSettings(vault);
  if (!res) return { ...BUILTIN_PROPERTIES };
  return { ...BUILTIN_PROPERTIES, ...loadRegistry(res.data.properties) };
}

/** Build a YAMLMap from a Schema, materializing defaults. No comments — settings
 *  are discovered via the editor's Ctrl-Space autocomplete, not inline docs. */
function schemaToMap(doc: Document, schema: Schema): YAMLMap {
  const map = new YAMLMap();
  for (const [key, entry] of Object.entries(schema) as [string, SchemaEntry][]) {
    let valueNode;
    if (typeof entry.type === "object" && entry.type.kind === "object") {
      valueNode = schemaToMap(doc, entry.type.fields);
    } else {
      valueNode = doc.createNode(entry.default ?? null);
    }
    map.items.push(doc.createPair(key, valueNode));
  }
  return map;
}

/** On first launch, write a clean (comment-free) settings.yaml from SETTINGS_SCHEMA. No-op if present. */
export async function initializeSettings(vault: string): Promise<void> {
  const full = join(vault, SETTINGS_FILE);
  if (await Bun.file(full).exists()) return;
  const doc = new Document();
  doc.contents = schemaToMap(doc, SETTINGS_SCHEMA);
  await writeNote(vault, SETTINGS_FILE, doc.toString({ flowCollectionPadding: false }));
}

/** Insert default nodes for any schema path missing from `map`. Returns true if mutated.
 *  Recurses into object-typed entries; preserves existing values, comments, and any
 *  keys not present in the schema (unknown keys are never touched). */
function fillMissing(doc: Document, map: YAMLMap, schema: Schema): boolean {
  let mutated = false;
  for (const [key, entry] of Object.entries(schema) as [string, SchemaEntry][]) {
    const isObj = typeof entry.type === "object" && entry.type.kind === "object";
    if (!map.has(key)) {
      if (isObj) {
        const child = new YAMLMap();
        fillMissing(doc, child, (entry.type as { kind: "object"; fields: Schema }).fields);
        map.set(key, child);
      } else {
        map.set(key, doc.createNode(entry.default ?? null));
      }
      mutated = true;
    } else if (isObj) {
      const child = map.get(key, true);
      if (isMap(child)) {
        mutated = fillMissing(doc, child as YAMLMap, (entry.type as { kind: "object"; fields: Schema }).fields) || mutated;
      }
    }
  }
  return mutated;
}

/**
 * Daemon-config migration hook. Historically normalized the obsolete `daemon.home`
 * default and adopted an installed daemon on first reconcile. Both are gone now: the
 * daemon is bundled and its machine-identity home is fixed at ~/.bismuth/daemon (no
 * longer settings-configurable), and adoption/enable is driven by the first-run intro.
 * Retained as a no-op so the reconcile call site stays stable for any future daemon
 * migration. Always returns false (no doc change).
 */
function migrateDaemonConfig(_doc: Document): boolean {
  return false;
}

/**
 * On open: add any missing schema defaults to settings.yaml, preserving comments,
 * key order, user values, and unknown keys. Absent file → write full defaults.
 * Corrupt/empty file → left untouched. Writes only when something actually changed,
 * so an already-complete file produces no spurious write / SSE churn. Driven entirely
 * by SETTINGS_SCHEMA, so adding or removing a schema entry self-reconciles next open.
 */
export async function reconcileSettings(vault: string): Promise<void> {
  migrateSettingsLocation(vault); // move a legacy root settings.yaml into .settings/ (idempotent)
  const full = join(vault, SETTINGS_FILE);
  if (!(await Bun.file(full).exists())) { await initializeSettings(vault); return; }
  const raw = await readNote(vault, SETTINGS_FILE);
  let doc: Document;
  try {
    doc = parseDocument(raw);
    if (doc.errors.length) return; // corrupt — leave the file for the user to fix
  } catch {
    return;
  }
  if (!isMap(doc.contents)) return; // empty/scalar/corrupt — leave alone
  const filled = fillMissing(doc, doc.contents as YAMLMap, SETTINGS_SCHEMA);
  const migrated = migrateDaemonConfig(doc);
  if (filled || migrated) await writeNote(vault, SETTINGS_FILE, doc.toString({ flowCollectionPadding: false }));
}

/**
 * Merge a single value at `path` into settings.yaml in place, preserving every
 * other key, all comments, and key order. Reconciles first so the file exists and
 * is fully shaped. This is the backend's single write path for settings, so a
 * frontend toggle can never clobber comments or the `properties:` registry.
 *
 * Guarded by a per-vault mutex to prevent concurrent requests from clobbering
 * each other via TOCTOU race during read-modify-write.
 */
export async function setSettingInFile(vault: string, path: string[], value: unknown): Promise<void> {
  if (!path.length) return;
  await withSettingsMutex(vault, async () => {
    await reconcileSettings(vault); // ensure the file exists + is shaped
    const raw = await readNote(vault, SETTINGS_FILE);
    const doc = parseDocument(raw);
    if (doc.errors.length) return; // corrupt — never clobber existing content
    doc.setIn(path, value);
    await writeNote(vault, SETTINGS_FILE, doc.toString({ flowCollectionPadding: false }));
  });
}

/**
 * Merge the settings.yaml file over DEFAULTS via a per-key typeof check, so a
 * corrupt/partial file degrades to defaults. The `properties` registry is
 * delivered separately (GET /schema) and excluded here.
 */
export async function serializeSettingsForFrontend(vault: string): Promise<Record<string, unknown>> {
  const out = structuredClone(DEFAULTS) as Record<string, Record<string, unknown>>;
  const res = await readSettings(vault);
  const data = res?.data ?? {};
  for (const section of Object.keys(out)) {
    // folderIcons is a free-form map, not a fixed key set — pass the whole stored
    // map through (the per-key typeof overlay below only handles known leaves).
    if (section === "folderIcons") {
      (out as Record<string, unknown>).folderIcons = readFolderIconsFrom(data);
      continue;
    }
    if (section === "toolbar") {
      (out as Record<string, unknown>).toolbar = readToolbarFrom(data);
      continue;
    }
    if (section === "dailyNotes") {
      (out as Record<string, unknown>).dailyNotes = readDailyNotesFrom(data);
      continue;
    }
    const stored = data[section];
    if (!stored || typeof stored !== "object") continue;
    const target = out[section];
    // Each top-level section is an object-typed SchemaEntry; its leaf fields live
    // under `type.fields`, so resolve the per-key schema from there (not off the
    // section entry directly) for the min/max/enum clamps to fire.
    const sectionEntry = SETTINGS_SCHEMA[section as keyof typeof SETTINGS_SCHEMA] as SchemaEntry | undefined;
    const sectionType = sectionEntry?.type;
    const fields = sectionType && typeof sectionType === "object" && sectionType.kind === "object"
      ? sectionType.fields
      : undefined;
    for (const key of Object.keys(target)) {
      const v = (stored as Record<string, unknown>)[key];
      if (Array.isArray(target[key])) {
        // List-typed leaf (e.g. editor.wrapSelectionChars): typeof "object" matches both
        // arrays and plain objects, so a bare typeof check can't reject a malformed value —
        // validate structurally instead and fall back to the default otherwise.
        if (Array.isArray(v) && v.every((el) => typeof el === "string")) target[key] = v;
        continue;
      }
      if (typeof v !== typeof target[key]) continue;
      const keySchema = fields?.[key];
      if (keySchema?.min !== undefined && typeof v === "number" && v < keySchema.min) continue;
      if (keySchema?.max !== undefined && typeof v === "number" && v > keySchema.max) continue;
      const keyType = keySchema?.type;
      if (keyType && typeof keyType === "object" && keyType.kind === "enum" && !keyType.values.includes(v as string)) continue;
      target[key] = v;
    }
  }
  delete (out as Record<string, unknown>).properties;
  return out;
}

/** A serialized toolbar button: a single `command` OR a `commands` list, plus icon. */
type ToolbarItem = { command?: string; commands?: string[]; icon: string; tooltip?: string };

/** Pull a clean toolbar list out of parsed settings data. Each item must be an
 *  object with a non-empty string `icon` and either a non-empty string `command`
 *  or a non-empty `commands` list of non-empty strings (the latter wins when both
 *  are present, mirroring the runtime). Malformed items are dropped. An explicit
 *  array (even empty) is honored; a missing/non-array value falls back to the
 *  seeded defaults. */
function readToolbarFrom(data: Record<string, unknown>): ToolbarItem[] {
  const raw = data.toolbar;
  if (!Array.isArray(raw)) return structuredClone((DEFAULTS as any).toolbar) as ToolbarItem[];
  const out: ToolbarItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    if (typeof o.icon !== "string" || o.icon.length === 0) continue;
    const commands = Array.isArray(o.commands)
      ? o.commands.filter((c): c is string => typeof c === "string" && c.length > 0)
      : [];
    const hasCommand = typeof o.command === "string" && o.command.length > 0;
    if (commands.length === 0 && !hasCommand) continue;
    const entry: ToolbarItem = commands.length > 0
      ? { commands, icon: o.icon }
      : { command: o.command as string, icon: o.icon };
    if (typeof o.tooltip === "string" && o.tooltip.length > 0) entry.tooltip = o.tooltip;
    out.push(entry);
  }
  return out;
}

/** Pull a clean dailyNotes list out of parsed settings data. Each item needs a
 *  non-empty string `id` and `fileName`; other fields default (label→id,
 *  icon→CalendarDays, folder/template→""). Malformed items are dropped; an explicit
 *  empty array is honored; a missing/non-array value falls back to the seeded default.
 *  Mirrors readToolbarFrom. */
function readDailyNotesFrom(data: Record<string, unknown>): DailyNoteConfig[] {
  const raw = data.dailyNotes;
  if (!Array.isArray(raw)) return structuredClone((DEFAULTS as any).dailyNotes) as DailyNoteConfig[];
  const out: DailyNoteConfig[] = [];
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    if (typeof o.id !== "string" || o.id.length === 0) continue;
    if (typeof o.fileName !== "string" || o.fileName.length === 0) continue;
    out.push({
      id: o.id,
      label: str(o.label) || o.id,
      icon: str(o.icon) || "CalendarDays",
      folder: str(o.folder),
      fileName: o.fileName,
      template: str(o.template),
    });
  }
  return out;
}

/** Pull a clean `{folderPath: iconName}` string map out of parsed settings data. */
function readFolderIconsFrom(data: Record<string, unknown>): Record<string, string> {
  const raw = data.folderIcons;
  const out: Record<string, string> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === "string" && v.length > 0) out[k] = v;
    }
  }
  return out;
}

/** Read the per-folder icon map from settings.yaml. Absent file / section → {}. */
export async function readFolderIcons(vault: string): Promise<Record<string, string>> {
  const res = await readSettings(vault);
  if (!res) return {};
  return readFolderIconsFrom(res.data);
}

/** Read the dailyNotes config from settings.yaml. Absent file → seeded default. */
export async function readDailyNotes(vault: string): Promise<DailyNoteConfig[]> {
  const res = await readSettings(vault);
  return readDailyNotesFrom(res?.data ?? {});
}

/**
 * Set or clear a folder's icon and persist settings.yaml in place.
 * A non-empty icon sets folderIcons[path]; an empty/missing icon deletes it.
 * Initializes a fresh settings.yaml first if none exists, then edits only the
 * folderIcons node via the YAML CST so the rest of the file is preserved.
 *
 * Guarded by a per-vault mutex to prevent concurrent requests from clobbering
 * each other via TOCTOU race during read-modify-write.
 */
export async function setFolderIcon(vault: string, path: string, icon: string | null | undefined): Promise<void> {
  await withSettingsMutex(vault, async () => {
    await initializeSettings(vault); // no-op if present; guarantees a file to edit
    const raw = await readNote(vault, SETTINGS_FILE);
    let doc: Document;
    try {
      doc = parseDocument(raw);
    } catch {
      return; // unparseable — never clobber existing content
    }
    if (doc.errors.length) return; // corrupt — leave the file for the user to fix
    if (!doc.contents || !(doc.contents instanceof YAMLMap)) {
      doc.contents = new YAMLMap();
    }
    let map = doc.getIn(["folderIcons"]);
    if (!(map instanceof YAMLMap)) {
      map = new YAMLMap();
      doc.setIn(["folderIcons"], map);
    }
    if (icon && icon.length > 0) {
      (map as YAMLMap).set(path, icon);
    } else {
      (map as YAMLMap).delete(path);
    }
    await writeNote(vault, SETTINGS_FILE, doc.toString({ flowCollectionPadding: false }));
  });
}

// The typed, file-merged-over-defaults config the backend reads at runtime (layout
// forces, file-watch debounce, SRS scheduler, …). Same merge as the frontend feed,
// just named + typed for backend consumers. Only the sections the backend actually
// reads are typed here; the full shape is the schema-derived DEFAULTS. The `srs`
// section is an identity match for SrsConfig (see scheduler.ts).
export interface AppConfig {
  server: { fileWatchDebounceMs: number; sseHeartbeatMs: number };
  daemon: { enabled: boolean; inboxRetentionDays: number };
  templates?: { folder: string };
  srs: SrsConfig;
  googleCalendar?: {
    enabled: boolean;
    calendarId: string;
    basePath: string;
    conflictPolicy: "lastWriteWins" | "googleWins" | "bismuthWins";
    syncIntervalMinutes: number;
    timeZone: string;
  };
  // Other schema sections (graph, appearance, ui, …) are present at runtime but
  // not read by the backend; expose them loosely so callers can reach them.
  [section: string]: unknown;
}

/** Load the backend runtime config (settings.yaml merged over DEFAULTS). */
export async function loadAppConfig(vault: string): Promise<AppConfig> {
  return (await serializeSettingsForFrontend(vault)) as unknown as AppConfig;
}
