// core/src/gcal/state.ts
// Durable Google-Calendar credentials + tokens, stored OUTSIDE the vault so they are
// never committed to git: ~/.bismuth/gcal/state.json, written with 0600 perms. The
// vault's settings.yaml holds only non-secret operational config (see settingsSchema
// `googleCalendar`); every secret (client secret, refresh token) lives only here.
// Reads never throw — a missing/corrupt file degrades to {}.
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, chmodSync, rmSync, existsSync } from "node:fs";

export interface GcalState {
  /** OAuth "Desktop app" client id (not secret, but kept with the secret for simplicity). */
  clientId?: string;
  /** OAuth client secret — not truly secret for a public native client (RFC 8252), but a credential. */
  clientSecret?: string;
  /** Long-lived refresh token (the actual sensitive credential). */
  refreshToken?: string;
  /** Primary calendar summary ≈ the account email, shown in the UI. */
  account?: string;
  /** Primary calendar IANA timezone, captured at connect. */
  timeZone?: string;
  /** ISO timestamp of the last successful connect. */
  connectedAt?: string;
}

function gcalDir(home: string = homedir()): string {
  return join(home, ".bismuth", "gcal");
}
function statePath(home?: string): string {
  return join(gcalDir(home), "state.json");
}

/** Read the stored state; returns {} if absent or unreadable (never throws). */
export function readGcalState(home?: string): GcalState {
  try {
    const obj = JSON.parse(readFileSync(statePath(home), "utf8"));
    return obj && typeof obj === "object" ? (obj as GcalState) : {};
  } catch {
    return {};
  }
}

/** Merge `patch` into the stored state and persist (creating the dir, enforcing 0600). */
export function writeGcalState(patch: Partial<GcalState>, home?: string): GcalState {
  const next = { ...readGcalState(home), ...patch };
  mkdirSync(gcalDir(home), { recursive: true, mode: 0o700 });
  const path = statePath(home);
  writeFileSync(path, JSON.stringify(next, null, 2), { mode: 0o600 });
  // writeFileSync's `mode` only applies when creating the file; re-assert on overwrite.
  try { chmodSync(path, 0o600); } catch { /* best effort */ }
  return next;
}

/** Delete the stored state file (disconnect). Never throws. */
export function clearGcalState(home?: string): void {
  try {
    if (existsSync(statePath(home))) rmSync(statePath(home));
  } catch {
    /* ignore */
  }
}

/**
 * Drop only the token + identity (refresh token revoked/expired), KEEPING the client
 * credentials so reconnect just needs re-consent (not re-entering the client id/secret).
 * After this, status().connected is false but needsCredentials stays false.
 */
export function clearGcalToken(home?: string): void {
  writeGcalState({ refreshToken: undefined, account: undefined, connectedAt: undefined }, home);
}
