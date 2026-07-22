// Shared HTTP helper for the CLI command groups that talk to a RUNNING server
// (api.ts, app.ts). Everything else in the CLI works headlessly; these hit live
// routes and therefore need one small fetch wrapper. Kept dependency-light so any
// server-talking group can import a stable contract.
import { fail } from "./args";

/** Builds the "could not reach" message for a failed connection to `base`. Lets each
 *  caller keep its own wording (e.g. "server" vs "Bismuth app") while sharing `call`. */
export type UnreachableLabel = (base: string) => string;

/** Fetch `method base+path` (optional JSON `body`), returning parsed JSON, else the raw
 *  text. Fails (exit non-zero) on a non-2xx response, or with `errLabel(base)` — a caller-
 *  supplied message — when the server is unreachable. */
export async function call(
  base: string,
  method: string,
  path: string,
  body?: unknown,
  errLabel?: UnreachableLabel,
): Promise<unknown> {
  const url = `${base}${path.startsWith("/") ? "" : "/"}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { "content-type": "application/json" } : undefined,
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
