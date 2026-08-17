// app/scripts/build-icon-font.ts
//
// Generates `app/src/assets/fonts/symbols-nerd-font-mono.woff2` — the subset icon font behind
// `<Icon>` — plus the vendored upstream LICENSE and a provenance manifest.
//
//   cd app && bun run icons:font
//
// WHY A SEPARATE ICON FONT RATHER THAN A PATCHED MONASPACE. The obvious reading of "switch to Nerd
// Fonts" is to swap the five Monaspace families for their patched ("Monaspice") builds. That would
// mean vendoring 15 font files, dropping @fontsource for all of them, and changing how every
// character of TEXT in the app rasterizes — the largest possible blast radius for a change that is
// only about icons. Symbols Nerd Font Mono carries the symbols ALONE, so text stays byte-identical
// and the whole migration is reversible by deleting one @font-face. The **Mono** variant is the
// right one: every glyph is exactly one cell wide, which is precisely the invariant
// `app/src/icons/Icon.tsx` already promises its ~100 call sites.
//
// WHY SUBSET, AND WHY THE LIST IS NEVER WRITTEN DOWN HERE. The upstream Mono TTF is 2.5 MB of
// symbols; this app uses ~124 of its 10,995 glyphs, and the subset is ~11 KB. The codepoints come
// from the app's own icon mapping (see resolveCodepointSource below) and NEVER from a list typed
// into this file: a second copy of the list is a copy that drifts, and the failure mode of drift is
// an icon that silently renders as TOFU — a placeholder box with an ordinary width and height that
// no screenshot review and no typecheck would ever question. Adding an icon later is a re-run of
// this script, not a manual font edit.
//
// WHY IT SELF-CHECKS BEFORE WRITING. hb-subset does not fail when asked for a codepoint the source
// font does not have; it just omits it, and the result is a valid font that renders that icon as
// tofu. So the produced woff2 is parsed back (iconFontTables.ts) and every requested codepoint is
// confirmed to map to a glyph id other than 0 — glyph 0 being `.notdef` by OpenType definition. If
// any codepoint came back as `.notdef`, nothing is written and the script exits non-zero.
//
// WHY NOT `fonttools`. The plan specified `pip install fonttools brotli`. Overridden: this is a Bun
// monorepo with no Python toolchain, and requiring one to regenerate a committed asset makes the
// asset un-regenerable in practice. `subset-font` (harfbuzz via wasm, emits woff2 directly) is a
// devDependency of this workspace and needs nothing outside `bun install`.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import subsetFont from "subset-font";
import { checkGlyphs } from "./iconFontTables";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "..");
const REPO = join(APP, "..");
const OUT_DIR = join(APP, "src", "assets", "fonts");
const CACHE = join(APP, "node_modules", ".cache", "bismuth-icon-font");

/** The @font-face family name. Also the internal family of the upstream font, but what matters is
 *  that this string matches `--icon-font-stack` in app/src/styles/tokens.css. */
export const FAMILY = "Symbols Nerd Font Mono";
const OUT_FONT = "symbols-nerd-font-mono.woff2";
const OUT_LICENSE = "LICENSE-nerd-fonts.txt";
const OUT_MANIFEST = "symbols-nerd-font-mono.json";

/** PINNED, not "latest". A floating release would re-glyph icons under a `bun install` — Nerd Fonts
 *  does redraw Material Design glyphs between majors — and the diff would land in a binary blob
 *  nobody can read in review. Bump this deliberately, re-run, and look at the gallery. */
const RELEASE = "v3.5.0";
const ASSET = "NerdFontsSymbolsOnly.zip";
const MEMBER = "SymbolsNerdFontMono-Regular.ttf";
const ZIP_URL = `https://github.com/ryanoasis/nerd-fonts/releases/download/${RELEASE}/${ASSET}`;
/** sha256 of `MEMBER` inside the pinned release. A vendored binary that arrives over the network
 *  gets its identity checked, or "pinned version" means only "pinned URL". */
const MEMBER_SHA256 = "2dc316f2505a0cbfbcf6060a1b4ba85b0a2974189e30c0037cdedc436a25a4ff";

const hex = (cp: number) => cp.toString(16).padStart(4, "0");

