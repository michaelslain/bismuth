// app/src/editor/settingsComplete.ts
// Autocomplete for settings.yaml: suggests setting KEYS (scoped to the section the
// cursor is in) and VALUES (enum members, true/false, or — inside the `properties`
// section — the property type names). Nested-schema aware. Triggered while typing
// or on demand via Ctrl-Space (bound in Editor.tsx). The file ships comment-free,
// so this is the discovery mechanism.
import { autocompletion, type CompletionContext, type CompletionResult, type CompletionSource } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import type { Schema, SchemaEntry, PropertyType } from "../../../core/src/schema/types";
import { commandLabel } from "../../../core/src/commands";
import { TEMPLATE_TOKENS } from "../../../core/src/templates";
import { matchTemplateTokenPrefix } from "./templateToken";

// Property types a user can assign in the `properties:` registry section.
const PROPERTY_TYPES = ["string", "number", "boolean", "date", "datetime", "file", "list"];

/** Extract the document's `dailyNotes:` ids + labels (for completing daily-note:<id>
 *  references in the toolbar `command` value). A tolerant line-scan of the dailyNotes
 *  block rather than a whole-doc YAML parse — so a half-typed line elsewhere (e.g. the
 *  `command:` value being edited right now) can't blank out the suggestions. */
export function dailyNoteIdsFromDoc(doc: string): { id: string; label: string }[] {
  const lines = doc.split("\n");
  let i = lines.findIndex((l) => /^dailyNotes:\s*$/.test(l));
  if (i === -1) return [];
  const out: { id: string; label: string }[] = [];
  let cur: { id: string; label: string } | null = null;
  const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, "");
  for (i = i + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    if (/^\S/.test(line)) break;                       // dedent to a top-level key → block ends
    if (/^\s*-/.test(line)) { if (cur) out.push(cur); cur = { id: "", label: "" }; } // new list item
    if (!cur) continue;
    const m = line.match(/(?:^|\s)(id|label):\s*(.*)$/);
    if (m) { if (m[1] === "id") cur.id = unquote(m[2]); else cur.label = unquote(m[2]); }
  }
  if (cur) out.push(cur);
  return out.filter((x) => x.id.length > 0);
}

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

/**
 * For a bare list-item line (`- value`) at `itemIndent`, find the enclosing
 * `key:`-introduced list and return its ITEM type — so a scalar list of enums
 * (e.g. toolbar `commands:`) can complete its members. null when the enclosing
 * key isn't a list, or none is found. The header may itself be `- key:` (a list
 * item that introduces a nested list), so the dash is optional in the match.
 */
function enclosingListItemType(
  root: Schema,
  ctx: CompletionContext,
  lineNumber: number,
  itemIndent: number,
): PropertyType | null {
  for (let n = lineNumber - 1; n >= 1; n--) {
    const text = ctx.state.doc.line(n).text;
    const lineIndent = (text.match(/^\s*/)?.[0] ?? "").length;
    const header = text.match(/^\s*-?\s*([\w-]+):\s*$/);
    if (header && lineIndent < itemIndent) {
      const { schema } = scopeAt(root, ctx, n, lineIndent);
      const t = schema[header[1]]?.type;
      if (t && typeof t === "object" && t.kind === "list" && t.item) return t.item;
      return null;
    }
    if (text.trim() && lineIndent === 0 && !header) break;
  }
  return null;
}

