// app/src/blocks/editorMode.ts
// Per-note editing-mode store: 'source' (the CodeMirror Editor) vs 'blocks' (the
// Notion-like BlockEditor). The choice is a *transient* per-note UI preference, NOT a
// vault setting — toggling it must never write settings.yaml. It is keyed by note PATH
// (not leaf id) so a note opened in two panes/splits agrees with itself, and persisted to
// localStorage so the preference survives reload. This mirrors the graph 2D/3D toggle
// precedent in GraphView.tsx (module-level signal seeded from localStorage, never the
// vault).
import { createSignal } from "solid-js";
import { settings } from "../settings";

export type EditorMode = "source" | "blocks";

// One reactive map shared by every BlockEditor/Editor instance, so two surfaces over the
// same path stay in lockstep. Stored as a plain object signal (Solid re-emits on identity
// change) — the map is tiny (one entry per visited note this session).
const STORAGE_KEY = "oa:editorMode";

/** Default mode for a path we've never seen: settings.editor.defaultMode if present, else
 *  'source'. Read defensively — the schema key is added in a later phase, so the field may
 *  be absent on the live store. */
function defaultMode(): EditorMode {
  const m = (settings.editor as { defaultMode?: unknown }).defaultMode;
  return m === "blocks" ? "blocks" : "source";
}

/** Load the persisted path→mode map from localStorage (best-effort; private mode / quota /
 *  malformed JSON all fall back to an empty map). Only valid mode values are kept. */
function readStored(): Record<string, EditorMode> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, EditorMode> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v === "source" || v === "blocks") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

const [modes, setModes] = createSignal<Record<string, EditorMode>>(readStored());

function persist(next: Record<string, EditorMode>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* private mode / quota — in-memory only */
  }
}

/** Reactive: the editing mode for `path`. Falls back to the configured default for a path
 *  we haven't recorded yet. Reading this inside a component makes it react to setMode. */
export function getMode(path: string): EditorMode {
  return modes()[path] ?? defaultMode();
}

/** Set the editing mode for `path` and persist. A no-op when unchanged (keeps the signal
 *  identity stable so dependents don't re-run needlessly). */
export function setMode(path: string, mode: EditorMode): void {
  const cur = modes();
  if (cur[path] === mode) return;
  const next = { ...cur, [path]: mode };
  setModes(next);
  persist(next);
}

/** Flip `path` between source and blocks; returns the new mode. */
export function toggleMode(path: string): EditorMode {
  const next: EditorMode = getMode(path) === "blocks" ? "source" : "blocks";
  setMode(path, next);
  return next;
}
