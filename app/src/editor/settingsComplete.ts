// app/src/editor/settingsComplete.ts
// Autocomplete for settings.yaml: suggests setting KEYS (scoped to the section the
// cursor is in) and VALUES (enum members, true/false, or — inside the `properties`
// section — the property type names). Nested-schema aware. Triggered while typing
// or on demand via Ctrl-Space (bound in Editor.tsx). The file ships comment-free,
// so this is the discovery mechanism.
import { autocompletion, snippetCompletion, type Completion, type CompletionContext, type CompletionResult, type CompletionSource } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { completionDisplayConfig, type IconedCompletion } from "./completionDisplay";
import type { Schema, SchemaEntry, PropertyType } from "../../../core/src/schema/types";
import { SCALAR_PROPERTY_TYPES } from "../../../core/src/schema/registry";
import { commandLabel } from "../../../core/src/commands";
import { TEMPLATE_TOKENS } from "../../../core/src/templates";
import { matchTemplateTokenPrefix } from "./templateToken";
import { KEYBIND_MODIFIERS, KEYBIND_KEYS, modifierFamily, eventToCombo } from "../keybindings";

/**
 * Completions for a value inside the `properties:` registry — the full type vocabulary
 * accepted by core's `registry.parseType`: the scalar names (sourced from
 * SCALAR_PROPERTY_TYPES so they can't drift from the parser) plus snippet forms for the
 * composite types (enum/list/object). The composites insert inline YAML flow objects so
 * they parse on the same line, e.g. `status: { enum: [todo, done] }`.
 */
function propertyTypeCompletions(ctx: CompletionContext, typed: string): CompletionResult | null {
  const from = ctx.pos - typed.length;
  const scalars: Completion[] = SCALAR_PROPERTY_TYPES.map((label) => ({ label, type: "enum", detail: "type" }));
  const composites: Completion[] = [
    snippetCompletion("{ enum: [${values}] }", { label: "enum", type: "enum", detail: "one of a fixed set", info: "Restrict the value to a fixed set of options." }),
    snippetCompletion("{ list: ${string} }", { label: "list", type: "enum", detail: "array of items", info: "An array; the placeholder is the item type (e.g. string)." }),
    snippetCompletion("{ fields: { ${name}: ${string} } }", { label: "object", type: "enum", detail: "nested fields", info: "A nested object with typed sub-fields." }),
  ];
  const p = typed.toLowerCase();
  const options = [...scalars, ...composites].filter((o) => o.label.toLowerCase().startsWith(p));
  if (!options.length) return null;
  return { from, options, validFor: /^[\w-]*$/ };
}

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

/**
 * Smart completion for a `keybind` value (e.g. "Mod+Shift+D"). The combo grammar
 * is order-free: modifiers and the key can be typed in any order, joined by "+",
 * with comma-separated alternatives. We complete the CURRENT token (the text after
 * the last "+" within the current ","-separated combo): offer the remaining
 * modifier families and the key list, plus a "Record shortcut…" action that listens
 * to the keyboard for 3 seconds and writes whatever it hears.
 */
