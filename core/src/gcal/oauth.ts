// core/src/gcal/oauth.ts
// Google OAuth 2.0 "Authorization Code + PKCE" flow for a desktop/installed client
// (RFC 8252): build the consent URL, exchange the code for tokens, refresh, revoke.
// The single requested scope is calendar.events — read+write to calendar EVENTS only;
// it grants NO access to Gmail, Drive, contacts, or calendar sharing/ACLs (Google
// enforces this server-side). The OOB redirect is dead — callers pass a loopback
// (http://127.0.0.1:<port>) redirect URI.

export const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

/** Minimal scope: read + write calendar EVENTS only. */
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";

export interface AuthUrlParams {
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
  scope?: string;
}

/**
 * Build the Google consent URL. `access_type=offline` + `prompt=consent` ensure a
 * refresh token is (re-)issued; `code_challenge_method=S256` is the PKCE protection
 * for a public native client (no reliance on the client secret).
 */
export function buildAuthUrl(p: AuthUrlParams): string {
  const q = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: "code",
    scope: p.scope ?? CALENDAR_SCOPE,
    code_challenge: p.challenge,
    code_challenge_method: "S256",
    state: p.state,
    access_type: "offline",
    prompt: "consent",
  });
  return `${AUTH_ENDPOINT}?${q.toString()}`;
}

export interface TokenResponse {
  access_token: string;
  expires_in: number; // seconds
  refresh_token?: string;
  scope?: string;
  token_type?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`google token endpoint ${res.status}: ${text}`);
  return JSON.parse(text) as TokenResponse;
}

export interface ExchangeParams {
  clientId: string;
  clientSecret?: string;
  code: string;
  verifier: string;
  redirectUri: string;
}

/** Exchange an authorization code for tokens, presenting the PKCE verifier. */
export function exchangeCode(p: ExchangeParams): Promise<TokenResponse> {
  return tokenRequest({
    grant_type: "authorization_code",
    code: p.code,
    client_id: p.clientId,
    ...(p.clientSecret ? { client_secret: p.clientSecret } : {}),
    redirect_uri: p.redirectUri,
    code_verifier: p.verifier,
  });
}

/** Mint a fresh access token from a stored refresh token. */
export function refreshAccessToken(p: {
  clientId: string;
  clientSecret?: string;
  refreshToken: string;
}): Promise<TokenResponse> {
  return tokenRequest({
    grant_type: "refresh_token",
    refresh_token: p.refreshToken,
    client_id: p.clientId,
    ...(p.clientSecret ? { client_secret: p.clientSecret } : {}),
  });
}

/** Best-effort revoke of a token (refresh or access). Never throws. */
export async function revokeToken(token: string): Promise<void> {
  try {
    await fetch(`${REVOKE_ENDPOINT}?token=${encodeURIComponent(token)}`, { method: "POST" });
  } catch {
    /* ignore — revoke is best effort */
  }
}
