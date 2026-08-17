// bench/visual.ts — deterministic screenshots of the running app, for verifying RENDER changes.
//
// WHY IT DRIVES ITS OWN CHROME. Bismuth's GraphView pauses its rAF loop when the document is
// hidden (`setVisible(props.visible !== false && !docHidden())`). Any browser-automation tab that
// isn't foregrounded reports `visibilityState: "hidden"`, so the graph never paints and every
// screenshot comes back blank — a 0%-inked canvas that looks like a broken renderer. Launching our
// own Chrome with the three --disable-*background* flags gives a live rAF loop with no foreground
// window, so this runs unattended. bench/chromeSession.ts owns that launch and its teardown for every
// tool here; this file is the one that must NOT pass --force-prefers-reduced-motion or freeze the
// clock, because its readiness loop waits for real animation to settle.
//
// DETERMINISM. Idle spin is disabled and each shot waits for the canvas ink to stop changing, so
// two runs of identical code produce comparable images. Without that, every frame differs and
// before/after diffing is meaningless.
//
//   bun bench/visual.ts --base http://localhost:1422 --out shots/
//   bun bench/visual.ts --base http://localhost:1422 --out shots/ --shot graph-2d
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchChrome } from "./chromeSession";

const arg = (n: string, d = "") => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const BASE = arg("base", "http://localhost:1422");
const OUT = arg("out", "shots");
const ONLY = arg("shot", "");
const W = Number(arg("width", "1600")), H = Number(arg("height", "1000"));

/** `n` wheel notches into the 2D field, anchored at its centre — one notch is ZOOM_STEP_PCT (10%),
 *  so `wheelIn(3)` lands on the 70% stop, `wheelIn(4)` on 60%, and so on. Real WheelEvents on the
 *  viewport, not a private camera poke, so this exercises the same path a user does. */
const wheelIn = (n: number) => `(() => {
  const el = document.querySelector('.asc-graph-viewport') || document.querySelector('canvas');
  if (!el) return 'no viewport';
  const r = el.getBoundingClientRect();
  for (let i = 0; i < ${n}; i++) el.dispatchEvent(new WheelEvent('wheel', {
    deltaY: -120, cancelable: true, bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
  }));
  return 'ok';
})()`;

/** The fixed shot list. Same vault, same camera, same settings, every run — so drift is visible.
 *
 *  The zoom stops are not decoration: the field runs a THREE-BAND ladder (backbone.ts `bandsForT`),
 *  and 100% / 70% / 60% / 50% sample it either side of both handovers — masses only, masses with the
 *  glyphs beginning to emerge, mid-crossfade, and the glyph+backbone plateau. A render change that
 *  only breaks one band is invisible in a single fit shot. */
