// bench/probeStory.ts — computed styles for ONE Storybook story, in seconds.
//
// WHY THIS EXISTS. bench/cssBaseline.ts is the gate for the CSS-module migration, and it costs ~12
// minutes over ~247 stories. During a single component's migration that is the wrong instrument to
// reach for: the question in the loop is "do THIS component's rules still resolve", asked repeatedly
// while editing. Waiting 12 minutes for it means not asking, which means finding out at the gate.
// This runs one story and answers that in about five seconds. It is a MICROSCOPE, not a gate — the
// full baseline is still the thing that has to be green before a commit lands.
//
// WHY IT DRIVES ITS OWN CHROME: same reason as bench/cssBaseline.ts and bench/visual.ts — a
// background automation tab reports visibilityState "hidden", so rAF-gated components (GraphView
// pauses its loop on exactly that) never paint and sample as blank. The three --disable-*background*
// flags keep the loop live with no foreground window. The reported visibilityState is printed with
// every run so a "hidden" regression can never be mistaken for a broken component.
//
// WHY IT KEYS ON STRUCTURAL PATHS, NEVER CLASS NAMES. Class names are the one thing a CSS-module
// migration is guaranteed to change (`.win-btn` -> `._win-btn_jq4at_27`). A class-keyed probe reports
// "element gone / 0 matches" for a migration that worked perfectly, and — far worse — a probe written
// after the move reports a confident green while measuring nothing. So every element is addressed by
// tag + nth-of-type chain from the story root, the same way bench/cssBaseline.ts keys its snapshot.
// `--select` exists for narrowing, and warns if the selector it is handed contains a class token.
//
// WHAT THIS DOES NOT PROVE. Read this before quoting a green run at anyone.
//   * ONE STORY, ONE STATE. It measures the story you named, in its RESTING state. It says nothing
//     about any other story, and nothing about the app — a story renders a component in isolation,
//     with none of the app's ancestor chain unless the story builds one.
//   * NOTHING HOVERED, FOCUSED OR ACTIVE. CSS :hover follows the real pointer; dispatching a
//     synthetic mouseover does not move it. A `:hover`-only rule is unreachable here, exactly as it
//     is in bench/cssBaseline.ts. `:focus-within` IS reachable, but only if the story's own `play`
//     focuses something — this tool does not interact with the page at all.
//   * NOTHING IT DOES NOT RENDER. A component's rarely-hit branch, a Tauri-only control, an error
//     state — if the story does not render it, no rule on it is covered. bench/moduleClassCheck.ts is
//     the instrument that needs no story.
//   * NO COMPARISON. It prints what it measured; it holds no history and reads NOTHING from
//     bench/css-baseline.json (deliberately — coupling the two would let a bug in one corrupt the
//     other). "Unchanged" is a judgement the caller makes by diffing two runs of this tool.
//   * NOT A SUBSTITUTE FOR THE BASELINE, and not comparable to it in every case: this tool does not
//     freeze the wall clock, so a story whose rendering depends on today's date (the calendar grids)
//     can legitimately differ from what cssBaseline.ts recorded.
//   * ONLY THE PROPERTIES ASKED FOR. The default list covers what this repo's rules actually set; a
//     rule touching anything outside it is invisible unless named in --props.
//
//   cd app && bun run storybook              # must already be running; this only READS :6006
//   bun bench/probeStory.ts shell-windowcontrols--default
//   bun bench/probeStory.ts app-filetree--default --select "div > div" --props padding-left,color
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const VALUE_FLAGS = new Set(["select", "props", "base", "settle", "stable", "tries", "root"]);
const argv = process.argv.slice(2);
const opts = new Map<string, string>();
const positional: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  if (!a.startsWith("--")) { positional.push(a); continue; }
  const name = a.slice(2);
  opts.set(name, VALUE_FLAGS.has(name) ? (argv[++i] ?? "") : "1");
}

const ID = positional[0] ?? "";
const BASE = opts.get("base") ?? "http://localhost:6006";
const SELECT = opts.get("select") ?? "";
const ROOT_SEL = opts.get("root") ?? "#storybook-root";
const SETTLE = Number(opts.get("settle") ?? 800);
const STABLE = Number(opts.get("stable") ?? 2);
const MAX_TRIES = Number(opts.get("tries") ?? 10);
const JSON_OUT = opts.has("json");
const SHOW_HTML = opts.has("html");
const W = 1280, H = 900;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The properties this repo's rules actually control — a subset of bench/cssBaseline.ts's list, kept
 *  short so one story's output stays readable. Override wholesale with --props. */
const DEFAULT_PROPS = [
  "display", "position", "width", "height", "flex-direction", "align-items", "justify-content", "gap",
  "padding-top", "padding-right", "padding-bottom", "padding-left",
  "margin-top", "margin-right", "margin-bottom", "margin-left",
  "font-family", "font-size", "font-weight", "line-height", "color", "background-color", "opacity",
  "border-top-width", "border-top-color", "border-top-left-radius", "cursor", "overflow-x", "white-space",
];
const PROPS = (opts.get("props") ?? "").trim() ? opts.get("props")!.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_PROPS;

