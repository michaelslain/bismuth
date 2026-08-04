// Shared HTTP helper for the CLI command groups that talk to a RUNNING server
// (api.ts, app.ts, gcal.ts, relay.ts, chat.ts). Everything else in the CLI works
// headlessly; these hit live routes and therefore need one small fetch wrapper. Kept
// dependency-light so any server-talking group can import a stable contract.
import { fail } from "./args";
import { readRunRecords } from "../../core/src/runRegistry";

/** Builds the "could not reach" message for a failed connection to `base`. Lets each
 *  caller keep its own wording (e.g. "server" vs "Bismuth app") while sharing `call`. */
export type UnreachableLabel = (base: string) => string;

/** Loopback hostnames a run record's token may ever be attached to. `new URL(...).hostname`
 *  never carries brackets, even for a literal IPv6 host, so "::1" (not "[::1]") is the form
 *  that matches. A `--api`/`BISMUTH_API` pointed anywhere else — a LAN IP, a remote host —
 *  never gets a token attached, even if its port happens to collide with a locally running
 *  core's: this is a per-boot secret for THIS machine's own core and must never leave it. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * The owner token (core/src/ownerToken.ts) for whichever LOCAL core is listening at `base`,
 * or undefined.
 *
 * `base` is always a bare "http://host:port" resolved by the caller (resolveCore()/apiBase()
 * in the command groups) — never a vault path — so the only way to find "this boot's" token
 * is to match the PORT against the run registry (core/src/runRegistry.ts's
 * ~/.bismuth/run/*.json, one record per running core, each carrying the per-boot random token
 * ownerToken.ts mints on startup and server.ts writes into the record). No vault needs
 * threading through call()'s callers: whichever record's port matches `base` is the exact
 * core this request is about to hit.
 *
 * FAILS SAFE, NEVER FABRICATES: a missing run dir, an unreadable/malformed record, a live
 * core whose record predates this feature (no `token` field), or a `base` that doesn't parse
 * as a URL / isn't a loopback host — all resolve to `undefined`. `call()` then sends NO token
 * header at all, and the server's own `requestChannel` 403s exactly as it would for a bare
 * curl with no header. This function must never guess or invent a token: a wrong guess is
 * indistinguishable from a real one to `resolveRequestChannel`'s `===` compare, so "no header"
 * is the only sound fallback — this is what makes the CLI's identity honest rather than a
 * bypass.
 */
function ownerTokenFor(base: string): string | undefined {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return undefined;
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) return undefined;
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  if (!Number.isFinite(port)) return undefined;
  try {
    return readRunRecords().find((r) => r.port === port)?.token;
  } catch {
    // readRunRecords() is already internally tolerant (missing dir / malformed file / no
    // liveness), but this call site must never let a token lookup crash a CLI invocation.
    return undefined;
  }
}

/** Fetch `method base+path` (optional JSON `body`), returning parsed JSON, else the raw
 *  text. Fails (exit non-zero) on a non-2xx response, or with `errLabel(base)` — a caller-
 *  supplied message — when the server is unreachable.
 *
 *  Attaches `X-Bismuth-Token` (core/src/ownerToken.ts) whenever `base` names a local core
 *  this machine's run registry has a token for (see {@link ownerTokenFor}) — the CLI IS the
 *  vault owner's own hand, so it identifies itself as "owner" exactly like the app's frontend
 *  already does via `window.__BISMUTH_OWNER_TOKEN__`, unlocking the owner-only routes
 *  (`GET /chat/sessions` et al.) that were previously unreachable from a shell. This is a
 *  per-call, best-effort identity attach, not a widened server-side trust boundary: it never
 *  fabricates a token and never touches `core/src/server.ts`'s own `requestChannel` checks. */
export async function call(
  base: string,
  method: string,
  path: string,
  body?: unknown,
  errLabel?: UnreachableLabel,
): Promise<unknown> {
  const url = `${base}${path.startsWith("/") ? "" : "/"}${path}`;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  const token = ownerTokenFor(base);
  if (token) headers["x-bismuth-token"] = token;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    return fail(errLabel ? errLabel(base) : `could not reach a running server at ${base} (or pass --api <url>)`);
  }
  const text = await res.text();
  if (!res.ok) fail(`${method} ${path} → ${res.status}: ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