export function keybindCompletions(ctx: CompletionContext, valueSoFar: string): CompletionResult | null {
  const comboStart = valueSoFar.lastIndexOf(",") + 1;     // current combo = text after the last comma
  const currentCombo = valueSoFar.slice(comboStart);
  const plusIdx = currentCombo.lastIndexOf("+");
  const token = (plusIdx >= 0 ? currentCombo.slice(plusIdx + 1) : currentCombo).replace(/^\s+/, "");
  const tokenFrom = ctx.pos - token.length;
  const valueFrom = ctx.pos - valueSoFar.length;          // doc pos where the whole value begins

  // Auto-pop only once there's something to complete; always available on Ctrl-Space.
  const justAfterSep = /[+,]\s*$/.test(valueSoFar);
  if (!ctx.explicit && token.length === 0 && !justAfterSep) return null;

  const p = token.toLowerCase();
  // Modifier families already present in this combo → hide that whole family.
  const prior = (plusIdx >= 0 ? currentCombo.slice(0, plusIdx) : "")
    .split("+").map((t) => t.trim()).filter(Boolean);
  const usedFamilies = new Set(prior.map(modifierFamily).filter((f): f is string => !!f));

  const options: Completion[] = [];

  // "Record shortcut" action — highest priority, replaces the whole value on apply.
  if (token.length === 0 || "record".startsWith(p)) {
    options.push({
      label: "Record shortcut…",
      detail: "listens 3s",
      type: "record",
      boost: 99,
      apply: (view: EditorView) => recordShortcut(view, valueFrom),
    });
  }
  // Remaining modifiers (apply appends "+" so the combo keeps building).
  for (const mod of KEYBIND_MODIFIERS) {
    const fam = modifierFamily(mod);
    if ((fam && usedFamilies.has(fam)) || !mod.toLowerCase().startsWith(p)) continue;
    options.push({ label: mod, apply: mod + "+", type: "modifier", detail: "modifier", boost: 10 });
  }
  // Keys (any order; completes the combo).
  for (const k of KEYBIND_KEYS) {
    if (k.toLowerCase().startsWith(p)) options.push({ label: k, type: "key" });
  }

  if (!options.length) return null;
  return { from: tokenFrom, options, validFor: /^[^\s,+]*$/ };
}

/**
 * Listen for a single keyboard shortcut for up to 3 seconds, then replace the
 * keybind value (from `valueFrom` to end of line) with the captured combo. Bare
 * modifier presses are ignored until a real key lands. Keystrokes are swallowed
 * (capture phase + preventDefault) so they don't type into the editor or fire app
 * shortcuts while recording.
 */
function recordShortcut(view: EditorView, valueFrom: number): void {
  let done = false;
  let toastId: number | null = null;
  let dismiss: ((id: number) => void) | null = null;

  const finish = (combo: string | null) => {
    if (done) return;
    done = true;
    window.removeEventListener("keydown", onKey, true);
    clearTimeout(timer);
    if (toastId !== null && dismiss) dismiss(toastId);
    if (combo) {
      const line = view.state.doc.lineAt(valueFrom);
      view.dispatch({
        changes: { from: valueFrom, to: line.to, insert: combo },
        selection: { anchor: valueFrom + combo.length },
      });
    }
    view.focus();
  };

  const onKey = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const combo = eventToCombo(e); // null for a bare modifier → keep waiting
    if (combo) finish(combo);
  };

  window.addEventListener("keydown", onKey, true);
  const timer = setTimeout(() => finish(null), 3000);

  // Lazy toast import keeps the Solid store out of this module's static path.
  import("../Toast")
    .then(({ pushToast, dismissToast }) => {
      if (done) return;
      dismiss = dismissToast;
      toastId = pushToast("Recording shortcut… press keys", undefined, 3200);
    })
    .catch(() => {});
}

/** A vault entry usable for path completion (mirrors /tree). */
export type VaultPath = { path: string; kind: "file" | "dir" };

/**
 * Open the shared symbol gallery and, on pick, replace [from, end-of-line) with the
 * chosen value. `source` selects which gallery ("icons"). The gallery + sources are
 * dynamically imported so lucide-solid never enters this module's static graph
 * (it can't be imported outside a DOM — see icons/registry.ts).
 */
function launchGallery(view: EditorView, from: number, source: "icons"): void {
  const lineEnd = view.state.doc.lineAt(from).to;
  void Promise.all([import("../ui/gallery/galleryStore"), import("../ui/gallery/sources")])
    .then(([{ openGallery }, sources]) => openGallery({ source: sources.iconSource }))
    .then((picked) => {
      if (picked) {
        view.dispatch({
          changes: { from, to: lineEnd, insert: picked },
          selection: { anchor: from + picked.length },
        });
      }
      view.focus();
    })
    .catch((err) => console.error("Failed to open icon gallery", err));
  void source; // single source today; param keeps call sites self-documenting
}

/**
 * Rank vault paths for a query, case-INSENSITIVELY. Prefix-on-full-path first, then
 * prefix-on-basename (so "jour" finds "Templates/Journal.md"), then substring. The
 * caller returns these with `filter: false` so CodeMirror does NOT re-filter — that
 * second filter is exactly what used to drop case-mismatched paths (you type
 * "templates/" but the folder is "Templates/"), so owning the match here fixes it.
 */
