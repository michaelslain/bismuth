// A stable macOS code-signing identity, shared by everything Bismuth's build pipeline signs:
// the `tauri` CLI wrapper (scripts/tauri.ts — covers the .app bundle for EVERY `tauri build`
// invocation) and the daemon sidecar binary (build-daemon-sidecar.ts).
//
// Why this matters (bug #48 — "computer permissions are not persistent between Bismuth
// updates"): macOS TCC (the Files-and-Folders / Accessibility / etc. privacy grant database)
// pins each grant to the code's DESIGNATED REQUIREMENT, not the app's bundle id. The default
// ad-hoc signature Tauri applies when no identity is configured anchors that requirement to
// the exact binary's own content hash — `codesign -d -r-` on an ad-hoc build shows
// `designated => cdhash H"…"`. Since every rebuild produces different bytes, every rebuild
// gets a fresh "identity" and macOS silently revokes every grant for both `Bismuth.app` and
// the `bismuth-daemon` service binary.
//
// The fix doesn't require a paid Apple Developer account. A SELF-SIGNED "Code Signing"
// certificate (Keychain Access → Certificate Assistant → Create a Certificate) is NOT
// Apple-trust-chained, but codesign's auto-generated designated requirement for a
// non-Apple-anchored certificate is `anchor = H"<hash of the CERTIFICATE>"` (Apple's own
// "Code Signing Requirement Language" reference documents this exact form for custom
// certificate hierarchies) — an anchor on the reused CERTIFICATE, not the binary. Re-signing
// with the SAME certificate on every rebuild keeps that requirement (and therefore the TCC
// identity) stable, even though the cert itself is self-signed. See
// docs/overview/install.md ("macOS folder permissions surviving updates") for the one-time
// setup + a fuller citation trail, including the caveat that this does NOT grant a Team ID,
// Gatekeeper trust, or notarization — only a real Apple Developer ID gets those.
import { spawnSync } from "node:child_process";

/** APPLE_SIGNING_IDENTITY if the environment carries one, else the first login-keychain
 *  codesigning certificate whose name contains "Bismuth" (the documented one-time self-signed
 *  setup). Null → caller should fall back to the default ad-hoc signature, exactly as before
 *  this existed — opt-in, zero-cost when no cert has been created. */
export function findSigningIdentity(): string | null {
  if (process.platform !== "darwin") return null;
  if (process.env.APPLE_SIGNING_IDENTITY) return process.env.APPLE_SIGNING_IDENTITY;
  const probe = spawnSync("security", ["find-identity", "-v", "-p", "codesigning"], { encoding: "utf8" });
  if (probe.status !== 0) return null;
  const line = (probe.stdout ?? "").split("\n").find((l) => l.includes("Bismuth"));
  return line?.match(/"([^"]+)"/)?.[1] ?? null;
}
