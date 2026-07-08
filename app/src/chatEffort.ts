// app/src/chatEffort.ts
// Pure reasoning-effort helpers for the visual chat (ChatView.tsx), split out so the rules that
// drive the header's Effort picker (FEATURE #63: "can't select effort in chat") are unit-testable
// without importing the Solid component (which pulls in CSS + the DOM). No Solid / DOM / localStorage
// here — just data. The effort LEVELS themselves are never hardcoded: they come off the live `models`
// frame (each model carries its own supportedEffortLevels from the SDK), and these helpers only pick
// friendly labels + coerce a persisted value against whatever the selected model actually allows.

/** One selectable model as it arrives on the `models` frame — only the fields the Effort picker
 *  needs (its value + the effort levels it supports). Mirrors the wider entry in core/src/chat.ts. */
export interface EffortModel {
  value: string;
  effortLevels: string[];
}

/** A single option for the Effort `Select`. */
export interface EffortOption {
  value: string;
  label: string;
}

/** Human labels for the SDK's discrete effort levels (EffortLevel = low|medium|high|xhigh|max).
 *  A level not listed here falls back to a capitalized form, so a future level still renders. */
export const EFFORT_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

/** The SDK's documented default effort ("high" — deep reasoning). Used ONLY as the picker's DISPLAY
 *  fallback before the user has chosen a level; it is never force-sent to the session (an unset
 *  effort leaves the model/CLI default untouched). */
export const DEFAULT_EFFORT_DISPLAY = "high";

/** A friendly label for an effort level. */
export function effortLabel(level: string): string {
  return EFFORT_LABELS[level] ?? (level ? level.charAt(0).toUpperCase() + level.slice(1) : level);
}

/**
 * Coerce a persisted / loaded effort value to one the given model allows, else "" (unset). Guards
 * the localStorage read so a stale level (or one the current model doesn't support) can never seed
 * the picker with something the session would reject. `allowed` is the selected model's live
 * supportedEffortLevels — the single source of truth, never a hardcoded set.
 */
export function sanitizeEffort(raw: string | null | undefined, allowed: readonly string[]): string {
  return raw != null && allowed.includes(raw) ? raw : "";
}

/**
 * The Effort picker's options for the currently-selected model: exactly that model's
 * supportedEffortLevels (from the `models` frame), mapped to {value,label}. Returns [] when the
 * model is unknown or exposes no effort levels (an older CLI / a model without effort) — the header
 * then hides the picker. Pure so the "options track the selected model" rule is unit-tested.
 */
export function effortOptionsForModel(modelValue: string, models: readonly EffortModel[]): EffortOption[] {
  const m = models.find((x) => x.value === modelValue);
  const levels = m?.effortLevels ?? [];
  return levels.map((l) => ({ value: l, label: effortLabel(l) }));
}
