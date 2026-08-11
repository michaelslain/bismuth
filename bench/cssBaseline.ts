// bench/cssBaseline.ts — computed-style baseline for every Storybook story.
//
// WHY THIS EXISTS. Moving ~330 rules out of a global stylesheet into CSS Modules is a refactor
// whose whole promise is "nothing changed visually". Eyeballing 239 stories cannot establish that,
// and a typecheck cannot see CSS at all. This records what the browser ACTUALLY resolved for every
// element in every story, so a migration either diffs to zero or names exactly what it broke.
//
// WHY IT DRIVES ITS OWN CHROME: same reason as bench/visual.ts — a background automation tab
// reports visibilityState "hidden" and rAF-gated components never paint. The three
// --disable-*background* flags below keep the loop live with no foreground window.
//
// DETERMINISM. Two things would otherwise make consecutive runs disagree, and a flaky gate is worse
// than no gate because it trains the next reader to ignore it:
//   1. Keyframe animations. The design system has a blinking caret (.asc-caret animates opacity) and
//      the wordmark sheen (animates background-position). Sampling mid-flight returns a different
//      number every run. Inject `animation: none` before reading. TRANSITIONS are deliberately left
//      alone — a transition's computed duration is static and worth diffing.
//   2. Webfonts. Monaspace loads async; measuring before it lands records fallback-font metrics.
//      Await document.fonts.ready.
//
//   cd app && bun run storybook          # in another shell
//   bun bench/cssBaseline.ts --update    # record
//   bun bench/cssBaseline.ts             # check (exit 1 on drift)
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const arg = (n: string, d = "") => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const has = (n: string) => process.argv.includes(`--${n}`);
const BASE = arg("base", "http://localhost:6006");
const ONLY = arg("story", "");
// 700ms was the original default and is enough for most stories, but app-sheetview--default (Univer,
// a heavy canvas-backed spreadsheet widget) applies its toolbar icon theming asynchronously and had
// not finished by 700ms — captured colors drifted a few rgb units between runs (e.g.
// rgb(49,52,63) -> rgb(51,54,65)) purely from real-world timing, not from a missed `animation: none`.
// Confirmed by isolating that one story at --settle 1500/3000: both stable across repeated runs, so
// this is genuine async settling, not flicker the animation-kill should have caught. A full 240-story
// run at 1500ms still produced one single-property flake elsewhere (app-chatview--empty, a 1-2px
// top/height jitter) that did not reproduce in isolation, consistent with settle margin shrinking
// under full-suite CPU load rather than that story being inherently non-deterministic — so the
// default carries extra headroom over the isolated-story minimum.
const SETTLE = Number(arg("settle", "2000"));
const UPDATE = has("update");
const OUT = join(import.meta.dir, "css-baseline.json");
const W = 1280, H = 900;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The properties worth tracking. Deliberately NOT every property: the full computed set is ~340
 *  properties per element, which makes the baseline enormous and full of values no CSS in this repo
 *  ever sets. These are the ones this codebase's rules actually control. */
const PROPS = [
  "display","position","top","right","bottom","left","z-index","overflow-x","overflow-y",
  "width","height","min-width","min-height","max-width","max-height",
  "margin-top","margin-right","margin-bottom","margin-left",
  "padding-top","padding-right","padding-bottom","padding-left",
  "flex-direction","flex-wrap","flex-grow","flex-shrink","flex-basis","align-items","justify-content","gap",
  "grid-template-columns","grid-template-rows",
  "font-family","font-size","font-weight","font-style","line-height","letter-spacing","text-transform",
  "text-align","text-decoration-line","white-space","text-overflow","font-variant-numeric",
  "color","background-color","background-image","opacity","visibility",
  "border-top-width","border-right-width","border-bottom-width","border-left-width",
  "border-top-color","border-right-color","border-bottom-color","border-left-color",
  "border-top-left-radius","border-top-right-radius","border-bottom-left-radius","border-bottom-right-radius",
  "box-shadow","backdrop-filter","transform","transition-property","transition-duration","cursor",
];

/** Serialize one story's DOM as { stablePath: {prop: value} }.
 *  The path is structural (tag + nth-child chain), NOT class-based — class names are exactly what
 *  CSS Modules change, so keying on them would make every migration look like a total rewrite.
 *
 *  DEVIATIONS ONLY. Recording every property's raw value for every element made the baseline tens of
 *  megabytes, almost all of it `none`/`0px`/etc — properties sitting at their initial value, which no
 *  CSS in this repo ever sets. Instead: build one bare reference element in `body` (so it inherits
 *  body's font-family/color/font-size/line-height the same way any other bare element would), read
 *  PROPS off it, and only keep a real element's value for a property when it differs from that
 *  reference. An element with zero deviations still gets an (empty) entry so NEW/REMOVED element
 *  detection keeps working; a missing property inside an entry means "at the inherited default". */
