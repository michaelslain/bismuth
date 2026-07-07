// app/src/preview/assetUrl.test.ts
import { describe, expect, test } from "bun:test";
import { buildAssetUrl } from "./assetUrl";

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
