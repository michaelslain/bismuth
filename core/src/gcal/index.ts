// core/src/gcal/index.ts
// In-process orchestration of the Google Calendar OAuth flow — one instance per core
// process, like relay.ts. Holds the short-lived pending-PKCE map (keyed by the OAuth
// `state`) plus an access-token cache, and persists durable credentials/tokens via
// state.ts (outside the vault). Phase 0 surface: setCredentials / startAuth /
// completeAuth / status / disconnect. Sync (Phase 1+) will call getAccessToken().
import { createVerifier, createState, challengeFromVerifier } from "./pkce";
import { buildAuthUrl, exchangeCode, refreshAccessToken, revokeToken } from "./oauth";
import { primaryInfo } from "./client";
import { readGcalState, writeGcalState, clearGcalState, clearGcalToken } from "./state";
import { syncEvents, type SyncResult, type ConflictPolicy } from "./sync";
import { clearManifest } from "./manifest";
import { withSyncLock } from "./lock";

// Pending authorizations, keyed by the OAuth `state` param, pruned by age. A flow that
// never returns to the loopback callback simply expires here.
interface Pending {
  verifier: string;
  redirectUri: string;
  createdAt: number;
}
const pending = new Map<string, Pending>();
const PENDING_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Cached access token, refreshed from the durable refresh token on demand.
let accessCache: { token: string; expiresAt: number } | null = null;

function prunePending(now = Date.now()): void {
  for (const [k, v] of pending) if (now - v.createdAt > PENDING_TTL_MS) pending.delete(k);
}

export interface GcalStatus {
  connected: boolean;
  needsCredentials: boolean;
  account?: string;
  timeZone?: string;
  connectedAt?: string;
}

/** Current connection state, read fresh from the durable store. */
export function status(): GcalStatus {
  const s = readGcalState();
  return {
    connected: Boolean(s.refreshToken),
    needsCredentials: !s.clientId || !s.clientSecret,
    account: s.account,
    timeZone: s.timeZone,
    connectedAt: s.connectedAt,
  };
}

/** Persist the OAuth client credentials (id + secret) outside the vault. */
export function setCredentials(clientId: string, clientSecret: string): void {
  writeGcalState({ clientId: clientId.trim(), clientSecret: clientSecret.trim() });
}

/** Begin an auth flow: returns the consent URL to open in the system browser. */
export async function startAuth(redirectUri: string): Promise<string> {
  const s = readGcalState();
  if (!s.clientId) throw new Error("missing Google client ID — set credentials first");
  prunePending();
  const verifier = createVerifier();
  const state = createState();
  const challenge = await challengeFromVerifier(verifier);
  pending.set(state, { verifier, redirectUri, createdAt: Date.now() });
  return buildAuthUrl({ clientId: s.clientId, redirectUri, challenge, state });
}

/** Complete the flow from the loopback callback: exchange code, store refresh token + identity. */
export async function completeAuth(code: string, state: string): Promise<GcalStatus> {
  prunePending();
  const p = pending.get(state);
  if (!p) throw new Error("unknown or expired auth state");
  pending.delete(state);
  const s = readGcalState();
  if (!s.clientId) throw new Error("missing Google client ID");
  const tok = await exchangeCode({
    clientId: s.clientId,
    clientSecret: s.clientSecret,
    code,
    verifier: p.verifier,
    redirectUri: p.redirectUri,
  });
  if (!tok.refresh_token) throw new Error("Google returned no refresh token — re-consent required");
  accessCache = { token: tok.access_token, expiresAt: Date.now() + tok.expires_in * 1000 };
  // Identity is best-effort; the token is already valid even if this read fails.
  let account = "Google Calendar";
  let timeZone = "";
  try {
    const info = await primaryInfo(tok.access_token);
    account = info.account;
    timeZone = info.timeZone;
  } catch {
    /* keep defaults */
  }
  writeGcalState({
    refreshToken: tok.refresh_token,
    account,
    timeZone,
    connectedAt: new Date().toISOString(),
  });
  return status();
}

/** A valid access token, refreshing from the stored refresh token when near expiry. */
export async function getAccessToken(): Promise<string> {
  if (accessCache && Date.now() < accessCache.expiresAt - 60_000) return accessCache.token;
  const s = readGcalState();
  if (!s.refreshToken || !s.clientId) throw new Error("not connected to Google Calendar");
  let tok;
  try {
    tok = await refreshAccessToken({
      clientId: s.clientId,
      clientSecret: s.clientSecret,
      refreshToken: s.refreshToken,
    });
  } catch (e) {
    // A revoked / expired refresh token never recovers. Drop the dead token so status() flips
    // to disconnected and the UI prompts a reconnect — instead of every sync looping on the
    // same opaque failure forever while still showing "connected".
    if (/invalid_grant/i.test((e as Error).message)) {
      accessCache = null;
      clearGcalToken();
      throw new Error("Google access was revoked or expired — reconnect Google Calendar");
    }
    throw e;
  }
  accessCache = { token: tok.access_token, expiresAt: Date.now() + tok.expires_in * 1000 };
  return tok.access_token;
}

// Serialize all syncs in this process: a manual "Sync now" and the background ticker
// must never run concurrently (interleaved reads/writes of the base file + manifest can
// strand links and even mis-detect deletions). New sync() calls queue behind the in-flight
// one rather than racing it.
let syncChain: Promise<unknown> = Promise.resolve();

/** Two-way sync (Google ⇄ Bismuth): refresh a token, then reconcile both directions. */
export function sync(
  vault: string,
  basePath: string,
  calendarId: string,
  policy: ConflictPolicy,
  timeZonePref: string,
  theme?: string,
): Promise<SyncResult> {
  const run = async (): Promise<SyncResult> => {
    const token = await getAccessToken();
    const tz =
      (timeZonePref && timeZonePref.trim()) ||
      readGcalState().timeZone ||
      Intl.DateTimeFormat().resolvedOptions().timeZone ||
      "UTC";
    // Cross-process lock: no two backends can sync the shared manifest concurrently.
    return withSyncLock(() => syncEvents({ vault, basePath, calendarId, accessToken: token, policy, timeZone: tz, theme }));
  };
  const result = syncChain.then(run, run); // run after the previous sync settles
  syncChain = result.catch(() => {}); // a failed sync must not break the chain
  return result;
}

/** Disconnect: revoke the refresh token (best effort) and wipe all stored state + manifest. */
export async function disconnect(): Promise<void> {
  const s = readGcalState();
  if (s.refreshToken) await revokeToken(s.refreshToken);
  accessCache = null;
  clearGcalState();
  clearManifest();
}
