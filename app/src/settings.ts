// app/src/settings.ts
// The single source of user-configurable settings. Defaults equal today's
// hardcoded values, so a fresh install behaves exactly as before. The store is
// seeded SYNCHRONOUSLY from DEFAULTS (no white-screen on first paint), then
// hydrated from the vault's settings.yaml via GET /settings and persisted back
// by PATCHing only the keys that changed (POST /set-setting), so the backend can
// merge each change in place without clobbering comments, the property registry,
// or unknown keys. DEFAULTS is imported from the spine
// (core/src/schema/settingsSchema.ts) so the synchronous seed can never drift
// from the file the backend writes (single source of truth).
import { createStore, reconcile } from "solid-js/store";
import { createEffect, createRoot } from "solid-js";
import { stringify } from "yaml";
import { api } from "./api";
import { diffLeaves } from "./settingsDiff";
import { DEFAULTS, type AppSettings as SpineSettings } from "../../core/src/schema/settingsSchema";

export type Theme = "dark" | "light";

// The structural shape the frontend store consumes. Mirrors the spine's
// SETTINGS_SCHEMA leaf-by-leaf (the spine's derived AppSettings is loosely typed
// as Record<string, unknown>; this precise interface keeps the ~5 consumers —
// App.tsx / Editor.tsx / GraphView.tsx / Terminal.tsx — typed). DEFAULTS below
// is the spine object cast to this shape, so there is still ONE DEFAULTS.
export interface Settings {
  appearance: {
    accent: string;      // hex, drives accent-tinted UI (active tab, selection)
    theme: Theme;
    editorFont: string;  // key into FONT_STACKS
    editorFontSize: number; // px
    sidebarWidth: number;        // px
    sidebarGraphHeight: number;  // px
    uiFontSize: number;          // px
    tabFontSize: number;         // px
    sidebarIconFontSize: number; // px
    paletteInputFontSize: number; // px
  };
  graph: {
    spin: boolean;
    spinSpeed: number;   // radians/frame
    palette: string;     // key into PALETTES
    repulsion: number;   // d3 forceManyBody strength (negative = push apart)
    linkDistance: number;
    centering: number;   // forceX/Y/Z strength toward origin
    nodeSize: number;
    viewMode: "2d" | "3d"; // 3d = volumetric orbit; 2d = flat birdseye, locked rotation
    showGraphLabels: boolean;     // master toggle for in-scene labels
    graphLabelHubCount: number;   // number of top-degree nodes that always get a label (0..30)
    nodeSizeMinMult: number;      // size multiplier for a 0/1-degree leaf
    nodeSizeDegreeGain: number;   // size growth per sqrt(degree)
    nodeSizeMaxMult: number;      // ceiling on node size multiplier
    edgeColor: string;            // hex, link color
    backgroundColor: string;      // hex, graph canvas background
    mapDefaultZoom: number;       // default zoom for the Bases map view
    refreshDebounceMs: number;    // ms before rebuilding the graph after edits
  };
  editor: {
    livePreview: boolean;
    lineNumbers: boolean;
    lineWrapping: boolean;
    spellcheck: boolean; // spell + grammar check the note body (Harper)
    autoSaveDelay: number; // ms of idle before save
  };
  vault: {
    backupOnSave: boolean; // gate the git snapshot taken on every save
  };
  calendar: {
    defaultView: "month" | "week" | "3day" | "day";
    weekStartsOnMonday: boolean;
    militaryTime: boolean;
  };
  ui: {
    paletteTopOffset: string;  // CSS length, e.g. "12vh"
    paneDividerWidth: number;  // px
  };
}

// Alias so anything importing the canonical `AppSettings` name from the app gets
// the precise shape (the spine's own AppSettings is the loose derived type).
export type AppSettings = Settings;

// Re-export the spine's DEFAULTS as the single source of truth. It is structurally
// a superset (it also carries the empty `properties` registry, which the frontend
// ignores); cast to Settings for the precise consumer-facing type.
const SETTINGS_DEFAULTS = DEFAULTS as unknown as Settings;
export { SETTINGS_DEFAULTS as DEFAULTS };
// Local alias used throughout this module.
const _DEFAULTS: Settings = SETTINGS_DEFAULTS;
void (DEFAULTS satisfies SpineSettings);

// Editor font choices → full CSS font stacks. Lora + Monaspace ship via @fontsource.
export const FONT_STACKS: Record<string, string> = {
  Lora: "'Lora', serif",
  "Monaspace Xenon": "'Monaspace Xenon', ui-monospace, monospace",
  Georgia: "Georgia, 'Times New Roman', serif",
  "system-ui": "system-ui, -apple-system, sans-serif",
};

// Node palettes. "aurora" is the current hardcoded pink→blue set.
export const PALETTES: Record<string, number[]> = {
  aurora: [0xf277de, 0x9177f2, 0x8b88f2, 0xbdcaf2, 0x77a0f2],
  ember: [0xff6b6b, 0xffa94d, 0xffd43b, 0xf08c00, 0xe8590c],
  forest: [0x51cf66, 0x2f9e44, 0x66d9e8, 0x099268, 0xa9e34b],
  mono: [0xe8e8e8, 0xc2c2c2, 0x9a9a9a, 0x767676, 0xd6d6d6],
};

/**
 * Merge an already-parsed object over DEFAULTS using a per-key `typeof`-checked
 * merge. Pure and DOM-free. Only known keys whose stored type matches the default
 * type are taken; anything missing, malformed, or unexpected falls back to the
 * default. This is the single funnel for both localStorage blobs and server JSON,
 * so a corrupt settings.yaml degrades to defaults instead of poisoning the store.
 */