if (!ID) {
  console.error(`usage: bun bench/probeStory.ts <story-id> [flags]

  <story-id>      a full Storybook story id, e.g. shell-windowcontrols--default
                  (list them: curl -s ${BASE}/index.json | jq -r '.entries|keys[]')
  --select <css>  probe only elements matching this selector inside the story root. Results are
                  still keyed by STRUCTURAL path. A selector containing a .class is warned about:
                  class names are what a CSS-module migration changes.
  --props a,b,c   CSS properties to report (default: ${DEFAULT_PROPS.length} common ones)
  --root <css>    the story root to walk (default #storybook-root)
  --html          also print the story root's innerHTML
  --json          machine-readable output
  --base <url>    Storybook origin (default ${BASE}) — read-only, never started by this tool
  --settle <ms>   head start before the first capture (default 800)
  --stable <n>    identical consecutive captures required (default 2)
  --tries <n>     give up converging after this many captures (default 10)

exit 0 = probed at least one element, 1 = nothing to probe (empty story, or --select matched
nothing), 2 = bad usage, Storybook unreachable, unknown story id, or Chrome failed to start`);
  process.exit(2);
}

if (/(^|[\s>+~,(])\.[a-zA-Z_-]/.test(SELECT)) {
  console.error(`WARNING: --select "${SELECT}" targets a CLASS. Class names are exactly what a CSS-module`);
  console.error(`         migration rewrites, so this selector can report "0 matches" for a migration that`);
  console.error(`         worked, or silently measure nothing. Prefer a structural selector (tag > tag).`);
}

// Confirm the story exists BEFORE spending a Chrome launch on it. A typo'd id otherwise renders
// Storybook's own error page, which is a perfectly measurable DOM and would be reported as a pass.
let index: { entries?: Record<string, unknown> };
try {
  const r = await fetch(`${BASE}/index.json`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  index = await r.json();
} catch (e) {
  console.error(`cannot read ${BASE}/index.json — is Storybook running? (cd app && bun run storybook)\n  ${(e as Error).message}`);
  process.exit(2);
}
if (!index.entries?.[ID]) {
  const near = Object.keys(index.entries ?? {}).filter((k) => k.startsWith(ID.split("--")[0] ?? ID)).slice(0, 8);
  console.error(`unknown story id: ${ID}`);
  if (near.length) console.error(`did you mean:\n  ${near.join("\n  ")}`);
  process.exit(2);
}

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

const port = 9700 + Math.floor(Math.random() * 200);
const profile = mkdtempSync(join(tmpdir(), "bismuth-probestory-"));
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  // The three that keep rAF alive with no foreground window — see the header.
  "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  `--window-size=${W},${H}`, "--hide-scrollbars", "--force-prefers-reduced-motion",
  "--no-first-run", "--no-default-browser-check", "--disable-extensions", "about:blank",
], { stdio: "ignore" });
// Registered on "exit" so EVERY path out is covered — the clean run, the exit(1) on an empty story,
// an unhandled throw, and a Ctrl-C. Killing Chrome only on the happy path leaks a browser and a
// ~50MB profile dir per failed run; that exact leak was fixed in cssBaseline.ts, so it is not
// reintroduced here.
// SIGKILL, not the default SIGTERM: a gracefully-terminating Chrome keeps WRITING to its profile
// while shutting down, so the rmSync immediately after loses a race with it and throws ENOTEMPTY —
// which, swallowed by a `catch {}`, leaks a ~50MB dir per run and looks like it cleaned up. Measured:
// three of seven runs leaked before this changed. The bounded retry covers the rest of the race.
process.on("exit", () => {
  try { chrome.kill("SIGKILL"); } catch {}
  for (let i = 0; i < 5; i++) {
    try { rmSync(profile, { recursive: true, force: true }); return; } catch { Bun.sleepSync(60); }
  }
});
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => process.exit(130));

let wsUrl = "";
for (let i = 0; i < 100 && !wsUrl; i++) {
  try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) wsUrl = (await r.json()).webSocketDebuggerUrl; } catch {}
  if (!wsUrl) await sleep(100);
}
if (!wsUrl) { console.error("chrome debugger port never opened"); process.exit(2); }

