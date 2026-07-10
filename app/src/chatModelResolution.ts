// app/src/chatModelResolution.ts
// Pure model-precedence helper for the visual chat's FIRST manifest of a session (Bug #89: "chat
// not saving model per session"). Split out (like chatPermissionMode.ts's reconcilePermissionMode)
// so the rule that keeps the user's persisted per-chat model choice from being clobbered by the
// session's spawn default is unit-tested without a live session / localStorage / Solid signal.

/**
 * Resolve which model should actually be ACTIVE on a fresh/resumed session's first manifest.
 *
 * `persisted` is the user's own choice — this chat's `bismuth.chat.model.<id>` localStorage value
 * (falling back to the global last-used model), i.e. the SOURCE OF TRUTH the header should reflect.
 * `reported` is `frame.manifest.model`, the SDK's own SPAWN default for this session (whatever the
 * CLI's own config/last-model resolves to) — it has nothing to do with what the user picked in this
 * app before.
 *
 * The bug this guards against: the old code called `rememberModel(frame.manifest.model)`
 * UNCONDITIONALLY the moment the manifest arrived — before checking what the user had actually
 * picked — which overwrote the very signal ("lastModel") the "reapply my choice" step was about to
 * read. So `sendJson({ type: "set_model", model: lastModel() })` always just re-sent the manifest's
 * OWN default back to itself: a no-op that silently discarded the user's real preference every time
 * a chat (re)opened. resolveInitialModel keeps the two inputs separate so the caller can order its
 * side effects correctly — read `persisted` BEFORE touching anything else:
 *  - no persisted choice yet (`persisted` is empty) → `{ adopt: reported }` — nothing to override;
 *    adopt the session's own default as the new fallback for next time.
 *  - `persisted === reported`                       → `null` — already in sync, nothing to do.
 *  - `persisted !== reported`                        → `{ enforce: persisted }` — the session
 *    spawned with the WRONG model; push `set_model` with the user's real choice and reflect it in
 *    the header immediately (the backend never re-confirms a `set_model` via another manifest).
 *
 * Pure so "don't let the spawn default clobber my choice" is unit-tested without a live session.
 */
export function resolveInitialModel(
  persisted: string,
  reported: string,
): { adopt: string } | { enforce: string } | null {
  if (!persisted) return { adopt: reported };
  if (persisted === reported) return null;
  return { enforce: persisted };
}
