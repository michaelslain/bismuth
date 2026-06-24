// core/test/gcal/gcal.test.ts
// Pure-unit coverage for the Google Calendar OAuth plumbing: PKCE (against the RFC 7636
// test vector), consent-URL building, and the non-vault token state round-trip.
import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVerifier, createState, challengeFromVerifier } from "../../src/gcal/pkce";
import { buildAuthUrl, CALENDAR_SCOPE, AUTH_ENDPOINT } from "../../src/gcal/oauth";
import { readGcalState, writeGcalState, clearGcalState } from "../../src/gcal/state";

test("challengeFromVerifier matches the RFC 7636 Appendix B test vector", async () => {
  // RFC 7636 §B: verifier → S256 challenge.
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const challenge = await challengeFromVerifier(verifier);
  expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

test("createVerifier is a 43-char base64url string within RFC 7636's range", () => {
  const v = createVerifier();
  expect(v.length).toBe(43); // 32 bytes → 43 base64url chars (no padding)
  expect(v.length).toBeGreaterThanOrEqual(43);
  expect(v.length).toBeLessThanOrEqual(128);
  expect(v).toMatch(/^[A-Za-z0-9\-_]+$/); // unreserved / base64url alphabet, no padding
});

test("createVerifier and createState are unique per call", () => {
  expect(createVerifier()).not.toBe(createVerifier());
  expect(createState()).not.toBe(createState());
});

test("buildAuthUrl encodes the PKCE + offline-access consent request", () => {
  const url = new URL(
    buildAuthUrl({
      clientId: "cid.apps.googleusercontent.com",
      redirectUri: "http://127.0.0.1:54321/gcal/callback",
      challenge: "CHALLENGE",
      state: "STATE",
    }),
  );
  expect(`${url.origin}${url.pathname}`).toBe(AUTH_ENDPOINT);
  const p = url.searchParams;
  expect(p.get("client_id")).toBe("cid.apps.googleusercontent.com");
  expect(p.get("redirect_uri")).toBe("http://127.0.0.1:54321/gcal/callback");
  expect(p.get("response_type")).toBe("code");
  expect(p.get("scope")).toBe(CALENDAR_SCOPE);
  expect(p.get("code_challenge")).toBe("CHALLENGE");
  expect(p.get("code_challenge_method")).toBe("S256");
  expect(p.get("state")).toBe("STATE");
  expect(p.get("access_type")).toBe("offline");
  expect(p.get("prompt")).toBe("consent");
});

test("the minimal scope is calendar.events — events only, no broader calendar access", () => {
  expect(CALENDAR_SCOPE).toBe("https://www.googleapis.com/auth/calendar.events");
});

test("state round-trips, merges, persists 0600, and clears (outside the vault)", () => {
  const home = mkdtempSync(join(tmpdir(), "bismuth-gcal-"));
  try {
    expect(readGcalState(home)).toEqual({});

    writeGcalState({ clientId: "cid", clientSecret: "sec" }, home);
    writeGcalState({ refreshToken: "rt", account: "me@example.com" }, home);
    const s = readGcalState(home);
    expect(s.clientId).toBe("cid");
    expect(s.clientSecret).toBe("sec");
    expect(s.refreshToken).toBe("rt");
    expect(s.account).toBe("me@example.com");

    // File must be 0600 (owner-only) — it holds the refresh token.
    const path = join(home, ".bismuth", "gcal", "state.json");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(path, "utf8")).refreshToken).toBe("rt");

    clearGcalState(home);
    expect(readGcalState(home)).toEqual({});
    clearGcalState(home); // idempotent — no throw when already gone
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