// ── zip reading ───────────────────────────────────────────────────────────────────────────────
// Read via the CENTRAL DIRECTORY, not the local file headers: a local header is allowed to carry
// zeroed sizes with the real ones in a trailing data descriptor, so a local-header reader works on
// most zips and silently extracts nothing from the rest.
function unzipMembers(zip: Buffer, wanted: string[]): Map<string, Buffer> {
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0 && eocd < 0; i--) if (zip.readUInt32LE(i) === 0x06054b50) eocd = i;
  if (eocd < 0) throw new Error("not a zip: no end-of-central-directory record");
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error(`zip central directory entry ${i} is malformed`);
    const method = zip.readUInt16LE(p + 10);
    const compSize = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const localAt = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nameLen).toString("latin1");
    if (wanted.includes(name)) {
      // The local header's own name/extra lengths, not the central directory's — they differ.
      const dataAt = localAt + 30 + zip.readUInt16LE(localAt + 26) + zip.readUInt16LE(localAt + 28);
      const raw = zip.subarray(dataAt, dataAt + compSize);
      if (method === 0) out.set(name, Buffer.from(raw));
      else if (method === 8) out.set(name, inflateRawSync(raw));
      else throw new Error(`zip member ${name}: unsupported compression method ${method}`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  const missing = wanted.filter((w) => !out.has(w));
  if (missing.length) throw new Error(`zip is missing ${missing.join(", ")} — has the release layout changed?`);
  return out;
}

// ── the codepoint list ────────────────────────────────────────────────────────────────────────
/**
 * Where the codepoints come from, in precedence order.
 *
 *   1. `app/src/icons/nerdGlyphs.ts` — the committed name -> codepoint map (plan Task 2). Once it
 *      exists it is the ONLY correct input, because it is the list the app actually renders from
 *      and therefore the only list that can drift away from the font.
 *   2. `.claude/icon-nerdfont-map.json` — the provisional mapping the migration was derived from.
 *      It is scratch and `.claude/` is GITIGNORED, so this branch cannot survive a fresh clone;
 *      it exists only so the font is generatable before Task 2 lands. When it is the source, the
 *      run says so, loudly.
 *
 * The nerdGlyphs.ts reader takes EVERY codepoint the module exports, not just a named constant:
 * objects of name -> number become the coverage map, and any bare exported number (FALLBACK_CODEPOINT)
 * is subset too. That generalization is load-bearing rather than tidy — the fallback glyph is the
 * one drawn when a name does NOT resolve, so leaving it out of the font makes an unresolved icon
 * render as nothing, which is the exact failure the fallback exists to make visible.
 */
async function resolveCodepointSource(): Promise<{
  label: string;
  byName: Map<string, number>;
  extra: Map<string, number>;
}> {
  const tsPath = join(APP, "src", "icons", "nerdGlyphs.ts");
  if (existsSync(tsPath)) {
    const mod: Record<string, unknown> = await import(tsPath);
    let byName: Map<string, number> | null = null;
    let mapExport = "";
    const extra = new Map<string, number>();
    for (const [exportName, value] of Object.entries(mod)) {
      if (typeof value === "number") { extra.set(exportName, value); continue; }
      if (!value || typeof value !== "object") continue;
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length > 0 && entries.every(([, v]) => typeof v === "number")) {
        // Largest wins, so a small auxiliary record can never be mistaken for the main map.
        if (!byName || entries.length > byName.size) {
          byName = new Map(entries as [string, number][]);
          mapExport = exportName;
        }
      }
    }
    if (!byName) throw new Error(`${tsPath} exports no object of name -> codepoint numbers`);
    return { label: `app/src/icons/nerdGlyphs.ts (export ${mapExport})`, byName, extra };
  }

  const jsonPath = join(REPO, ".claude", "icon-nerdfont-map.json");
  if (existsSync(jsonPath)) {
    const raw = JSON.parse(readFileSync(jsonPath, "utf8")) as Record<string, { code: string }>;
    const byName = new Map<string, number>();
    for (const [name, entry] of Object.entries(raw)) {
      const cp = parseInt(entry.code, 16);
      if (!Number.isFinite(cp) || cp <= 0) throw new Error(`${name}: bad codepoint ${JSON.stringify(entry.code)}`);
      byName.set(name, cp);
    }
    return { label: ".claude/icon-nerdfont-map.json", byName, extra: new Map() };
  }

  throw new Error(
    "no codepoint source found. Expected app/src/icons/nerdGlyphs.ts (plan Task 2) or, before it " +
      "lands, .claude/icon-nerdfont-map.json.",
  );
}

/**
 * Which of the registry's icon names the codepoint source does NOT cover, split by whether the name
 * is an alias of a name that IS covered.
 *
 * This is not decoration. A name with no codepoint renders as tofu the moment Task 3 switches
 * `<Icon>` over, and the ALIAS half is the benign case — `File` shares `FileText`'s drawing today,
 * so pointing it at the same codepoint is mechanical. The `noMapping` half is real missing design
 * work, and it goes into the manifest so it is a committed, reviewable number rather than console
 * output that scrolls past.
 */
async function coverage(byName: Map<string, number>) {
  const registry: {
    iconNames: () => string[];
    resolveIcon: (s: string) => unknown;
  } = await import(join(APP, "src", "icons", "registry.ts"));
  const names = registry.iconNames();
  const art = (n: string) => JSON.stringify(registry.resolveIcon(n));
  const unmapped = names.filter((n) => !byName.has(n));
  const aliasOfMapped: string[] = [];
  const noMapping: string[] = [];
  for (const n of unmapped) {
    const twin = names.find((o) => o !== n && byName.has(o) && art(o) === art(n));
    (twin ? aliasOfMapped : noMapping).push(n);
  }
  return { registryNames: names.length, aliasOfMapped, noMapping };
}

