// app/src/chatModelResolution.ts
// Pure model-precedence + model-namespace helpers for the visual chat (Bug #89: "chat not saving
// model per session"). Split out (like chatPermissionMode.ts's reconcilePermissionMode) so the rules
// are unit-tested without a live session / localStorage / Solid signal.
//
// THE NAMESPACE PROBLEM (the root cause of the "still broken" bounces): the header picker's values
// come from Query.supportedModels() and are short ALIASES — "default", "sonnet", "haiku",
// "opus[1m]" — while each turn's init manifest reports the FULLY-RESOLVED model id, e.g.
// "claude-haiku-4-5-20251001" (verified against a live CLI). The old code compared and stored the
// two interchangeably, so after the FIRST turn of any chat:
//   • persisted "opus[1m]" vs reported "claude-opus-4-8[1m]" never matched → the manifest handler
//     "adopted the drift" and OVERWROTE the user's persisted alias (per-chat AND global keys) with
//     the full id,
//   • the header <Select value> became a full id that matches no option → the picker visibly
//     deselected ("the model reset"),
//   • and the Effort picker keyed its levels off a value that matches no model → wrong levels.
// modelsCorrespond/modelOptionFor below make every comparison and display namespace-tolerant.

/** Split a model value into its base id and the "[1m]" (1M-context) suffix flag. The suffix is a
 *  REAL model choice (a different context-window variant), so correspondence requires it to match. */
export function splitModelSuffix(value: string): { base: string; oneM: boolean } {
  const oneM = value.endsWith("[1m]");
  return { base: oneM ? value.slice(0, -"[1m]".length) : value, oneM };
}

/** True when `outer` names the same model FAMILY as (or a versioned form of) `inner`: exact, or
 *  `inner` appears as a full dash-delimited segment of `outer` ("opus" ⊑ "claude-opus-4-8",
 *  "claude-fable-5" ⊑ "claude-fable-5-20260101" — but never "opus" ⊑ "opusplan"). */
function familyContains(outer: string, inner: string): boolean {
  if (outer === inner) return true;
  return outer.startsWith(`${inner}-`) || outer.endsWith(`-${inner}`) || outer.includes(`-${inner}-`);
}

/**
 * Namespace-tolerant model equality: do `a` and `b` name the SAME model, allowing one side to be a
 * picker alias ("haiku", "opus[1m]") and the other the manifest's fully-resolved id
 * ("claude-haiku-4-5-20251001", "claude-opus-4-8[1m]")?
 *  - exact match → true.
 *  - "default" corresponds to ANYTHING: it's an alias for "whatever the CLI's config resolves",
 *    so a manifest reporting the resolved id is not a divergence from a "default" choice.
 *  - the "[1m]" suffix must match on both sides (a different context variant IS a different choice).
 *  - otherwise, one base must name the other's model family (dash-segment containment, above).
 * Empty values never correspond (there's nothing to compare).
 */
export function modelsCorrespond(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a === "default" || b === "default") return true;
  const sa = splitModelSuffix(a);
  const sb = splitModelSuffix(b);
  if (sa.oneM !== sb.oneM) return false;
  return familyContains(sa.base, sb.base) || familyContains(sb.base, sa.base);
}

/** The minimal option shape the mapping helpers need (a projection of the `models` frame entries). */
export interface ModelOption {
  value: string;
  label: string;
}

/**
 * Map a model value (typically the manifest's fully-resolved id) onto the picker option that names
 * it, so the header <Select> shows the right selection and adopted values are stored in
 * picker-space. Exact value match wins; otherwise the first CORRESPONDING option — skipping
 * "default", which corresponds to everything and would swallow every lookup. Null when nothing
 * matches (an unknown model, or the options list hasn't arrived yet) — callers fall back to the raw
 * value.
 */
export function modelOptionFor(value: string, options: readonly ModelOption[]): string | null {
  if (!value) return null;
  for (const o of options) if (o.value === value) return o.value;
  for (const o of options) {
    if (o.value === "default") continue;
    if (modelsCorrespond(o.value, value)) return o.value;
  }
  return null;
}

/** The human label for a model value: its (corresponding) option's label, else the raw value. */
export function modelLabelFor(value: string, options: readonly ModelOption[]): string {
  const mapped = modelOptionFor(value, options);
  if (mapped !== null) {
    const opt = options.find((o) => o.value === mapped);
    if (opt) return opt.label;
  }
  return value;
}

/**
 * Resolve which model should be ACTIVE on a session's FIRST manifest.
 *
 * `persisted` is the client's best-known choice for this TAB — the per-chat
 * `bismuth.chat.model.<id>` localStorage value, falling back to the global last-used model.
 * `reported` is `frame.manifest.model`: for the spawn-time synthetic manifest this is the
 * SERVER-SIDE per-session store's model ("" when unknown — see core/src/chatModelStore.ts); for a
 * real per-turn init it's the CLI's fully-resolved active model.
 * `resumed` marks a RESUMED conversation (tab reopen, history picker, app relaunch).
 *
 * The precedence rule (Bug #89, the durable form):
 *  - RESUMED sessions own their model. The CLI itself restores a resumed session's model
 *    (verified live), and the server re-applies its per-session store on resume — so whatever the
 *    manifest reports IS the session's own saved model: `{ adopt }` it (reflect it in the header +
 *    per-tab key) and NEVER enforce the tab/global fallback over it. A resumed manifest with no
 *    model info ("") decides nothing — the first real init will report the CLI-restored model and
 *    reconcileManifestModel adopts it then.
 *  - FRESH sessions inherit the user's last choice: no persisted value → adopt the session's own
 *    default as the new fallback; persisted CORRESPONDS to reported (namespace-tolerant) → already
 *    in sync, nothing to do; otherwise → `{ enforce }` the persisted choice (push set_model).
 */
export function resolveInitialModel(
  persisted: string,
  reported: string,
  resumed: boolean,
): { adopt: string } | { enforce: string } | null {
  if (resumed) return reported ? { adopt: reported } : null;
  if (!persisted) return reported ? { adopt: reported } : null;
  if (modelsCorrespond(persisted, reported)) return null;
  return { enforce: persisted };
}

/**
 * Reconcile a LATER manifest (after the first) against the current choice. The old code
 * unconditionally persisted `frame.manifest.model` here — which, thanks to the alias/full-id
 * namespace mismatch, clobbered the user's persisted alias on the first turn of EVERY chat (the
 * exact Bug #89 report). Now:
 *  - no reported model, or reported CORRESPONDS to the current choice → null (just live re-init
 *    noise / the resolved form of what we already chose — change nothing).
 *  - a genuinely different model → `{ adopt }` it, mapped into picker-space when possible: the
 *    session really changed models (a composer `/model` command, a respawn decision), so the header
 *    and the per-tab key should follow the truth rather than fight it.
 */
export function reconcileManifestModel(
  current: string,
  reported: string,
  options: readonly ModelOption[],
): { adopt: string } | null {
  if (!reported) return null;
  if (modelsCorrespond(current, reported)) return null;
  return { adopt: modelOptionFor(reported, options) ?? reported };
}