const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
const browser = rpc(ws);
const { targetId } = await browser("Target.createTarget", { url: "about:blank" });
const { sessionId } = await browser("Target.attachToTarget", { targetId, flatten: true });
const page = rpc(ws, sessionId);
await page("Page.enable");
await page("Runtime.enable");
await page("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });

/** Runs in the page. Kills animations and awaits webfonts for the same determinism reasons
 *  bench/cssBaseline.ts documents, then walks the story root and reports each element by structural
 *  path. Only DEVIATIONS from a bare reference element are kept, so the output is the CSS that
 *  actually applies rather than 28 initial values per element. */
const probe = (props: string[], rootSel: string, select: string) => `(async () => {
  document.querySelectorAll("style[data-probestory]").forEach((n) => n.remove());
  const kill = document.createElement("style");
  kill.setAttribute("data-probestory", "1");
  kill.textContent = "*, *::before, *::after { animation: none !important; }";
  document.head.appendChild(kill);
  try { await document.fonts.ready; } catch {}
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  const PROPS = ${JSON.stringify(props)};
  const root = document.querySelector(${JSON.stringify(rootSel)});
  if (!root) return JSON.stringify({ error: "root selector matched nothing: " + ${JSON.stringify(rootSel)} });

  // tag + nth-of-type chain, relative to the root — never a class name (see the file header).
  const path = (el) => {
    const parts = [];
    for (let n = el; n && n !== root; n = n.parentElement) {
      const tag = n.tagName.toLowerCase();
      const sibs = [...(n.parentElement ? n.parentElement.children : [])].filter((c) => c.tagName === n.tagName);
      parts.unshift(sibs.length > 1 ? tag + ":nth-of-type(" + (sibs.indexOf(n) + 1) + ")" : tag);
    }
    return parts.join(" > ") || ":root-element";
  };

  const ref = document.createElement("div");
  document.body.appendChild(ref);
  const refCs = getComputedStyle(ref);
  const defaults = {};
  for (const p of PROPS) defaults[p] = refCs.getPropertyValue(p);
  ref.remove();

  const all = [...root.querySelectorAll("*")];
  const picked = ${JSON.stringify(select)} ? [...root.querySelectorAll(${JSON.stringify(select)})] : all;
  const els = {};
  for (const el of picked) {
    const cs = getComputedStyle(el);
    const out = {};
    for (const p of PROPS) {
      const v = cs.getPropertyValue(p);
      if (v !== defaults[p]) out[p] = v;
    }
    const r = el.getBoundingClientRect();
    out["#box"] = Math.round(r.width) + "x" + Math.round(r.height);
    els[path(el)] = out;
  }
  return JSON.stringify({
    meta: {
      url: location.href,
      visibilityState: document.visibilityState,
      elementsUnderRoot: all.length,
      selected: picked.length,
      reference: defaults,
    },
    els,
    html: root.innerHTML,
  });
})()`;

await page("Page.navigate", { url: `${BASE}/iframe.html?id=${encodeURIComponent(ID)}&viewMode=story` });
await sleep(SETTLE);

// Converge instead of guessing at a sleep: a dynamic import can hold one stable state and then swap.
let last = "", same = 0, shot = "";
for (let t = 0; t < MAX_TRIES; t++) {
  const r = await page("Runtime.evaluate", { expression: probe(PROPS, ROOT_SEL, SELECT), returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) { console.error(`probe threw in the page: ${r.exceptionDetails.text ?? JSON.stringify(r.exceptionDetails)}`); process.exit(2); }
  shot = String(r.result?.value ?? "");
  if (shot === last) { if (++same >= STABLE - 1) break; } else { same = 0; last = shot; }
  await sleep(300);
}
const parsed = JSON.parse(shot || "{}");
if (parsed.error) { console.error(parsed.error); process.exit(1); }

const { meta, els, html } = parsed as { meta: any; els: Record<string, Record<string, string>>; html: string };

if (JSON_OUT) {
  console.log(JSON.stringify({ story: ID, ...parsed, ...(SHOW_HTML ? {} : { html: undefined }) }, null, 2));
} else {
  console.log(`story: ${ID}`);
  console.log(`url:   ${meta.url}`);
  console.log(`page:  visibilityState=${meta.visibilityState}, ${meta.elementsUnderRoot} element(s) under ${ROOT_SEL}${SELECT ? `, ${meta.selected} matched --select "${SELECT}"` : ""}`);
  if (SHOW_HTML) console.log(`html:  ${html}`);
  console.log(`\nper-element computed styles (deviations from a bare <div> in body; #box = w x h):`);
  for (const [p, v] of Object.entries(els)) {
    console.log(`  ${p}`);
    for (const [k, val] of Object.entries(v)) console.log(`      ${k}: ${val}`);
  }
}

// The failure modes that must never read as a pass: a story that rendered nothing, and a --select
// that matched nothing. Both would otherwise print an empty list under a zero exit code.
if (meta.elementsUnderRoot === 0) {
  console.error(`\nEMPTY: the story rendered NO elements under ${ROOT_SEL} — nothing was measured. It is unprotected, not passing.`);
  process.exit(1);
}
if (SELECT && meta.selected === 0) {
  console.error(`\nNO MATCH: --select "${SELECT}" matched 0 of the ${meta.elementsUnderRoot} element(s) under ${ROOT_SEL} — nothing was measured.`);
  console.error(`If that selector names a class, remember the migration hashes class names; probe structurally instead.`);
  process.exit(1);
}
console.log(`\nprobed ${meta.selected} element(s). Resting state only — nothing hovered, focused, or from any other story.`);
process.exit(0);
