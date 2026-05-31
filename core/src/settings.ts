// core/src/settings.ts
// Lifecycle for the single vault `settings.yaml`. Backend-only (Bun fs OK).
// Reads/writes ride the existing files.ts path-traversal guard; the property
// registry is parsed by the shared pure schema engine so frontmatter and
// settings validation share one source of truth.
import { join } from "node:path";
import { parse, Document, YAMLMap } from "yaml";
import { readNote, writeNote } from "./files";
import { loadRegistry } from "./schema/registry";
import { SETTINGS_SCHEMA } from "./schema/settingsSchema";
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

/** Parse the `properties:` section of settings.yaml into a validation Schema. */
export async function getVaultSchema(vault: string): Promise<Schema> {
  const res = await readSettings(vault);
  if (!res) return {};
  return loadRegistry(res.data.properties);
}

/** Build a YAMLMap from a Schema, materializing defaults and attaching `doc` as commentBefore. */
function schemaToMap(doc: Document, schema: Schema): YAMLMap {
  const map = new YAMLMap();
  for (const [key, entry] of Object.entries(schema) as [string, SchemaEntry][]) {
    let valueNode;
    if (typeof entry.type === "object" && entry.type.kind === "object") {
      valueNode = schemaToMap(doc, entry.type.fields);
    } else {
      valueNode = doc.createNode(entry.default ?? null);
    }
    const pair = doc.createPair(key, valueNode);
    if (entry.doc) (pair.key as any).commentBefore = ` ${entry.doc}`;
    map.items.push(pair);
  }
  return map;
}

/** On first launch, write a fully-commented settings.yaml from SETTINGS_SCHEMA. No-op if present. */
export async function initializeSettings(vault: string): Promise<void> {
  const full = join(vault, SETTINGS_FILE);
  if (await Bun.file(full).exists()) return;
  const doc = new Document();
  doc.contents = schemaToMap(doc, SETTINGS_SCHEMA);
  await writeNote(vault, SETTINGS_FILE, doc.toString({ flowCollectionPadding: false }));
}
