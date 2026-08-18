// core/src/heic.ts
// HEIC/HEIF → JPEG transcoding, so a photo dragged out of Finder is usable downstream.
//
// Why the backend and not the webview: WebKit can decode HEIC natively, but Chromium cannot —
// doing it in-page would work in the packaged macOS app and silently fail in the browser dev
// build (and on every Windows/Linux build). One backend implementation keeps every surface
// behaving identically.
//
// Two engines, same output:
//  • `sips` (macOS, /usr/bin/sips) — a system tool, no dependency, ~10× faster on a real
//    12-megapixel phone photo than the wasm decoder. Tried first when present.
//  • `heic-convert` (pure JS: libheif wasm + jpeg-js) — the portable path. Used on
//    Windows/Linux, and as the fallback whenever sips is absent OR errors, so a macOS box with
//    a broken/sandboxed sips still converts rather than failing the drop.

// heic-convert ships no types. The triple-slash reference (rather than relying on the workspace
// tsconfig picking the .d.ts up) is load-bearing: `app`'s tsc compiles core sources reached
// through imports but does NOT include core's own tsconfig, so without this the app workspace
// fails to typecheck on a module only core ever imports.
/// <reference path="./heic-convert.d.ts" />

import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppError } from "./error";

const SIPS_BIN = "/usr/bin/sips";

/** HEIC by file name. Both Apple extensions; `.heif` is the same container. */
export function isHeicName(name: string): boolean {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf(".");
  if (dot < 0) return false;
  const ext = base.slice(dot + 1).toLowerCase();
  return ext === "heic" || ext === "heif";
}

/** `photo.heic` → `photo.jpg`. Keeps any directory prefix and leaves a non-HEIC name alone, so
 *  callers can name the converted output without re-deriving the basename. */
export function jpegNameFor(name: string): string {
  if (!isHeicName(name)) return name;
  return name.slice(0, name.lastIndexOf(".")) + ".jpg";
}

/** True when the bytes are an ISO-BMFF HEIC/HEIF: a `ftyp` box at offset 4 whose major brand is
 *  one of the HEIF brands. Cheap pre-flight so obviously-wrong input fails as a 400 with a clear
 *  message instead of surfacing a wasm decoder's internal error. */
export function looksLikeHeic(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const ascii = (from: number, to: number): string =>
    String.fromCharCode(...bytes.slice(from, to)).toLowerCase();
  if (ascii(4, 8) !== "ftyp") return false;
  // Major brand + the compatible-brands list that follows it, capped so a huge ftyp box can't
  // turn this guard into a scan of the whole file.
  const brands = ascii(8, Math.min(bytes.length, 64));
  return /heic|heix|heim|heis|hevc|hevx|mif1|msf1/.test(brands);
}

/** Convert via macOS `sips`. Returns null (rather than throwing) on ANY failure so the caller
 *  falls through to the portable engine — a missing/sandboxed sips must degrade, not break. */
async function convertWithSips(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (process.platform !== "darwin" || !existsSync(SIPS_BIN)) return null;
  let dir: string | undefined;
  try {
    dir = await mkdtemp(join(tmpdir(), "bismuth-heic-"));
    const src = join(dir, "in.heic");
    const dst = join(dir, "out.jpg");
    await writeFile(src, bytes);
    const proc = Bun.spawn([SIPS_BIN, "-s", "format", "jpeg", src, "--out", dst], {
      stdout: "ignore",
      stderr: "ignore",
    });
    if ((await proc.exited) !== 0) return null;
    const out = await readFile(dst);
    // A zero-byte result is a silent sips failure; treat it as "didn't convert".
    return out.byteLength > 0 ? new Uint8Array(out) : null;
  } catch {
    return null;
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Convert via the portable wasm decoder. Throws on undecodable input. */
async function convertWithLib(bytes: Uint8Array): Promise<Uint8Array> {
  // CJS module with no bundled types — imported dynamically so the wasm decoder is only paid
  // for when a HEIC actually arrives (it is otherwise dead weight in every server boot).
  const mod = (await import("heic-convert")) as unknown as {
    default?: HeicConvert;
  } & HeicConvert;
  const convert = mod.default ?? mod;
  const out = await convert({ buffer: bytes, format: "JPEG", quality: 0.92 });
  return new Uint8Array(out);
}

type HeicConvert = (opts: {
  buffer: Uint8Array;
  format: "JPEG" | "PNG";
  quality?: number;
}) => Promise<Uint8Array>;

/**
 * Transcode HEIC/HEIF bytes to JPEG. Prefers `sips`, falls back to the portable decoder.
 * Throws `AppError("HEIC_DECODE_ERROR", …, 400)` when the input isn't decodable by either.
 */
export async function convertHeicToJpeg(bytes: Uint8Array): Promise<Uint8Array> {
  if (!looksLikeHeic(bytes)) {
    throw new AppError("HEIC_DECODE_ERROR", "not a HEIC/HEIF image", 400);
  }
  const viaSips = await convertWithSips(bytes);
  if (viaSips) return viaSips;
  try {
    return await convertWithLib(bytes);
  } catch (e) {
    throw new AppError("HEIC_DECODE_ERROR", `couldn't decode HEIC: ${(e as Error).message}`, 400);
  }
}
