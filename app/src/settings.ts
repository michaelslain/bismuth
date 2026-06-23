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
import { readCache, writeCache } from "./viewCache";
import { diffLeaves } from "./settingsDiff";
import { DEFAULTS, type AppSettings as SpineSettings } from "../../core/src/schema/settingsSchema";
import { SHEEN } from "./themes";

// The structural shape the frontend store consumes. Mirrors the spine's
// SETTINGS_SCHEMA leaf-by-leaf (the spine's derived AppSettings is loosely typed
// as Record<string, unknown>; this precise interface keeps the ~5 consumers —
// App.tsx / Editor.tsx / GraphView.tsx / Terminal.tsx — typed). DEFAULTS below
// is the spine object cast to this shape, so there is still ONE DEFAULTS.
export interface Settings {
  appearance: {
    // Centralized theme tokens (the 5 groups everything derives from).
    // Bismuth color theme name — selects all colors; see app/src/themes.ts. The app
    // is dark-only. There are no per-color override keys in the initial release.
    theme: string;
    icon: string; // app logo mark name (app/scripts/logoMarks.ts MARK_NAMES)
    editorFont: string;  // key into FONT_STACKS
    editorFontSize: number; // px
    sidebarWidth: number;        // px
    sidebarGraphHeight: number;  // px
    uiFontSize: number;          // px
    monoScale: number;           // optical-size multiplier for Monaspace (mono UI/code)
    tabFontSize: number;         // px
    sidebarIconFontSize: number; // px
    paletteInputFontSize: number; // px
  };
  graph: {
    spin: boolean;
    showFps: boolean;    // show the FPS counter on the graph
    spinSpeed: number;   // radians/frame
    repulsion: number;   // d3 forceManyBody strength (negative = push apart)
    linkDistance: number;
    centering: number;   // forceX/Y/Z strength toward origin
    nodeSize: number;
    // viewMode (2D/3D) is intentionally NOT here — it's a transient per-window UI toggle
    // (localStorage) in GraphView.tsx, not a persisted setting. See settingsSchema.ts.
    showGraphLabels: boolean;     // master toggle for in-scene labels
    graphLabelHubCount: number;   // number of top-degree nodes that always get a label (0..30)
    nodeSizeMinMult: number;      // size multiplier for a 0/1-degree leaf
    nodeSizeDegreeGain: number;   // size growth per sqrt(degree)
    nodeSizeMaxMult: number;      // ceiling on node size multiplier
    mapDefaultZoom: number;       // default zoom for the Bases map view
    refreshDebounceMs: number;    // ms before rebuilding the graph after edits
  };
  editor: {
    defaultMode: "source" | "visual"; // how a note opens: raw markdown editor vs no-code visual editor
    livePreview: boolean;
    lineNumbers: boolean;
    lineWrapping: boolean;
    spellcheck: boolean; // spell check the note body (Harper)
    grammarCheck: boolean; // grammar + style check the note body (Harper); off by default

    autoSaveDelay: number; // ms of idle before save
    lineHeight: number;    // editor prose line height (multiplier)
    mathMacros: string;    // LaTeX \newcommand preamble applied to all math (Obsidian preamble.sty parity)
    wrapSelection: boolean;       // type a wrap char around a selection to surround it
    wrapSelectionChars: string[]; // which chars wrap the selection when typed
  };
  vault: {
    backupOnSave: boolean; // gate the git snapshot taken on every save
  };
  attachments: {
    folder: string;                 // where new pasted/dropped attachments are saved
    onDrop: "copy" | "reference";   // external drag behavior (⌥-drop always references)
    naming: string;                 // filename template for pasted clipboard images
  };
  calendar: {
    defaultView: "month" | "week" | "3day" | "day";
    weekStartsOnMonday: boolean;
    militaryTime: boolean;
    monthCellMinHeight: number;   // px
    timeGutterWidth: number;      // px
    defaultCategoryColor: string; // hex
  };
  ui: {
    paletteTopOffset: string;  // CSS length, e.g. "12vh"
    paneDividerWidth: number;  // px
    cardGridMinWidth: number;     // px
    kanbanColumnMinWidth: number; // px
    kanbanColumnMaxWidth: number; // px
    mapMinHeight: number;         // px
    tableMinColWidth: number;     // px
  };
  server: {
    fileWatchDebounceMs: number; // backend: coalesce file changes (ms)
    sseHeartbeatMs: number;      // backend: live-update keepalive interval (ms)
  };
  daemon: {
    enabled: boolean;    // supervise the claude-bot daemon
    home: string;        // override claude-bot home dir ("" = ~/.claude-bot)
    autoUpdate: boolean; // auto-update the daemon on launch when behind
  };
  update: {
    autoUpdate: boolean; // auto-apply Bismuth app updates on launch (auto-relaunch when ready)
  };
  terminal: {
    fontSize: number;          // px
    lineHeight: number;        // multiplier
    cursorWidth: number;       // px
    cursorGlideMs: number;     // ms
    cursorBlinkSeconds: number; // s
  };
  srs: {
    baseEase: number;
    easyBonus: number;
    lapsesIntervalChange: number;
    minEase: number;
    easeStep: number;
    easyGraduatingInterval: number;
    goodGraduatingInterval: number;
  };
  templates: {
    folder: string; // vault folder containing template .md files
  };
  // Global keyboard shortcuts, keyed by action id (core/src/keybindings.ts).
  // Each value is a combo like "Mod+P" (Mod = Cmd on macOS / Ctrl elsewhere);
  // comma-separate alternatives ("Mod+`, Mod+J"). App.tsx matches events
  // against these (app/src/keybindings.ts), never a hardcoded combo.
  keybindings: {
    "find": string;
    "command-palette": string;
    "quick-switcher": string;
    "terminal": string;
    "split-right": string;
    "split-down": string;
    "equalize-panes": string;
    "close-pane": string;
    "new-tab": string;
    "reopen-tab": string;
    "history-back": string;
    "history-forward": string;
    "focus-pane-left": string;
    "focus-pane-right": string;
    "focus-pane-up": string;
    "focus-pane-down": string;
    "new-claude-chat": string;
    "insert-template": string;
    "toggle-sidebar": string;
  };
  toolbar: Array<{ command?: string; commands?: string[]; icon: string; tooltip?: string }>;
  dailyNotes: Array<{ id: string; label: string; icon: string; folder: string; fileName: string; template: string }>;
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

// The fallback accent palette. Categories (graph nodes/clusters/tags, drawing ink
// swatches, terminal ANSI) normally derive from the selected theme's accentPalette
// (resolveTheme in themes.ts); this is only used when that ramp is absent/empty.
// Single-sourced from themes.ts's SHEEN so the values can't drift.
export const DEFAULT_ACCENT_PALETTE = SHEEN;

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
    // Top-level list settings (e.g. `toolbar`) are whole-leaf values, not nested
    // sections: replace wholesale when the server sends an array (honoring an
    // explicit empty list), keep the default otherwise. Without this, the
    // section-merge below would index-overlay the array against the default's
    // elements and corrupt any list whose length differs from the default.
    if (Array.isArray(out[section])) {
      if (Array.isArray(stored)) out[section] = stored;
      continue;
    }
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

// localStorage key for the last hydrated settings, used to seed the store on the next
// launch so the real theme/fonts/sizes paint on the FIRST frame instead of flashing
// DEFAULTS until GET /settings resolves. Reconciled to server truth on hydrate.
const SETTINGS_CACHE_KEY = "oa-settings-cache-v1";

// --- Synchronous seed: never empty at first paint (consumers deref two levels deep with
// no optional chaining, so the store must always be fully shaped). Seeded from the last
// hydrated settings (localStorage) when present — mergeServerSettings(undefined) falls back
// to DEFAULTS, so a cold cache behaves exactly as before. ---
const [settings, setSettings] = createStore<Settings>(
  mergeServerSettings(readCache(SETTINGS_CACHE_KEY)),
);

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
  // Skip the live settings sync (EventSource + GET /settings + persist) during the
  // first-run intro / `?intro=1` preview: there's no backend yet, so it would only spam
  // failed fetches + a "connection lost" toast behind the takeover. The synchronous
  // DEFAULTS seed (createStore above) is all the intro needs to render + re-theme.
  const introMode =
    (window as unknown as { __OA_FIRST_RUN__?: boolean }).__OA_FIRST_RUN__ === true ||
    new URLSearchParams(window.location.search).has("intro");
  // Dynamic import so pure `bun test` runs never load serverVersion.ts, which
  // instantiates an EventSource at module scope (undefined outside the browser).
  if (!introMode)
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
        JSON.stringify(settings); // track all fields
        if (!hydrated) return;
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

      // 4. Mirror the live settings into localStorage so the next launch can seed the
      //    store (and the inline theme script in index.html) before GET /settings lands.
      //    Tracks every field; runs on the seed, on hydrate, and on each user edit.
      createEffect(() => {
        writeCache(SETTINGS_CACHE_KEY, settings);
      });
    });
  });
}

export function resetSettings() {
  setSettings(reconcile(structuredClone(_DEFAULTS)));
}

export { settings, setSettings };
