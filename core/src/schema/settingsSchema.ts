// core/src/schema/settingsSchema.ts
// The fixed, documented schema for the vault `settings.yaml` file. Every key
// mirrors a current app setting (app/src/settings.ts DEFAULTS) plus its old
// SettingsPage slider bounds, so the first-launch writer can author a fully
// commented file and the same engine validates it. DEFAULTS is the plain nested
// object the frontend store seeds from synchronously (no white-screen on boot).
import type { Schema, SchemaEntry, PropertyType } from "./types";

// Kept in lockstep with app/src/settings.ts EDITOR_FONTS / PALETTE_KEYS.
const EDITOR_FONTS = ["Lora", "Monaspace Xenon", "Georgia", "system-ui"];
const PALETTE_KEYS = ["aurora", "ember", "forest", "mono"];
// CALENDAR_VIEWS must stay in sync with `ViewType` in app/src/calendar/types.ts
// (currently 'month' | 'week' | '3day' | 'day'). If ViewType changes, update here.
const CALENDAR_VIEWS = ["month", "week", "3day", "day"];

const enumType = (values: string[]): PropertyType => ({ kind: "enum", values });
const object = (fields: Schema): SchemaEntry => ({ type: { kind: "object", fields } });

export const SETTINGS_SCHEMA: Schema = {
  appearance: object({
    accent: { type: "string", default: "#6496ff", doc: "Accent color (hex) — tints active tab, selection." },
    theme: { type: enumType(["dark", "light"]), default: "dark", doc: "Color theme." },
    editorFont: { type: enumType(EDITOR_FONTS), default: "Lora", doc: "Editor font family." },
    editorFontSize: { type: "number", default: 16, min: 11, max: 28, doc: "Editor font size (px)." },
  }),
  graph: object({
    spin: { type: "boolean", default: true, doc: "Idle rotation of the graph." },
    spinSpeed: { type: "number", default: 0.0015, min: 0, max: 0.01, doc: "Idle spin speed (radians/frame)." },
    palette: { type: enumType(PALETTE_KEYS), default: "aurora", doc: "Node color palette." },
    repulsion: { type: "number", default: -10, min: -40, max: -1, doc: "Node repulsion; more negative pushes apart harder." },
    linkDistance: { type: "number", default: 5, min: 1, max: 40, doc: "Target distance between linked nodes." },
    centering: { type: "number", default: 0.13, min: 0, max: 0.5, doc: "Pull toward center; higher = denser ball." },
    nodeSize: { type: "number", default: 6, min: 2, max: 16, doc: "Base node radius." },
    viewMode: { type: enumType(["2d", "3d"]), default: "3d", doc: "3d = volumetric orbit; 2d = flat birdseye." },
    showGraphLabels: { type: "boolean", default: true, doc: "Master toggle for in-scene labels." },
    graphLabelHubCount: { type: "number", default: 10, min: 0, max: 30, doc: "Top-degree nodes that always get a label." },
  }),
  editor: object({
    livePreview: { type: "boolean", default: true, doc: "Render markdown inline as you type." },
    lineNumbers: { type: "boolean", default: false, doc: "Show line numbers." },
    lineWrapping: { type: "boolean", default: true, doc: "Wrap long lines." },
    spellcheck: { type: "boolean", default: true, doc: "Spell + grammar check the note body (Harper)." },
    autoSaveDelay: { type: "number", default: 800, min: 200, max: 3000, doc: "Milliseconds of idle before saving." },
  }),
  vault: object({
    backupOnSave: { type: "boolean", default: true, doc: "Take a git snapshot after every save." },
  }),
  calendar: object({
    // defaultView enum is coupled to ViewType in app/src/calendar/types.ts.
    defaultView: { type: enumType(CALENDAR_VIEWS), default: "week", doc: "Default calendar view." },
    weekStartsOnMonday: { type: "boolean", default: true, doc: "Start the week on Monday." },
    militaryTime: { type: "boolean", default: false, doc: "Use 24-hour time." },
  }),
  // The vault-wide property registry. Free-form `{name: typeString}`, validated
  // leniently by registry.loadRegistry — seeded empty on first launch.
  properties: { type: { kind: "object", fields: {} }, doc: "Vault property registry: map each frontmatter key to a type." },
};

/** Recursively materialize the `default` of every leaf into a plain nested object. */
function deriveDefaults(schema: Schema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(schema)) {
    if (typeof entry.type === "object" && entry.type.kind === "object") {
      out[key] = deriveDefaults(entry.type.fields);
    } else if (entry.default !== undefined) {
      out[key] = entry.default;
    }
  }
  return out;
}

// AppSettings is the structural shape the frontend store consumes; deriving it
// from the schema keeps it in lockstep with the documented defaults.
export type AppSettings = ReturnType<typeof deriveDefaults>;

export const DEFAULTS: AppSettings = deriveDefaults(SETTINGS_SCHEMA);
