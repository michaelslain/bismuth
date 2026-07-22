// One-off generator: rasterize each Bismuth logo mark (app/public/logos/*.svg)
// into a macOS dock-icon PNG (app/src-tauri/icons/marks/<name>.png).
//
// Each output is the mark centered on a dark rounded "squircle" tile (the
// "Hopper / dark" look), with transparent dock padding around it. The Rust side
// (src-tauri/src/lib.rs) loads the one matching settings.yaml's appearance.icon
// and sets it as the app icon at startup (the only timing that doesn't blank the
// WKWebView — see the dock-icon notes in lib.rs).
//
// Run: cd app && bun run scripts/gen-dock-icons.ts
import { Resvg } from "@resvg/resvg-js";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const logosDir = join(here, "..", "public", "logos");
const outDir = join(here, "..", "src-tauri", "icons", "marks");
mkdirSync(outDir, { recursive: true });

const SIZE = 1024;
const pad = SIZE * 0.098;          // transparent dock padding around the tile
const box = SIZE - pad * 2;        // rounded-square tile
const radius = box * 0.2237;       // Apple's continuous-corner radius
const TILE = "#0D0E16";            // dark tile (the "dark" logo variant)
const art = box * 0.66;            // mark fills the middle, leaving a dark margin
const artPos = pad + (box - art) / 2;
const scale = art / 100;           // logo viewBox is 0 0 100 100

const inner = (svg: string) =>
  svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");

const files = readdirSync(logosDir).filter((f) => f.endsWith(".svg"));
for (const file of files) {
  const name = file.replace(/\.svg$/, "");
  const logo = inner(readFileSync(join(logosDir, file), "utf8"));
  const composite = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">` +
    `<rect x="${pad}" y="${pad}" width="${box}" height="${box}" rx="${radius}" ry="${radius}" fill="${TILE}"/>` +
    `<g transform="translate(${artPos} ${artPos}) scale(${scale})">${logo}</g>` +
    `</svg>`;
  const png = new Resvg(composite, { fitTo: { mode: "width", value: SIZE } }).render().asPng();
  writeFileSync(join(outDir, `${name}.png`), png);
  console.log(`wrote marks/${name}.png (${png.length} bytes)`);
}
console.log(`done: ${files.length} icons`);