export function settingsCompletionSource(
  getSchema: () => Schema,
  getIconNames: () => string[],
  getTemplatePaths: () => string[],
): CompletionSource {
  return (ctx: CompletionContext): CompletionResult | null => {
    const root = getSchema();
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = line.text.slice(0, ctx.pos - line.from);
    const indent = (before.match(/^\s*/)?.[0] ?? "").length;

    // Template-token completion inside a dailyNotes `fileName:` value (e.g. fileName: "{{da").
    // The generic value regex below only captures a trailing non-space token, so it can't
    // see "{{" inside a quoted multi-word filename — handle it explicitly here.
    const tokenMatch = matchTemplateTokenPrefix(before);
    if (tokenMatch) {
      const keyM = before.match(/^\s*-?\s*([\w-]+):/);
      if (keyM) {
        const { sectionKey } = scopeAt(root, ctx, line.number, indent);
        if (sectionKey === "dailyNotes" && keyM[1] === "fileName") {
          const q = tokenMatch.query.toLowerCase();
          const options = TEMPLATE_TOKENS
            .filter((t) => t.token.toLowerCase().includes(q))
            .map((t) => ({ label: t.token, type: "enum", info: t.doc }));
          if (options.length) return { from: line.from + tokenMatch.from, options, validFor: /^\{\{[\w+:-]*$/ };
        }
      }
    }

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

      // dailyNotes `template:` value → vault template file paths.
      if (sectionKey === "dailyNotes" && key === "template") {
        const tp = typed.toLowerCase();
        const options = getTemplatePaths()
          .filter((path) => path.toLowerCase().includes(tp))
          .slice(0, 50)
          .map((label) => ({ label, type: "enum" }));
        if (!options.length) return null;
        return { from: ctx.pos - typed.length, options, validFor: /^[^\n]*$/ };
      }

      // Toolbar `command:` enum carries allowPrefixes ["daily-note:"] — also offer the
      // document's configured daily-note ids (so daily-note:<id> autocompletes).
      const isCommand =
        typeof fieldType === "object" && fieldType.kind === "enum" &&
        (fieldType as { allowPrefixes?: string[] }).allowPrefixes?.includes("daily-note:");
      const dailyIds = isCommand ? dailyNoteIdsFromDoc(ctx.state.doc.toString()) : [];
      const dailyLabels = new Map(dailyIds.map((d) => [`daily-note:${d.id}`, d.label || d.id] as const));

      const raw = sectionKey === "properties"
        ? PROPERTY_TYPES
        : [...valueOptions(fieldType), ...dailyIds.map((d) => `daily-note:${d.id}`)];
      if (!raw.length) return null;
      const p = typed.toLowerCase();
      const options = raw
        .filter((v) => v.toLowerCase().startsWith(p))
        .map((label) => {
          const detail = dailyLabels.get(label) ?? commandLabel(label); // non-undefined for command ids / daily notes
          return detail ? { label, type: "enum", detail } : { label, type: "enum" };
        });
      if (!options.length) return null;
      // Widen validFor so the popup survives typing the ":" in daily-note:<id>.
      return { from: ctx.pos - typed.length, options, validFor: /^[\w:-]*$/ };
    }

    // BARE LIST-ITEM position: "- <partial>" with no colon — a scalar inside a
    // `key:`-introduced list. If that list's item type is an enum (e.g. toolbar
    // `commands:`), offer its members; otherwise fall through to the KEY branch
    // (object-list items like `- command:` complete their field keys there).
    const listItem = before.match(/^(\s*)-\s+([\w-]*)$/);
    if (listItem) {
      const itemType = enclosingListItemType(root, ctx, line.number, listItem[1].length);
      if (itemType && typeof itemType === "object" && itemType.kind === "enum") {
        const typed = listItem[2];
        if (!ctx.explicit && typed.length === 0) return null;
        const p = typed.toLowerCase();
        const options = itemType.values
          .filter((v) => v.toLowerCase().startsWith(p))
          .map((label) => {
            const detail = commandLabel(label); // non-undefined only for command ids
            return detail ? { label, type: "enum", detail } : { label, type: "enum" };
          });
        if (!options.length) return null;
        return { from: ctx.pos - typed.length, options, validFor: /^[\w-]*$/ };
      }
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

export function settingsCompletion(getSchema: () => Schema, getIconNames: () => string[], getTemplatePaths: () => string[]): Extension {
  return autocompletion({ override: [settingsCompletionSource(getSchema, getIconNames, getTemplatePaths)] });
}
