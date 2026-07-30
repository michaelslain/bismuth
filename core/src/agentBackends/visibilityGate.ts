// core/src/agentBackends/visibilityGate.ts
// THE chokepoint: may backend B serve channel C for vault V, given what V hides?
//
// Why this is one function rather than a check in each driver: the per-backend chat drivers were
// written independently, and NONE of codex, cline, gemini, goose, openclaw or the two ACP adapters
// checked visibility at all. The refusal ChatFrame existed, docs/vault/visibility.md said those
// backends were "refused", and in reality they would have spawned and run UNGATED against a vault
// with hidden notes. Seven drivers cannot be kept honest by review; one chokepoint can, and a new
// backend is refused by DEFAULT because its catalog entry starts at "none".
//
// The rule it encodes, from docs/vault/visibility.md: a backend may serve a restricted vault only
// if its catalog capability says it has a VERIFIED enforcement mechanism for that channel. Anything
// else refuses — loudly, with both ways out named — rather than running unprotected.
import { buildDenyPaths, type VisibilityChannel } from "../visibility";
import { visibilityRefusalMessage } from "../chat";
import { BACKENDS, isBackendId, type BackendDescriptor } from "./catalog";

export type GateVerdict =
  | { allowed: true }
  | { allowed: false; restrictedCount: number; message: string };

/**
 * Pure: does this backend have a verified enforcement mechanism for this channel?
 *
 * `"none"` is the only falsy value, and it is the default for every backend that has not had a
 * recorded live acceptance run — see the honesty rule on `VisibilityEnforcement` in ./catalog.ts.
 * Both `"native"` (Claude's own SDK deny) and `"wrapper-macos"` (our Seatbelt wrapper) count.
 */
export function enforcesFor(d: BackendDescriptor, channel: VisibilityChannel): boolean {
  return d.capabilities.visibilityGate[channel] !== "none";
}

/**
 * Decide whether `backendId` may open a session on `channel` against the vault at `root`.
 *
 * Fail-safe in three distinct ways, each of which was a real bug class here:
 *  - An UNKNOWN backend id refuses. `backendOf()` deliberately degrades an unknown id to the default
 *    backend, which would silently hand a typo'd or newer-build id Claude's "enforced" answer — so
 *    the id is validated before the descriptor is looked up.
 *  - An UNREADABLE vault refuses. If we cannot tell what is restricted, we must assume something is.
 *  - A backend with no verified mechanism refuses, even though its CLI might in fact be safe. "It
 *    should work, it's the same OS primitive" is exactly the reasoning ./catalog.ts's honesty rule
 *    forbids.
 *
 * A vault that restricts nothing allows everything: the gate must not tax the common case.
 */
export async function resolveVisibilityGate(
  backendId: string,
  channel: VisibilityChannel,
  root: string,
): Promise<GateVerdict> {
  let restricted;
  try {
    restricted = await buildDenyPaths(root, channel);
  } catch {
    return {
      allowed: false,
      restrictedCount: 0,
      message:
        "Bismuth couldn't read this vault's visibility settings, so this chat wasn't started rather " +
        "than risk running without them. Check the vault's `.settings` file, then try again.",
    };
  }
  if (restricted.length === 0) return { allowed: true };

  // Unknown id: refuse before backendOf() can degrade it into the default backend's answer.
  if (!isBackendId(backendId)) {
    return {
      allowed: false,
      restrictedCount: restricted.length,
      message: visibilityRefusalMessage(backendId, restricted.length),
    };
  }
  const d = BACKENDS[backendId];
  if (enforcesFor(d, channel)) return { allowed: true };
  return {
    allowed: false,
    restrictedCount: restricted.length,
    message: visibilityRefusalMessage(d.label, restricted.length),
  };
}