export function rankPaths(candidates: VaultPath[], query: string): VaultPath[] {
  const q = query.toLowerCase();
  if (!q) return candidates;
  const starts: VaultPath[] = [], baseStarts: VaultPath[] = [], includes: VaultPath[] = [];
  for (const e of candidates) {
    const p = e.path.toLowerCase();
    const base = p.slice(p.lastIndexOf("/") + 1);
    if (p.startsWith(q)) starts.push(e);
    else if (base.startsWith(q)) baseStarts.push(e);
    else if (p.includes(q)) includes.push(e);
  }
  return [...starts, ...baseStarts, ...includes];
}

/**
 * Completion for a `path`-typed value. The value is matched with `(.*)` (NOT the
 * generic `\S*`) so folder names containing spaces ("Daily Notes") complete. Sources:
 * `scope:"templates"` → the template files (already folder-scoped server-side);
 * otherwise the whole vault tree, narrowed by `only` to dirs or files. Each row shows
 * a Folder/File glyph. Returns `filter: false` (own ranking; case-insensitive) and no
 * `validFor`, so every keystroke re-queries — no stale CM re-filter to break casing.
 */
function pathCompletions(
  ctx: CompletionContext,
  rawValue: string,
  type: { kind: "path"; only?: "dir" | "file"; scope?: "templates" | "fs" },
  getTemplatePaths: () => string[],
  getVaultPaths: () => VaultPath[],
): CompletionResult | null {
  const from = ctx.pos - rawValue.length; // doc pos where the value text begins
  // Tolerate quotes in a YAML-quoted value for MATCHING, but anchor `from` at the
  // value start (quote included) so accepting replaces the whole token with a bare
  // path — never leaving a dangling opening quote. Vault paths need no quoting.
  const q = rawValue.replace(/^["']/, "").replace(/["']$/, "");

  const candidates: VaultPath[] = type.scope === "templates"
    ? getTemplatePaths().map((path) => ({ path, kind: "file" as const }))
    : getVaultPaths().filter((e) => !type.only || e.kind === type.only);

  const ranked = rankPaths(candidates, q);
  if (!ranked.length) return null;
  const options: IconedCompletion[] = ranked.slice(0, 50).map((e) => ({
    label: e.path,
    type: "path",
    lucideIcon: e.kind === "dir" ? "Folder" : "File",
  }));
  return { from, to: ctx.pos, options, filter: false };
}

/**
 * Completion for a `scope:"fs"` path value — the filesystem-rooted counterpart of
 * pathCompletions. The candidate listing lives on the backend (it must readdir the
 * real filesystem), so this is ASYNC: it returns a Promise the autocomplete engine
 * awaits. The server already filters by the typed basename and returns full display
 * paths, so we pass them straight through (`filter:false`) and anchor `from` at the
 * value start, replacing the whole token on accept. No `validFor`, so each keystroke
 * re-queries (re-listing the parent dir as the user drills down).
 */
function fsPathCompletions(
  ctx: CompletionContext,
  rawValue: string,
  only: "dir" | "file" | undefined,
  listFsPaths: (value: string, only?: "dir" | "file") => Promise<VaultPath[]>,
): Promise<CompletionResult | null> {
  const from = ctx.pos - rawValue.length;
  const q = rawValue.replace(/^["']/, "").replace(/["']$/, "");
  return listFsPaths(q, only).then((entries): CompletionResult | null => {
    if (!entries.length) return null;
    const options: IconedCompletion[] = entries.slice(0, 50).map((e) => ({
      label: e.path,
      type: "path",
      lucideIcon: e.kind === "dir" ? "Folder" : "File",
    }));
    return { from, to: ctx.pos, options, filter: false };
  });
}

export function settingsCompletionSource(
  getSchema: () => Schema,
  getIconNames: () => string[],
  getTemplatePaths: () => string[],
  getVaultPaths: () => VaultPath[],
  listFsPaths: (value: string, only?: "dir" | "file") => Promise<VaultPath[]>,
): CompletionSource {
  return (ctx: CompletionContext): CompletionResult | Promise<CompletionResult | null> | null => {
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

    // FULL-VALUE position: "key: <value so far>" capturing the WHOLE value (incl.
    // spaces/commas). Handled before the generic \S* match because keybind combos
    // ("Mod+`, Mod+J") and paths with spaces ("Daily Notes") would otherwise be
    // mis-split. Dispatches by field type; other types fall through to the generic
    // value match below.
    const fullVal = before.match(/^\s*-?\s*([\w-]+):\s*(.*)$/);
    if (fullVal) {
      const { schema, sectionKey } = scopeAt(root, ctx, line.number, indent);
      const ft = sectionKey === "properties" ? "string" : (schema[fullVal[1]]?.type ?? "string");
      if (ft === "keybind") return keybindCompletions(ctx, fullVal[2]);
      if (typeof ft === "object" && ft.kind === "path") {
        if (!ctx.explicit && fullVal[2].length === 0) return null;
        if (ft.scope === "fs") return fsPathCompletions(ctx, fullVal[2], ft.only, listFsPaths);
        return pathCompletions(ctx, fullVal[2], ft, getTemplatePaths, getVaultPaths);
      }
    }

    // VALUE position: "key: <partial>" or "- key: <partial>" (list item).
    const val = before.match(/^\s*-?\s*([\w-]+):\s*(\S*)$/);
    if (val) {
      const [, key, typed] = val;
      if (!ctx.explicit && typed.length === 0) return null;
      const { schema, sectionKey } = scopeAt(root, ctx, line.number, indent);
      // Inside `properties:`, a value is a TYPE name (scalar or composite snippet),
      // not a typed field — handle it before the icon/enum/path branches below.
      if (sectionKey === "properties") return propertyTypeCompletions(ctx, typed);
      const fieldType = schema[key]?.type ?? "string";

      // icon-typed field -> a "open icon gallery" action (always first) + Lucide icon
      // names, EACH row showing its own icon (lucideIcon override). filter:false so the
      // gallery row is never filtered out and our case-insensitive name match owns the
      // list (no stale CM re-filter). The template `template:` and folder paths are
      // `path`-typed now and handled by the full-value branch above.
      if (fieldType === "icon") {
        const from = ctx.pos - typed.length;
        const p = typed.toLowerCase();
        const gallery: IconedCompletion = {
          label: "Open icon gallery",
          type: "gallery",
          lucideIcon: "Grip",
          apply: (view: EditorView, _c: Completion, applyFrom: number) => launchGallery(view, applyFrom, "icons"),
        };
        const names: IconedCompletion[] = getIconNames()
          .filter((n) => n.toLowerCase().startsWith(p))
          .slice(0, 50)
          .map((label) => ({ label, type: "icon", lucideIcon: label }));
        return { from, options: [gallery, ...names], filter: false };
      }

      // Toolbar `command:` enum carries allowPrefixes ["daily-note:"] — also offer the
      // document's configured daily-note ids (so daily-note:<id> autocompletes).
      const isCommand =
        typeof fieldType === "object" && fieldType.kind === "enum" &&
        (fieldType as { allowPrefixes?: string[] }).allowPrefixes?.includes("daily-note:");
      const dailyIds = isCommand ? dailyNoteIdsFromDoc(ctx.state.doc.toString()) : [];
      const dailyLabels = new Map<string, string>(dailyIds.map((d) => [`daily-note:${d.id}`, d.label || d.id]));

      const raw = [...valueOptions(fieldType), ...dailyIds.map((d) => `daily-note:${d.id}`)];
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

export function settingsCompletion(
  getSchema: () => Schema,
  getIconNames: () => string[],
  getTemplatePaths: () => string[],
  getVaultPaths: () => VaultPath[],
  listFsPaths: (value: string, only?: "dir" | "file") => Promise<VaultPath[]>,
): Extension {
  return autocompletion({
    ...completionDisplayConfig,
    override: [settingsCompletionSource(getSchema, getIconNames, getTemplatePaths, getVaultPaths, listFsPaths)],
  });
}