// ── run ───────────────────────────────────────────────────────────────────────────────────────
const { label, byName, extra } = await resolveCodepointSource();
const codepoints = [...new Set([...byName.values(), ...extra.values()])].sort((a, b) => a - b);
console.log(`codepoint source: ${label}`);
console.log(`  ${byName.size} icon name(s) + ${extra.size} standalone codepoint(s) -> ${codepoints.length} distinct codepoint(s)`);
for (const [name, cp] of extra) console.log(`  standalone: ${name} = U+${hex(cp).toUpperCase()}`);

const cov = await coverage(byName);
console.log(`registry coverage: ${cov.registryNames - cov.aliasOfMapped.length - cov.noMapping.length}/${cov.registryNames} names mapped`);
if (cov.aliasOfMapped.length) {
  console.log(`  ${cov.aliasOfMapped.length} unmapped ALIAS of a mapped name (share its codepoint): ${cov.aliasOfMapped.join(", ")}`);
}
if (cov.noMapping.length) {
  console.log(`  ${cov.noMapping.length} with NO mapping at all — these WILL be tofu once <Icon> switches over:`);
  console.log(`    ${cov.noMapping.join(", ")}`);
}

mkdirSync(CACHE, { recursive: true });
const zipPath = join(CACHE, `${ASSET.replace(/\.zip$/, "")}-${RELEASE}.zip`);
if (!existsSync(zipPath)) {
  console.log(`downloading ${ZIP_URL}`);
  const res = await fetch(ZIP_URL);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status} ${res.statusText}`);
  writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
}
const members = unzipMembers(readFileSync(zipPath), [MEMBER, "LICENSE"]);
const ttf = members.get(MEMBER)!;
const sha = createHash("sha256").update(ttf).digest("hex");
if (sha !== MEMBER_SHA256) {
  throw new Error(
    `${MEMBER} sha256 is ${sha}, expected ${MEMBER_SHA256}. The pinned release changed under us — ` +
      `verify the source and update MEMBER_SHA256 deliberately.`,
  );
}

const woff2 = await subsetFont(ttf, codepoints.map((cp) => String.fromCodePoint(cp)).join(""), {
  targetFormat: "woff2",
});

// The self-check described in the header. Runs BEFORE anything is written, so a bad subset never
// reaches the tree.
const check = checkGlyphs(new Uint8Array(woff2), codepoints);
const tofu = check.results.filter((r) => r.tofu);
if (tofu.length) {
  console.error(`\nREFUSING TO WRITE: ${tofu.length} of ${codepoints.length} requested codepoint(s) came back as`);
  console.error(`.notdef (glyph 0) — they are NOT in ${MEMBER} and would render as tofu boxes:`);
  for (const r of tofu) console.error(`  U+${hex(r.codepoint).toUpperCase()}`);
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, OUT_FONT), woff2);
writeFileSync(join(OUT_DIR, OUT_LICENSE), members.get("LICENSE")!);
writeFileSync(
  join(OUT_DIR, OUT_MANIFEST),
  `${JSON.stringify(
    {
      $comment:
        "GENERATED by app/scripts/build-icon-font.ts — do not edit. Provenance for the sibling " +
        "woff2, which is a binary blob nothing else in the tree can describe. `codepoints` is what " +
        "the font was built to contain; app/src/icons/iconFont.test.ts asserts every one of them " +
        "resolves to a real glyph rather than .notdef.",
      family: FAMILY,
      file: OUT_FONT,
      bytes: woff2.length,
      unitsPerEm: check.unitsPerEm,
      // Recorded because it is the trap: `.notdef` in this font is a FULL-WIDTH box, so its advance
      // equals every real glyph's. Any check that separates tofu from art by measuring WIDTH is
      // measuring nothing here — the glyph id is the only signal.
      notdefAdvance: check.notdefAdvance,
      upstream: { repo: "https://github.com/ryanoasis/nerd-fonts", release: RELEASE, asset: ASSET, member: MEMBER, sha256: MEMBER_SHA256 },
      codepointSource: label,
      codepoints: codepoints.map(hex),
      unmappedIconNames: { aliasOfMapped: cov.aliasOfMapped, noMapping: cov.noMapping },
    },
    null,
    2,
  )}\n`,
);

console.log(`\nwrote src/assets/fonts/${OUT_FONT} (${woff2.length} bytes, ${(woff2.length / 1024).toFixed(1)} KB)`);
console.log(`  ${codepoints.length} glyph(s) requested, ${codepoints.length} present, 0 tofu`);
console.log(`  cmap maps ${check.mappedCodepoints} codepoint(s); unitsPerEm ${check.unitsPerEm}, .notdef advance ${check.notdefAdvance}`);
console.log(`wrote src/assets/fonts/${OUT_LICENSE} + ${OUT_MANIFEST}`);
