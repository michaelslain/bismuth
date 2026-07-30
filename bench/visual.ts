// bench/visual.ts — deterministic screenshots of the running app, for verifying RENDER changes.
//
// WHY IT DRIVES ITS OWN CHROME. Bismuth's GraphView pauses its rAF loop when the document is
// hidden (`setVisible(props.visible !== false && !docHidden())`). Any browser-automation tab that
// isn't foregrounded reports `visibilityState: "hidden"`, so the graph never paints and every
// screenshot comes back blank — a 0%-inked canvas that looks like a broken renderer. Launching our
// own Chrome with the three --disable-*background* flags below gives a live rAF loop with no
// foreground window, so this runs unattended.
//
// DETERMINISM. Idle spin is disabled and each shot waits for the canvas ink to stop changing, so
// two runs of identical code produce comparable images. Without that, every frame differs and
// before/after diffing is meaningless.
//
//   bun bench/visual.ts --base http://localhost:1422 --out shots/
//   bun bench/visual.ts --base http://localhost:1422 --out shots/ --shot graph-2d
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const arg = (n: string, d = "") => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const BASE = arg("base", "http://localhost:1422");
const OUT = arg("out", "shots");
const ONLY = arg("shot", "");
const W = Number(arg("width", "1600")), H = Number(arg("height", "1000"));

/** The fixed shot list. Same vault, same camera, same settings, every run — so drift is visible. */
const SHOTS: { name: string; path: string; setup?: string }[] = [
  { name: "graph-2d", path: "/" },
  { name: "graph-3d", path: "/", setup: `document.querySelectorAll('button,[role=button]').forEach(b => { if (b.textContent?.trim() === '3D') b.click(); })` },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let nextId = 1;

function rpc(ws: WebSocket, sessionId?: string) {
  const pending = new Map<number, (v: any) => void>();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(String(ev.data));
    if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); }
  });
  return (method: string, params: any = {}) =>
    new Promise<any>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
      ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    });
}

/** Ink %, mean luminance and its spread — enough to catch "blank", "too dense", "no bloom". */
const INK_PROBE = `(() => {
  const c = document.querySelector('canvas');
  if (!c) return null;
  const d = c.getContext('2d', {willReadFrequently:true}).getImageData(0,0,c.width,c.height).data;
  let n = 0, s = 0, lum = 0, lum2 = 0;
  for (let i = 0; i < d.length; i += 4*37) {
    s++;
    if (d[i+3] !== 0) n++;
    const L = 0.2126*d[i] + 0.7152*d[i+1] + 0.0722*d[i+2];
    lum += L; lum2 += L*L;
  }
  const mean = lum/s;
  return { inkPct: +(100*n/s).toFixed(3), lumMean: +mean.toFixed(2),
           lumSd: +Math.sqrt(Math.max(0, lum2/s - mean*mean)).toFixed(2) };
})()`;

mkdirSync(OUT, { recursive: true });
const port = 9600 + Math.floor(Math.random() * 300);
const profile = mkdtempSync(join(tmpdir(), "bismuth-visual-"));
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  `--window-size=${W},${H}`, "--hide-scrollbars",
  "--no-first-run", "--no-default-browser-check", "--disable-extensions", "about:blank",
], { stdio: "ignore" });

let wsUrl = "";
for (let i = 0; i < 100 && !wsUrl; i++) {
  try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) wsUrl = (await r.json()).webSocketDebuggerUrl; } catch {}
  if (!wsUrl) await sleep(100);
}
if (!wsUrl) { chrome.kill(); throw new Error("chrome debugger port never opened"); }

const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
const browser = rpc(ws);
const { targetId } = await browser("Target.createTarget", { url: "about:blank" });
const { sessionId } = await browser("Target.attachToTarget", { targetId, flatten: true });
const page = rpc(ws, sessionId);
await page("Page.enable");
await page("Runtime.enable");
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
ws.close();
chrome.kill();
