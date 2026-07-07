// app/src/preview/assetUrl.ts
// Pure builder for a vault media file's `src`-able URL (GET /asset, resolved filename-first
// by the backend). Mirrors the transport's asset URL format (app/src/api.ts
// httpTransport.assetUrl) but kept pure + framework-free so the exact percent-encoding is
// locked by a unit test — the thing that makes a macOS-screenshot filename load in a preview
// tab: those names embed a NARROW NO-BREAK SPACE (U+202F) before "AM"/"PM"
// (…12.49.07 AM.png), plus ordinary spaces and a `/` folder separator, all of which must
// survive as query-safe bytes so `resolveAsset` finds the file (an under-encoded `src` 404s →
// a blank image).

/** `${base}/asset?path=<encoded>` — `encodeURIComponent` percent-encodes spaces (`%20`),
 *  U+202F (`%E2%80%AF`), `/` (`%2F`), `&`/`?`/`#` and other reserved chars so the whole
 *  vault-relative path rides in the `path` query param intact. `base` may be an absolute
 *  origin (`http://localhost:62617`) or "" for a same-origin relative URL. */
export function buildAssetUrl(base: string, target: string): string {
  return `${base}/asset?path=${encodeURIComponent(target)}`;
}