const SHOTS: { name: string; path: string; setup?: string }[] = [
  { name: "graph-2d", path: "/" },
  { name: "graph-2d-70", path: "/", setup: wheelIn(3) },   // t = 0.30 — far band, masses own the field
  { name: "graph-2d-60", path: "/", setup: wheelIn(4) },   // t = 0.40 — inside the mass→glyph crossfade
  { name: "graph-2d-50", path: "/", setup: wheelIn(5) },   // t = 0.50 — mid band plateau: glyphs + backbone
  { name: "graph-2d-deep", path: "/", setup: wheelIn(8) },  // deep near band — real member edges, scoped to the visible clusters
  { name: "graph-3d", path: "/", setup: `document.querySelectorAll('button,[role=button]').forEach(b => { if (b.textContent?.trim() === '3D') b.click(); })` },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Per-canvas ink % and luminance, PLUS the composite of all of them.
 *
 *  Measuring only `querySelector('canvas')` is a trap: the atmosphere is a SEPARATE canvas
 *  composited over the graph with `mix-blend-mode: screen`. A probe that reads just the first
 *  canvas reports byte-identical numbers whether the bloom is off, subtle, or blinding — which is
 *  exactly what happened the first time this was used. `composite` re-blends every canvas the same
 *  way the browser does, so it measures what is actually on screen. */
const INK_PROBE = `(() => {
  const cs = [...document.querySelectorAll('canvas')];
  if (!cs.length) return null;
  // Luminance MUST be alpha-weighted. Reading raw RGB treats a 1%-alpha pixel as fully bright,
  // which inflates every "canvas alone" figure — worst for the mostly-low-alpha bloom canvas — and
  // made the composite read LOWER than the graph canvas it contains, which is impossible for a
  // screen blend. 'ink' likewise means visible coverage, not merely nonzero alpha.
  const stats = (d) => {
    let n = 0, s = 0, lum = 0, lum2 = 0;
    for (let i = 0; i < d.length; i += 4*37) {
      s++;
      const a = d[i+3] / 255;
      if (a > 0.02) n++;
      const L = (0.2126*d[i] + 0.7152*d[i+1] + 0.0722*d[i+2]) * a;
      lum += L; lum2 += L*L;
    }
    const mean = lum/s;
    return { inkPct: +(100*n/s).toFixed(3), lumMean: +mean.toFixed(2),
             lumSd: +Math.sqrt(Math.max(0, lum2/s - mean*mean)).toFixed(2) };
  };
  const per = cs.map((c) => {
    try {
      const d = c.getContext('2d', {willReadFrequently:true}).getImageData(0,0,c.width,c.height).data;
      return { cls: String(c.className) || '(unnamed)', w: c.width, h: c.height, ...stats(d) };
    } catch (e) { return { cls: String(c.className), err: String(e).slice(0,40) }; }
  });
  // Screen-blend every canvas into one buffer at the largest canvas's size.
  const W = Math.max(...cs.map(c => c.width)), H = Math.max(...cs.map(c => c.height));
  const off = document.createElement('canvas'); off.width = W; off.height = H;
  const octx = off.getContext('2d');
  // The opaque black base is REQUIRED for 'screen' to be identity — but it also makes every pixel
  // alpha 255, so the composite's own inkPct is meaningless (it always reads 100). Take luminance
  // from the blend and coverage from the SOURCES: a pixel is inked if any canvas paints it.
  octx.fillStyle = '#000'; octx.fillRect(0, 0, W, H);
  octx.globalCompositeOperation = 'screen';
  for (const c of cs) { try { octx.drawImage(c, 0, 0, W, H); } catch {} }
  const blended = stats(octx.getImageData(0, 0, W, H).data);
  // Union coverage across sources, sampled on the same stride as stats().
  let inked = 0, samples = 0;
  const datas = cs.map((c) => {
    try {
      const s = document.createElement('canvas'); s.width = W; s.height = H;
      const sc = s.getContext('2d'); sc.drawImage(c, 0, 0, W, H);
      return sc.getImageData(0, 0, W, H).data;
    } catch { return null; }
  }).filter(Boolean);
  if (datas.length) {
    for (let i = 0; i < datas[0].length; i += 4*37) {
      samples++;
      for (const d of datas) { if (d[i+3] / 255 > 0.02) { inked++; break; } }
    }
  }
  const comp = { ...blended, inkPct: samples ? +(100*inked/samples).toFixed(3) : 0 };
  return { composite: comp, canvases: per, ...comp };
})()`;

mkdirSync(OUT, { recursive: true });

// Launch + attach + teardown are chromeSession.ts's. This tool used to create its profile dir and never
// remove it — no rmSync anywhere, no exit handler — so every run leaked a full Chrome profile
// permanently; two sibling tools had subtler versions of the same bug. `rpcError` keeps this tool's own
// error format (`<method>: <message>`), which is user-facing output and therefore stays the caller's.
const session = await launchChrome({
  label: "visual", width: W, height: H,
  rpcError: (method, e) => new Error(`${method}: ${e.message}`),
});
const { page } = session;
// deviceScaleFactor 2 is PER-TOOL: these are screenshots meant to be looked at, where the two
// style-reading tools want 1. And no clock freeze here — the ink-settling loop below needs time to
// actually advance.
await page("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 2, mobile: false });

const evalIn = async (expression: string) => {
  const r = await page("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result?.value;
};

const results: any[] = [];
for (const shot of SHOTS) {
  if (ONLY && shot.name !== ONLY) continue;
  await page("Page.navigate", { url: BASE + shot.path });
  await sleep(2500);

  // Kill idle rotation — otherwise no two frames match and diffing is worthless.
  await evalIn(`(() => { try { localStorage.setItem('bismuth-visual-spin','off'); } catch {} })()`);

  if (shot.setup) { await evalIn(shot.setup); await sleep(1200); }

  // Readiness: poll until ink stops moving. A fixed sleep either wastes time or races the layout.
  let prev = -1, stable = 0, probe: any = null;
  for (let i = 0; i < 60 && stable < 3; i++) {
    probe = await evalIn(INK_PROBE);
    const ink = probe?.inkPct ?? -1;
    stable = Math.abs(ink - prev) < 0.01 ? stable + 1 : 0;
    prev = ink;
    await sleep(500);
  }

  const vis = await evalIn(`document.visibilityState`);
  const { data } = await page("Page.captureScreenshot", { format: "png" });
  const file = join(OUT, `${shot.name}.png`);
  writeFileSync(file, Buffer.from(data, "base64"));
  results.push({ shot: shot.name, file, visibility: vis, ...probe, settledAfterPolls: 60 - (60 - stable) });

  if (probe && probe.inkPct < 0.5) console.error(`WARNING ${shot.name}: canvas is ${probe.inkPct}% inked — did it render?`);
}

console.log(JSON.stringify({ base: BASE, viewport: [W, H], shots: results }, null, 1));
session.close();
