// core/src/gcal/pkce.ts
// PKCE (RFC 7636) helpers for the Google OAuth "Authorization Code + PKCE" flow used
// by the desktop/installed client (RFC 8252). Pure + unit-tested: a random verifier and
// CSRF `state` from the platform CSPRNG, and the S256 challenge via SHA-256. No secrets
// here — the verifier is generated per auth attempt and never persisted.

/** base64url-encode raw bytes (no padding), per RFC 7636 §A. */
function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

/** N cryptographically-random bytes from the platform CSPRNG. */
function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

/**
 * A `code_verifier`: a 43-char base64url string (32 random bytes), comfortably inside
 * RFC 7636's required 43–128 character range and using only the unreserved alphabet.
 */
export function createVerifier(): string {
  return base64url(randomBytes(32));
}

/** An opaque CSRF `state` value; also used to key the pending verifier on our side. */
export function createState(): string {
  return base64url(randomBytes(16));
}

/** The S256 `code_challenge` = base64url(SHA-256(verifier)). */
export async function challengeFromVerifier(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}
