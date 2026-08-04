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
import { realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";
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
 * every other layer — so it is folded into every channel's deny plan alongside `.git`
 * (visibility.ts's `sandboxDenyRead` appends `.git` for the identical reason).
 *
 * WIRING, as it now stands. `visibility.ts`'s {@link buildSandboxDenyPaths} is the single
 * composition point, and all three agent spawns resolve their read-deny list from it:
 * `chat.ts`'s `buildChatSandboxOption`, `daemon/src/daemon/session.ts`'s `buildQueryOptions` (via
 * that workspace's ported mirror — the daemon cannot import `@bismuth/core`; a parity test in
 * `core/test/ownerToken.test.ts` pins the two path computations together), and
 * `agentBackends/sandboxWrapper.ts` for the non-Claude backends. No agent spawn composes a
 * deny-read list any other way.
 *
 * It rides the `entries.length > 0` gate, NOT unconditionally, because there is nowhere else for
 * it to ride: an unrestricted vault is spawned with no sandbox option at all, so a token path
 * emitted for it would be discarded, and an unrestricted vault has nothing for the token to
 * expose that a tokenless caller cannot already read.
 *
 * `managedSettings.permissions.deny` (buildManagedSettingsDeny) deliberately does NOT carry the
 * token. That layer constrains the Read/Edit/Grep/Glob tool CALLING CONVENTION and is blind to a
 * Bash `cat`; the OS sandbox is what actually stops the read, and it is enabled with
 * `failIfUnavailable: true` (sandboxFailIfUnavailable) whenever the token deny applies, so there
 * is no configuration in which the token is denied by one layer only.
 */
export function ownerTokenDenyPath(vault: string): string {
  return runRecordPath(vault);
}

/**
 * Every absolute spelling of {@link ownerTokenDenyPath} — the form a deny list takes, mirroring
 * `DenyEntry.aliases`/`absForms` in visibility.ts.
 *
 * A deny path that names a file through a symlink is a SILENT NO-OP. Seatbelt resolves symlinks
 * before matching, so `(deny file-read* (subpath "/var/folders/…/rec.json"))` does not stop
 * `cat /var/folders/…/rec.json` when `/var` is a symlink to `/private/var`; only the canonical
 * spelling of the same path denies it. This is the same
 * hazard `walkDenyEntries` already canonicalizes the vault root against, and it reaches the run
 * record through both supported spellings of its directory: `BISMUTH_RUN_DIR`, and a `homedir()`
 * that is itself behind a link. Both forms are emitted rather than the canonical one alone, so a
 * caller comparing strings (rather than opening files) still recognizes the path it was given.
 */
export function ownerTokenDenyPaths(vault: string): string[] {
  const raw = ownerTokenDenyPath(vault);
  const canonical = canonicalizeRecordPath(raw);
  return canonical === raw ? [raw] : [raw, canonical];
}

/** `raw` with symlinks resolved, or `raw` unchanged when it cannot be resolved. Falls back to
 *  resolving the DIRECTORY when the record file itself is absent (a core that has not booted yet,
 *  or one that already exited): the directory is what carries the `/var` → `/private/var` class of
 *  link, so its canonical form plus the untouched basename is the same answer. */
function canonicalizeRecordPath(raw: string): string {
  try {
    return realpathSync(raw);
  } catch {
    try {
      return join(realpathSync(dirname(raw)), basename(raw));
    } catch {
      return raw;
    }
  }
}
