// core/src/settings.ts
// Lifecycle for the single vault `settings.yaml`. Backend-only (Bun fs OK).
// Reads/writes ride the existing files.ts path-traversal guard; the property
// registry is parsed by the shared pure schema engine so frontmatter and
// settings validation share one source of truth.
import { join } from "node:path";
import { parse } from "yaml";
import { readNote, writeNote } from "./files";
import { loadRegistry } from "./schema/registry";
import type { Schema } from "./schema/types";

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
