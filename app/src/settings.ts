// app/src/settings.ts
// The single source of user-configurable settings. Defaults equal today's
// hardcoded values, so a fresh install behaves exactly as before. Persisted to
// localStorage; hydrated through the pure `loadSettings` so it stays testable.
import { createStore } from "solid-js/store";
import { createEffect, createRoot } from "solid-js";

export type Theme = "dark" | "light";

export interface Settings {
  appearance: {
    accent: string;      // hex, drives accent-tinted UI (active tab, selection)
    theme: Theme;
    editorFont: string;  // key into FONT_STACKS
    editorFontSize: number; // px
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
  };
  editor: {
    livePreview: boolean;
    lineNumbers: boolean;
    lineWrapping: boolean;
    autoSaveDelay: number; // ms of idle before save
  };
  vault: {
    backupOnSave: boolean; // gate the git snapshot taken on every save
  };
}

// Editor font choices → full CSS font stacks. Lora + Monaspace ship via @fontsource.
export const FONT_STACKS: Record<string, string> = {
  Lora: "'Lora', serif",
  "Monaspace Xenon": "'Monaspace Xenon', ui-monospace, monospace",
  Georgia: "Georgia, 'Times New Roman', serif",
  "system-ui": "system-ui, -apple-system, sans-serif",
};
export const EDITOR_FONTS = Object.keys(FONT_STACKS);

// Node palettes. "aurora" is the current hardcoded pink→blue set.
export const PALETTES: Record<string, number[]> = {
  aurora: [0xf277de, 0x9177f2, 0x8b88f2, 0xbdcaf2, 0x77a0f2],
  ember: [0xff6b6b, 0xffa94d, 0xffd43b, 0xf08c00, 0xe8590c],
  forest: [0x51cf66, 0x2f9e44, 0x66d9e8, 0x099268, 0xa9e34b],
  mono: [0xe8e8e8, 0xc2c2c2, 0x9a9a9a, 0x767676, 0xd6d6d6],
};
export const PALETTE_KEYS = Object.keys(PALETTES);

export const DEFAULTS: Settings = {
  appearance: { accent: "#6496ff", theme: "dark", editorFont: "Lora", editorFontSize: 16 },
  graph: { spin: true, spinSpeed: 0.0015, palette: "aurora", repulsion: -10, linkDistance: 5, centering: 0.13, nodeSize: 6, viewMode: "3d", showGraphLabels: true, graphLabelHubCount: 10 },
  editor: { livePreview: true, lineNumbers: false, lineWrapping: true, autoSaveDelay: 800 },
  vault: { backupOnSave: true },
};

const KEY = "three-brains.settings";

/**
 * Merge a stored JSON blob over DEFAULTS. Pure and DOM-free so it can be tested.
 * Only known keys with a matching type are taken from storage; anything missing,
 * malformed, or unexpected falls back to the default — so old/partial blobs and
 * newly-added settings both resolve safely.
 */
export function loadSettings(raw: string | null): Settings {
  const out = structuredClone(DEFAULTS);
  if (!raw) return out;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return out;
  }

  if (!parsed || typeof parsed !== "object") return out;
  const p = parsed as Record<string, unknown>;

  // Merge each section from storage into the corresponding default section
  for (const section of Object.keys(out) as (keyof Settings)[]) {
    const stored = p[section];
    if (typeof stored !== "object") continue;

    const target = out[section] as Record<string, unknown>;
    for (const key of Object.keys(target)) {
      const storedValue = (stored as Record<string, unknown>)[key];
      // Only apply if type matches (handles schema evolution gracefully)
      if (typeof storedValue === typeof target[key]) target[key] = storedValue;
    }
  }

  return out;
}

const initial =
  typeof localStorage !== "undefined" ? loadSettings(localStorage.getItem(KEY)) : structuredClone(DEFAULTS);

const [settings, setSettings] = createStore<Settings>(initial);

// Persist on any change (browser only — no-op under tests / SSR).
if (typeof localStorage !== "undefined") {
  createRoot(() => {
    createEffect(() => localStorage.setItem(KEY, JSON.stringify(settings)));
  });
}

export function resetSettings() {
  setSettings(structuredClone(DEFAULTS));
}

export { settings, setSettings };
