// app/src/preview/assetUrl.test.ts
import { describe, expect, test } from "bun:test";
import { buildAssetUrl } from "./assetUrl";
import { httpTransport, resolveBase } from "../api";

const BASE = "http://localhost:62617";

describe("buildAssetUrl", () => {
  test("ordinary spaces in a filename encode as %20 (not '+')", () => {
    expect(buildAssetUrl(BASE, "Reading List.md")).toBe(
      "http://localhost:62617/asset?path=Reading%20List.md",
    );
  });

  test("a folder separator is percent-encoded (%2F) so the whole path rides the query param", () => {
    expect(buildAssetUrl(BASE, "attachments/photo.png")).toBe(
      "http://localhost:62617/asset?path=attachments%2Fphoto.png",
    );
  });

  test("macOS screenshot name: NARROW NO-BREAK SPACE (U+202F) before AM encodes as %E2%80%AF", () => {
    // The real on-disk name uses U+202F, not a regular space, before "AM" — the exact file
    // from BUG #38. Under-encoding this byte is what made the preview <img> 404 → blank.
    const name = "attachments/Screenshot 2026-07-07 at 12.49.07 AM.png";
    const url = buildAssetUrl(BASE, name);
    expect(url).toBe(
      "http://localhost:62617/asset?path=attachments%2FScreenshot%202026-07-07%20at%2012.49.07%E2%80%AFAM.png",
    );
    // Round-trips: decoding the query value yields the original path byte-for-byte, so the
    // backend's requireQueryParam + resolveAsset see exactly the on-disk name.
    const decoded = decodeURIComponent(new URL(url).searchParams.get("path")!);
    expect(decoded).toBe(name);
    expect([...decoded].some((c) => c.charCodeAt(0) === 0x202f)).toBe(true);
  });

  test("query-reserved chars (& ? #) in a name are encoded, never split the URL", () => {
    const url = buildAssetUrl(BASE, "Q&A ? notes #1.png");
    expect(url).toBe(
      "http://localhost:62617/asset?path=Q%26A%20%3F%20notes%20%231.png",
    );
    // Exactly one query param named `path`, carrying the whole name.
    const params = new URL(url).searchParams;
    expect([...params.keys()]).toEqual(["path"]);
    expect(params.get("path")).toBe("Q&A ? notes #1.png");
  });

  test("non-ASCII unicode (emoji folder) survives", () => {
    const name = "resources/\u{1F4C1} files/Earthlings.jpg";
    const decoded = decodeURIComponent(
      new URL(buildAssetUrl(BASE, name)).searchParams.get("path")!,
    );
    expect(decoded).toBe(name);
  });

  test("empty base yields a same-origin relative URL", () => {
    expect(buildAssetUrl("", "a b.png")).toBe("/asset?path=a%20b.png");
  });
});

// #38 (bug board, 3rd bounce): the packaged desktop app's preview tab kept showing "Couldn't
// load image" for a macOS-screenshot filename that DID load fine in dev — the standing
// hypothesis was that PreviewView's asset URL resolved its backend base through a DIFFERENT
// path than a note-body/table-cell embed's `api.assetUrl`, so a packaged-app-only signal
// (`window.__BISMUTH_API__`, injected by the Tauri shell, with no `?api=` present) could be
// honored by one and missed by the other. It isn't — PreviewView calls
// `buildAssetUrl(apiBase(), path)`, and `apiBase()` is `transport.base()`, the SAME resolved
// base `api.assetUrl` closes over — but nothing before this locked that equivalence byte-for-
// byte, so a future edit to either builder could silently reintroduce exactly that split. These
// assert `buildAssetUrl` and the transport's `assetUrl` are the same function in every way that
// matters, across every base-resolution source (default port, `?api=`, and the packaged app's
// injected `__BISMUTH_API__`).
describe("buildAssetUrl stays byte-for-byte identical to httpTransport(base).assetUrl", () => {
  const TARGETS = [
    "Reading List.md",
    "attachments/photo.png",
    // The exact #38 repro shape: NARROW NO-BREAK SPACE (U+202F) before AM/PM.
    "attachments/Screenshot 2026-07-07 at 12.49.07 AM.png",
    "Q&A ? notes #1.png",
    "resources/\u{1F4C1} files/Earthlings.jpg",
  ];

  test("identical output for the default port (no ?api=, no injection — plain dev/browser)", () => {
    const base = resolveBase(undefined, undefined);
    for (const target of TARGETS) {
      expect(buildAssetUrl(base, target)).toBe(httpTransport(base).assetUrl(target));
    }
  });

  test("identical output for a `?api=` window (Open Folder / a second backend)", () => {
    const base = resolveBase("?api=http://localhost:54321", undefined);
    for (const target of TARGETS) {
      expect(buildAssetUrl(base, target)).toBe(httpTransport(base).assetUrl(target));
    }
  });

  test("identical output for the packaged app's injected __BISMUTH_API__ (no ?api=, Tauri sidecar port)", () => {
    // Mirrors app/src-tauri/src/lib.rs: `window.__BISMUTH_API__ = "http://localhost:<sidecar port>"`,
    // injected before any app JS runs, with no `?api=` query param present.
    const base = resolveBase(undefined, undefined, "http://localhost:54321");
    expect(base).toBe("http://localhost:54321"); // sanity: the injected port actually won
    for (const target of TARGETS) {
      expect(buildAssetUrl(base, target)).toBe(httpTransport(base).assetUrl(target));
    }
  });
});
