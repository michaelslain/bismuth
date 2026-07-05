// app/src/daemonIdentity.ts
// The vault daemon's display name, client-side. The name lives in <vault>/.daemon/identity.md's
// `name:` frontmatter (single source of truth server-side: daemonIdentityName), surfaced to the
// client on GET /daemon/status. The chat surface presents AS the daemon — tab label, header crumb,
// composer placeholder — whenever the daemon is enabled, so this tiny store is the one place that
// name lives in the app.
import { createSignal } from "solid-js";
import { api } from "./api";
import { settings } from "./settings";

const [name, setName] = createSignal("daemon");

/** The daemon's identity name ("daemon" until /daemon/status loads). */
export function daemonName(): string {
  return name();
}

/** The persona the CHAT presents as: the daemon's name when the daemon is enabled, else null
 *  (callers fall back to the plain "Chat"/Claude naming). Reactive on both the settings flag
 *  and the fetched name. */
export function chatPersonaName(): string | null {
  return settings.daemon.enabled ? name() : null;
}

/** Re-fetch the identity name. Called on app mount and whenever daemon.enabled flips on;
 *  best-effort (a failed fetch keeps the current name). */
export async function refreshDaemonIdentity(): Promise<void> {
  try {
    const s = await api.daemonStatus();
    if (s.name && s.name.trim()) setName(s.name.trim());
  } catch {
    /* backend unreachable — keep the fallback/last-known name */
  }
}