const PROBE = `(async () => {
  document.querySelectorAll("style[data-cssbaseline]").forEach((n) => n.remove());
  const kill = document.createElement("style");
  kill.setAttribute("data-cssbaseline", "1");
  kill.textContent = "*, *::before, *::after { animation: none !important; }";
  document.head.appendChild(kill);
  try { await document.fonts.ready; } catch {}
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  const PROPS = ${JSON.stringify(PROPS)};
  const path = (el) => {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.documentElement; n = n.parentElement) {
      const i = n.parentElement ? Array.prototype.indexOf.call(n.parentElement.children, n) : 0;
      parts.unshift(n.tagName.toLowerCase() + "[" + i + "]");
    }
    return parts.join(">");
  };

  const ref = document.createElement("div");
  document.body.appendChild(ref);
  const refCs = getComputedStyle(ref);
  const defaults = {};
  for (const p of PROPS) defaults[p] = refCs.getPropertyValue(p);
  ref.remove();

  const out = {};
  const all = document.querySelectorAll("body *");
  for (const el of all) {
    if (el.tagName === "STYLE" || el.tagName === "SCRIPT") continue;
    const cs = getComputedStyle(el);
    const rec = {};
    for (const p of PROPS) {
      const v = cs.getPropertyValue(p);
      if (v !== defaults[p]) rec[p] = v;
    }
    out[path(el)] = rec;
  }
  return JSON.stringify({ count: all.length, els: out });
})()`;

const rpc = (ws: WebSocket, sessionId?: string) => {
  let id = 0;
  const pending = new Map<number, { res: (v: any) => void; rej: (e: any) => void }>();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(String(e.data));
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id)!; pending.delete(m.id);
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
    }
  });
  return (method: string, params: any = {}) => new Promise<any>((res, rej) => {
    const n = ++id;
    pending.set(n, { res, rej });
    ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
};

const index = await (await fetch(`${BASE}/index.json`)).json();
const storyIds = Object.keys(index.entries).filter((id) => !ONLY || id === ONLY).sort();
if (storyIds.length === 0) throw new Error(`no stories matched (--story ${ONLY})`);

const port = 9600 + Math.floor(Math.random() * 300);
const profile = mkdtempSync(join(tmpdir(), "bismuth-cssbase-"));
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  `--window-size=${W},${H}`, "--hide-scrollbars", "--force-prefers-reduced-motion",
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
await page("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });

const captured: Record<string, any> = {};
const empty: string[] = [];
for (const id of storyIds) {
  await page("Page.navigate", { url: `${BASE}/iframe.html?id=${id}&viewMode=story` });
  await sleep(SETTLE);
  const r = await page("Runtime.evaluate", { expression: PROBE, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) { console.error(`SKIP ${id}: ${r.exceptionDetails.text}`); continue; }
  const parsed = JSON.parse(r.result.value);
  if (parsed.count === 0) empty.push(id);
  captured[id] = parsed.els;
}
ws.close();
chrome.kill();

if (empty.length) console.error(`WARNING: ${empty.length} story(s) rendered 0 elements — unprotected:\n  ${empty.join("\n  ")}`);

if (UPDATE) {
  writeFileSync(OUT, JSON.stringify(captured, null, 1));
  console.log(`recorded ${Object.keys(captured).length} stories -> ${OUT}`);
  process.exit(0);
}

if (!existsSync(OUT)) throw new Error(`no baseline at ${OUT} — run with --update first`);
const base = JSON.parse(readFileSync(OUT, "utf8"));
const diffs: string[] = [];
// Entries are DEVIATIONS-ONLY (see PROBE): a property absent from an entry means "at the inherited
// default". So the property-level comparison must walk the UNION of both sides' keys, not just the
// captured side — otherwise a rule getting dropped (value drifting back to default) would present as
// the property silently vanishing instead of a reported change, which is exactly the failure this
// harness exists to catch.
for (const id of Object.keys(captured)) {
  const b = base[id], c = captured[id];
  if (!b) { diffs.push(`${id}: NEW story (no baseline)`); continue; }
  const allPaths = new Set([...Object.keys(b), ...Object.keys(c)]);
  for (const p of allPaths) {
    const bp = b[p], cp = c[p];
    if (!bp) { diffs.push(`${id} ${p}: NEW element`); continue; }
    if (!cp) { diffs.push(`${id} ${p}: REMOVED element`); continue; }
    const allProps = new Set([...Object.keys(bp), ...Object.keys(cp)]);
    for (const prop of allProps) {
      const bv = bp[prop] ?? "[default]";
      const cv = cp[prop] ?? "[default]";
      if (bv !== cv) diffs.push(`${id} ${p} ${prop}: ${bv} -> ${cv}`);
    }
  }
}
console.log(diffs.slice(0, 200).join("\n"));
if (diffs.length > 200) console.log(`… and ${diffs.length - 200} more`);
console.log(`${diffs.length} changed`);
process.exit(diffs.length === 0 ? 0 : 1);
