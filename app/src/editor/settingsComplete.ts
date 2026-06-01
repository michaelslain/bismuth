// app/src/editor/settingsComplete.ts
// Autocomplete for settings.yaml: suggests setting KEYS (scoped to the section the
// cursor is in) and VALUES (enum members, true/false, or — inside the `properties`
// section — the property type names). Nested-schema aware. Triggered while typing
// or on demand via Ctrl-Space (bound in Editor.tsx). The file ships comment-free,
// so this is the discovery mechanism.
import { autocompletion, type CompletionContext, type CompletionResult, type CompletionSource } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { completionDisplayConfig } from "./completionDisplay";
import type { Schema, SchemaEntry, PropertyType } from "../../../core/src/schema/types";
import { commandLabel } from "../../../core/src/commands";

// Property types a user can assign in the `properties:` registry section.
const PROPERTY_TYPES = ["string", "number", "boolean", "date", "datetime", "file", "list"];

function typeLabel(type: PropertyType): string {
  if (typeof type === "string") return type;
  return type.kind; // "enum" | "list" | "object"
}

/** A compact human range for a setting: "11–28" (number bounds), "≥0"/"≤10"
 *  (one-sided), or "dark | light" (enum members). Empty when there's nothing to show. */
export function rangeLabel(entry: SchemaEntry): string {
  const t = entry.type;
  if (typeof t === "object" && t.kind === "enum") return t.values.join(" | ");
  const { min, max } = entry;
  if (typeof min === "number" && typeof max === "number") return `${min}–${max}`;
  if (typeof min === "number") return `≥${min}`;
  if (typeof max === "number") return `≤${max}`;
  return "";
}

/** The setting's documentation string (shown as the completion's info tooltip). */
export function docInfo(entry: SchemaEntry): string {
  return entry.doc ?? "";
}

/** The nested fields available under an entry: object fields directly, or a
 *  list-of-object's item fields (so list items complete their keys). null for scalars. */
function fieldsOf(entry: SchemaEntry | undefined): Schema | null {
  if (!entry) return null;
  const t = entry.type;
  if (typeof t === "object" && t.kind === "object") return t.fields;
  if (typeof t === "object" && t.kind === "list" && t.item && typeof t.item === "object" && t.item.kind === "object") {
    return t.item.fields;
  }
  return null;
}

/** Values to offer after `key:` — enum members or booleans; [] otherwise. */
function valueOptions(type: PropertyType): string[] {
  if (typeof type === "string") return type === "boolean" ? ["true", "false"] : [];
  if (type.kind === "enum") return type.values;
  return [];
}

/**
 * Resolve the schema in scope at `indent`: walk up to the nearest line that is
 * less-indented and ends in `key:` — that key's nested fields are the scope. At
 * top level (indent 0) the scope is the root schema (section names).
 */
function scopeAt(root: Schema, ctx: CompletionContext, lineNumber: number, indent: number): { schema: Schema; sectionKey: string | null } {
  if (indent === 0) return { schema: root, sectionKey: null };
  // Walk up to the nearest SECTION HEADER ("key:" with no inline value) that is
  // less-indented than this line — skipping sibling `key: value` lines. That
  // header's nested fields are the scope. Stop at a top-level non-section line.
  for (let n = lineNumber - 1; n >= 1; n--) {
    const text = ctx.state.doc.line(n).text;
    const header = text.match(/^(\s*)([\w-]+):\s*$/);
    if (header && header[1].length < indent) {
      return { schema: fieldsOf(root[header[2]]) ?? {}, sectionKey: header[2] };
    }
    const lineIndent = (text.match(/^\s*/)?.[0] ?? "").length;
    if (text.trim() && lineIndent === 0 && !header) break; // hit a top-level scalar — no enclosing section
  }
  return { schema: root, sectionKey: null };
}

export function settingsCompletionSource(
  getSchema: () => Schema,
  getIconNames: () => string[],
): CompletionSource {
  return (ctx: CompletionContext): CompletionResult | null => {
    const root = getSchema();
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = line.text.slice(0, ctx.pos - line.from);
    const indent = (before.match(/^\s*/)?.[0] ?? "").length;

    // VALUE position: "key: <partial>" or "- key: <partial>" (list item).
    const val = before.match(/^\s*-?\s*([\w-]+):\s*(\S*)$/);
    if (val) {
      const [, key, typed] = val;
      if (!ctx.explicit && typed.length === 0) return null;
      const { schema, sectionKey } = scopeAt(root, ctx, line.number, indent);
      const fieldType = sectionKey === "properties" ? "string" : (schema[key]?.type ?? "string");

      // icon-typed field -> Lucide icon names.
      if (fieldType === "icon") {
        const p = typed.toLowerCase();
        const options = getIconNames()
          .filter((n) => n.toLowerCase().startsWith(p))
          .slice(0, 50)
          .map((label) => ({ label, type: "enum" }));
        if (!options.length) return null;
        return { from: ctx.pos - typed.length, options, validFor: /^[\w-]*$/ };
      }

      const raw = sectionKey === "properties" ? PROPERTY_TYPES : valueOptions(fieldType);
      if (!raw.length) return null;
      const p = typed.toLowerCase();
      const options = raw
        .filter((v) => v.toLowerCase().startsWith(p))
        .map((label) => {
          const detail = commandLabel(label); // non-undefined only for command ids
          return detail ? { label, type: "enum", detail } : { label, type: "enum" };
        });
      if (!options.length) return null;
      return { from: ctx.pos - typed.length, options, validFor: /^[\w-]*$/ };
    }

    // KEY position: an (optionally `- `-prefixed) partial word, no colon yet.
    const keyM = before.match(/^\s*-?\s*([\w-]*)$/);
    if (keyM) {
      const typed = keyM[1];
      if (!ctx.explicit && typed.length === 0) return null;
      const { schema, sectionKey } = scopeAt(root, ctx, line.number, indent);
      if (sectionKey === "properties") return null;
      const options = Object.entries(schema)
        .filter(([name]) => name.toLowerCase().startsWith(typed.toLowerCase()))
        .map(([name, e]) => {
          const detail = [typeLabel(e.type), rangeLabel(e)].filter(Boolean).join(" ");
          const info = docInfo(e);
          return { label: name, type: "property", detail, ...(info ? { info } : {}) };
        });
      if (!options.length) return null;
      return { from: ctx.pos - typed.length, options, validFor: /^[\w-]*$/ };
    }
    return null;
  };
}

export function settingsCompletion(getSchema: () => Schema, getIconNames: () => string[]): Extension {
  return autocompletion({ ...completionDisplayConfig, override: [settingsCompletionSource(getSchema, getIconNames)] });
}
