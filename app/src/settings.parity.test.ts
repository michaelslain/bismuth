// app/src/settings.parity.test.ts
// Drift guards across the (large) settings schema. These keep the schema, its
// materialized defaults, and its discoverability honest as settings are added:
//  1. every settable leaf must have a default (so the store/file are fully shaped);
//  2. every settable leaf must carry a non-empty doc (so Ctrl-Space explains it).
import { describe, expect, it } from "bun:test";
import { SETTINGS_SCHEMA } from "../../core/src/schema/settingsSchema";
import { DEFAULTS } from "./settings";
import type { Schema, SchemaEntry } from "../../core/src/schema/types";

const isObjectEntry = (e: SchemaEntry): boolean =>
  typeof e.type === "object" && (e.type as { kind: string }).kind === "object";

/** Dotted paths of every scalar (non-object) leaf in the schema, skipping `properties`
 *  (a free-form user registry, not a fixed setting). */
function leafPaths(schema: Schema, prefix = ""): string[] {
  return Object.entries(schema).flatMap(([k, e]) => {
    if (k === "properties") return [];
    if (isObjectEntry(e)) return leafPaths((e.type as { fields: Schema }).fields, `${prefix}${k}.`);
    return [`${prefix}${k}`];
  });
}

describe("settings schema parity", () => {
  it("every settable leaf has a materialized default in the frontend store", () => {
    for (const path of leafPaths(SETTINGS_SCHEMA)) {
      const value = path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], DEFAULTS);
      expect(value, `missing default for "${path}"`).not.toBeUndefined();
    }
  });

  it("every settable leaf carries a non-empty doc (so autocomplete can explain it)", () => {
    const check = (schema: Schema, prefix = "") => {
      for (const [k, e] of Object.entries(schema)) {
        if (k === "properties") continue;
        if (isObjectEntry(e)) { check((e.type as { fields: Schema }).fields, `${prefix}${k}.`); continue; }
        expect((e.doc ?? "").length, `"${prefix}${k}" needs a doc`).toBeGreaterThan(0);
      }
    };
    check(SETTINGS_SCHEMA);
  });
});
