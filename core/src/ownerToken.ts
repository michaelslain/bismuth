// core/src/ownerToken.ts
// Closes the unauthenticated HTTP content oracle: core's read routes (GET /file, POST /search,
// POST /rows, …) have always served vault content with no auth at all, which meant any process
// that could run a shell command — including one running INSIDE a correctly tool-gated Claude
// session — could read a `visibility: hidden` note straight back out with `curl`. Every other
// enforcement layer (Claude's managedSettings/sandbox, a future OS wrapper, …) is a lock on a
// door beside this open window.
//
// The fix is a per-boot random token, not a persistent credential: it identifies the vault's own
// app/CLI (the OWNER) so the exact same routes keep working for them, unfiltered, exactly as
// today. Anyone who can't present it is treated as an agent acting on the owner's behalf — chat
// or daemon — and gets the SAME visibility filter that already gates Claude's own tools, so the
// HTTP surface can never see more than the tool-level gate does.
//
// This is still an HONESTY boundary, not a hardened auth system (see docs/vault/visibility.md):
// the token is compared with `===`, not a constant-time compare, and the server still binds to
// every interface Bun.serve does by default. The threat model is "Bismuth's own agent process
// reads more than its tool gate allows" (co-resident on the same machine), not "a remote network
// attacker" — see the module doc in visibility.ts for the full scope.
import { randomBytes } from "node:crypto";
import { runRecordPath } from "./runRegistry";

/** Which caller a request identifies as, resolved by {@link resolveRequestChannel}. */
export type RequestChannel = "owner" | "chat" | "daemon";

const TOKEN_HEADER = "x-bismuth-token";
const CHANNEL_HEADER = "x-bismuth-channel";

/** Mint a fresh random token for one server boot. Never written anywhere but the run record
 *  (see runRegistry.ts's `writeRunRecord`, which the server calls with this value) — held in
 *  memory for the process lifetime, nothing durable, nothing shared across vaults/boots. */
export function mintOwnerToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * PURE. Resolve which channel a request presents as.
 *
 * - The `X-Bismuth-Token` header matching this boot's token, byte for byte → `"owner"`: the
 *   vault's own app/editor/CLI, unfiltered, exactly today's behavior. `token` itself can never be
 *   empty in practice (server.ts always mints one via {@link mintOwnerToken}), but even if it
 *   were, an empty `token` can't match a header (falsy `token` short-circuits to non-owner) — a
 *   misconfigured boot fails CLOSED, never open.
 * - Otherwise, an `X-Bismuth-Channel: chat` header is honored as-is.
 * - Every other case — no header, an unrecognized value, a header-less curl, a malformed
 *   request — resolves to `"daemon"`, the STRICTER of the two non-owner tiers (mirrors the
 *   fail-safe default `mcpChannel()` already uses for the MCP memory tools). An unauthenticated
 *   caller that doesn't or can't identify itself gets the tightest filter, never the loosest.
 *
 * `headers` takes anything with a `.get(name)` method so this stays trivially testable with a
 * plain `Map`/`Headers`/`Request` — no DOM/Bun dependency, and safe to import from the browser
 * bundle if ever needed.
 */
export function resolveRequestChannel(headers: Pick<Headers, "get">, token: string): RequestChannel {
  const presented = headers.get(TOKEN_HEADER);
  if (token && presented === token) return "owner";
  return headers.get(CHANNEL_HEADER) === "chat" ? "chat" : "daemon";
}

/**
 * The path of the run-record file that carries this boot's token (see runRegistry.ts). If an
 * agent process could read this file, the token is a trivially readable master key that defeats
 * every other layer — so it MUST be folded into every channel's deny plan alongside `.git`
 * (visibility.ts's `sandboxDenyRead` already appends `.git` for the identical reason).
 *
 * NOTE FOR INTEGRATOR (core/src/visibility.ts is owned by a concurrent task on this branch, so
 * this repo does not wire it in directly): add `ownerTokenDenyPath(vault)`'s result to
 * `sandboxDenyRead`'s (or `DenyPlan.ownerTokenFile`'s) output for every channel, unconditionally
 * — even when nothing else is restricted, because the token file exists the moment the server
 * boots, independent of whether the vault has any `visibility:` settings.
 */
export function ownerTokenDenyPath(vault: string): string {
  return runRecordPath(vault);
}
