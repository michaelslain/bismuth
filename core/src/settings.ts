// core/src/settings.ts
// Lifecycle for the single vault `settings.yaml`. Backend-only (Bun fs OK).
// Reads/writes ride the existing files.ts path-traversal guard; the property
// registry is parsed by the shared pure schema engine so frontmatter and
// settings validation share one source of truth.
import { join } from "node:path";
import { parse, parseDocument, Document, YAMLMap, isMap } from "yaml";
import { readNote, writeNote } from "./files";
import { loadRegistry, BUILTIN_PROPERTIES } from "./schema/registry";
import { SETTINGS_SCHEMA, DEFAULTS } from "./schema/settingsSchema";
import type { Schema, SchemaEntry } from "./schema/types";

export const SETTINGS_FILE = "settings.yaml";

export interface ReadSettingsResult { raw: string; data: Record<string, unknown>; }

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
 * On open: add any missing schema defaults to settings.yaml, preserving comments,
 * key order, user values, and unknown keys. Absent file → write full defaults.
 * Corrupt/empty file → left untouched. Writes only when something actually changed,
 * so an already-complete file produces no spurious write / SSE churn. Driven entirely
 * by SETTINGS_SCHEMA, so adding or removing a schema entry self-reconciles next open.
 */
export async function reconcileSettings(vault: string): Promise<void> {
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
  const mutated = fillMissing(doc, doc.contents as YAMLMap, SETTINGS_SCHEMA);
  if (mutated) await writeNote(vault, SETTINGS_FILE, doc.toString({ flowCollectionPadding: false }));
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
    const stored = data[section];
    if (!stored || typeof stored !== "object") continue;
    const target = out[section];
    for (const key of Object.keys(target)) {
      const v = (stored as Record<string, unknown>)[key];
      if (typeof v === typeof target[key]) target[key] = v;
    }
  }
  delete (out as Record<string, unknown>).properties;
  return out;
}