export function mergeServerSettings(parsed: unknown): Settings {
  const out = structuredClone(_DEFAULTS) as unknown as Record<string, unknown>;
  if (!parsed || typeof parsed !== "object") return out as unknown as Settings;
  const p = parsed as Record<string, unknown>;

  for (const section of Object.keys(out)) {
    const stored = p[section];
    if (!stored || typeof stored !== "object") continue;
    const target = out[section];
    if (!target || typeof target !== "object") continue;
    const tgt = target as Record<string, unknown>;
    for (const key of Object.keys(tgt)) {
      const storedValue = (stored as Record<string, unknown>)[key];
      if (typeof storedValue === typeof tgt[key]) tgt[key] = storedValue;
    }
  }
  return out as unknown as Settings;
}

/**
 * Merge a stored JSON *string* (localStorage) over DEFAULTS. Delegates to
 * `mergeServerSettings` after JSON.parse so both paths share one merge.
 */
export function loadSettings(raw: string | null): Settings {
  if (!raw) return structuredClone(_DEFAULTS);
  try {
    return mergeServerSettings(JSON.parse(raw));
  } catch {
    return structuredClone(_DEFAULTS);
  }
}

// --- Synchronous seed: never empty at first paint (consumers deref two levels
// deep with no optional chaining, so the store must always be fully shaped). ---
const [settings, setSettings] = createStore<Settings>(structuredClone(_DEFAULTS));

const LEGACY_KEY = "three-brains.settings";

/**
 * Decide the one-time first-launch import. If a legacy localStorage blob exists
 * AND the server's settings.yaml is still bare defaults, return the merged
 * settings to seed the file from. Otherwise return null (nothing to import).
 * Pure + testable.
 */
export function firstLaunchImport(
  legacyRaw: string | null,
  serverData: unknown,
): Settings | null {
  if (!legacyRaw) return null;
  const server = mergeServerSettings(serverData);
  const isBareDefaults = JSON.stringify(server) === JSON.stringify(_DEFAULTS);
  if (!isBareDefaults) return null;
  const imported = loadSettings(legacyRaw);
  if (JSON.stringify(imported) === JSON.stringify(_DEFAULTS)) return null;
  return imported;
}

// The store state we believe is on disk. The persister diffs the live store against
// it to PATCH only changed leaves; the SSE handler resets it after applying server
// data so our own write-echoes don't bounce back as redundant re-hydrates.
let lastSnapshot: Record<string, unknown> = structuredClone(_DEFAULTS) as unknown as Record<string, unknown>;
let persistTimer: ReturnType<typeof setTimeout> | undefined;
let hydrated = false;

async function hydrateFromServer(): Promise<void> {
  let data: Record<string, unknown>;
  try {
    data = await api.settings();
  } catch {
    return; // backend unreachable — keep the synchronous defaults seed
  }

  // First-launch: import legacy localStorage into settings.yaml once. The server is
  // bare defaults at this point (firstLaunchImport guards on that), so a one-time
  // whole-file write loses no comments/unknowns; reconcile shapes it on next open.
  const legacy = typeof localStorage !== "undefined" ? localStorage.getItem(LEGACY_KEY) : null;
  const imported = firstLaunchImport(legacy, data);
  if (imported) {
    try {
      await api.write("settings.yaml", stringify(imported));
      if (typeof localStorage !== "undefined") localStorage.removeItem(LEGACY_KEY);
    } catch { /* leave legacy in place; retry next launch */ }
    setSettings(reconcile(imported));
    lastSnapshot = structuredClone(imported) as unknown as Record<string, unknown>;
    hydrated = true;
    return;
  }

  const merged = mergeServerSettings(data);
  setSettings(reconcile(merged));
  lastSnapshot = structuredClone(merged) as unknown as Record<string, unknown>;
  hydrated = true;
}

if (typeof window !== "undefined") {
  // Dynamic import so pure `bun test` runs never load serverVersion.ts, which
  // instantiates an EventSource at module scope (undefined outside the browser).
  void import("./serverVersion").then(({ lastChange }) => {
    createRoot(() => {
      // 1. Hydrate once on boot.
      void hydrateFromServer();

      // 2. Re-hydrate when the SSE stream reports a settings.yaml change. If the
      //    merged server state already equals the live store it's our own write
      //    echoing back (or a no-op) — skip to avoid clobbering an in-flight edit.
      createEffect(() => {
        const change = lastChange();
        if (change.version <= 0) return;
        if (!change.paths.includes("settings.yaml")) return;
        void (async () => {
          let data: Record<string, unknown>;
          try { data = await api.settings(); } catch { return; }
          const merged = mergeServerSettings(data);
          if (JSON.stringify(merged) === JSON.stringify(settings)) return; // our echo / no-op
          setSettings(reconcile(merged));
          lastSnapshot = structuredClone(merged) as unknown as Record<string, unknown>;
        })();
      });

      // 3. Persist on change: optimistic in-memory apply already happened via
      //    setSettings callers; debounce, then PATCH only the leaves that changed
      //    since lastSnapshot. Skip until the first hydrate completes so we don't
      //    persist the synchronous defaults seed over the user's file.
      createEffect(() => {
        const snapshot = JSON.stringify(settings); // track all fields
        if (!hydrated) return;
        void snapshot;
        clearTimeout(persistTimer);
        persistTimer = setTimeout(() => {
          const current = JSON.parse(JSON.stringify(settings)) as Record<string, unknown>;
          const changes = diffLeaves(lastSnapshot, current);
          lastSnapshot = current;
          for (const { path, value } of changes) {
            api.setSetting(path, value).catch(() => { /* surfaced elsewhere */ });
          }
        }, 600);
      });
    });
  });
}

export function resetSettings() {
  setSettings(reconcile(structuredClone(_DEFAULTS)));
}

export { settings, setSettings };
