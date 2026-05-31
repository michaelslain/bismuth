// app/src/editor/settingsComplete.ts
// Autocomplete for settings.yaml: suggests setting KEYS (scoped to the section the
// cursor is in) and VALUES (enum members, true/false, or — inside the `properties`
// section — the property type names). Nested-schema aware. Triggered while typing
// or on demand via Ctrl-Space (bound in Editor.tsx). The file ships comment-free,
// so this is the discovery mechanism.
import { autocompletion, type CompletionContext, type CompletionResult, type CompletionSource } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import type { Schema, SchemaEntry, PropertyType } from "../../../core/src/schema/types";

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

/** The nested fields of an object-typed entry, or null for scalars. */
function fieldsOf(entry: SchemaEntry | undefined): Schema | null {
  if (entry && typeof entry.type === "object" && entry.type.kind === "object") return entry.type.fields;
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

function settingsSource(getSchema: () => Schema): CompletionSource {
  return (ctx: CompletionContext): CompletionResult | null => {
    const root = getSchema();
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = line.text.slice(0, ctx.pos - line.from);
    const indent = (before.match(/^\s*/)?.[0] ?? "").length;

    // VALUE position: "key: <partial>"
    const val = before.match(/^\s*([\w-]+):\s*(\S*)$/);
    if (val) {
      const [, key, typed] = val;
      if (!ctx.explicit && typed.length === 0) return null;
      const { schema, sectionKey } = scopeAt(root, ctx, line.number, indent);
      const options = sectionKey === "properties" ? PROPERTY_TYPES : valueOptions(schema[key]?.type ?? "string");
      if (!options.length) return null;
      return {
        from: ctx.pos - typed.length,
        options: options.map((label) => ({ label, type: "enum" })),
        validFor: /^[\w-]*$/,
      };
    }

    // KEY position: just an (optionally indented) partial word, no colon yet.
    const keyM = before.match(/^\s*([\w-]*)$/);
    if (keyM) {
      const typed = keyM[1];
      if (!ctx.explicit && typed.length === 0) return null; // don't auto-pop on blank lines
      const { schema, sectionKey } = scopeAt(root, ctx, line.number, indent);
      if (sectionKey === "properties") return null; // registry keys are user-defined names
      // detail = "<type> <range>" inline; info = the doc string in the hover tooltip,
      // so the user sees what each setting does and its valid values without docs in the file.
      const options = Object.entries(schema).map(([name, e]) => {
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

export function settingsCompletion(getSchema: () => Schema): Extension {
  return autocompletion({ override: [settingsSource(getSchema)] });
}
