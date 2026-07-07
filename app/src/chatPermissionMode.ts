// app/src/chatPermissionMode.ts
// Pure permission-mode helpers for the visual chat (ChatView.tsx), split out so the rules that
// make the user's chosen mode STICK (FEATURE #35) are unit-testable without importing the Solid
// component (which pulls in CSS + the DOM). No Solid / DOM / localStorage here — just data.

/** The permission modes Claude Code supports — the fixed protocol values (not a feature list). */
export const PERMISSION_MODES = ["default", "plan", "acceptEdits", "bypassPermissions"] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

/** The APP-LEVEL default for the visual chat: every chat starts in Bypass so tool use isn't gated
 *  by an approval prompt by default (BUG #14). Persisted picks override it (FEATURE #35). */
export const DEFAULT_PERMISSION_MODE: PermissionMode = "bypassPermissions";

/** Coerce a persisted / loaded value to a valid mode, falling back to the app default. Guards the
 *  localStorage read so a stale or garbage value can never seed the header with a bad mode. */
export function sanitizePermissionMode(raw: string | null | undefined): PermissionMode {
  return raw != null && (PERMISSION_MODES as readonly string[]).includes(raw)
    ? (raw as PermissionMode)
    : DEFAULT_PERMISSION_MODE;
}

/**
 * Reconcile a LATER per-turn manifest's reported permission mode against the user's DESIRED mode
 * (their chosen / persisted one) — the fix for "permissions keep resetting to default" (#35).
 *
 * The SDK re-reports its SPAWN default ("default") whenever a session's query() re-initializes
 * mid-conversation (e.g. a visibility respawn's fresh `init` manifest). The old code trusted that
 * manifest and silently reverted the user's Bypass/explicit choice. Instead:
 *  - reported === desired            → null (nothing to do).
 *  - desired is "plan", reported ISN'T → { adopt } — a genuine server transition (Claude leaving
 *    plan mode via ExitPlanMode); reflect it in the header (session-local, NOT persisted).
 *  - any other divergence            → { enforce: desired } — a re-reported spawn default that must
 *    NOT clobber the user's choice; re-push `desired` to the session so the mode sticks.
 *
 * Pure so the "don't let a manifest revert my choice" rule is unit-tested without a live session.
 */
export function reconcilePermissionMode(
  desired: string,
  reported: string,
): { adopt: string } | { enforce: string } | null {
  if (reported === desired) return null;
  if (desired === "plan" && reported !== "plan") return { adopt: reported };
  return { enforce: desired };
}
