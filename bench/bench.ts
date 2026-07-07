// bench/bench.ts — backend hot-path benchmarks over a SYNTHETIC vault (never a real one).
// Run from a repo checkout: `bun bench/bench.ts [--vault-size N] [--label X]`.
// Measures wall time AND max event-loop stall (the metric behind "terminal gets laggy":
// a synchronous burst on Bun's single thread starves every socket — the probe ticks every
// 5ms and records the worst observed lag while the operation runs).
//
// Designed to run identically on old commits (via a git worktree) for before/after tables:
// it only imports long-stable public entry points (listTree, searchVault, runTaskQuery).
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { listTree } from "../core/src/files";
import { searchVault, invalidateSearchIndex } from "../core/src/search";
import { runTaskQuery } from "../core/src/tasks-query";
import { collectVaultTasks } from "../core/src/tasks";

const args = process.argv.slice(2);
const flag = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const VAULT_SIZE = Number(flag("vault-size", "2000"));
const LABEL = flag("label", "current");

// ── Synthetic vault ─────────────────────────────────────────────────────────
const VAULT = join(tmpdir(), `bismuth-bench-vault-${VAULT_SIZE}`);
function buildVault(): void {
  if (existsSync(VAULT)) rmSync(VAULT, { recursive: true, force: true });
  mkdirSync(VAULT, { recursive: true });
  const folders = ["notes", "projects", "reading", "journal", "archive"];
  for (const f of folders) mkdirSync(join(VAULT, f), { recursive: true });
  for (let i = 0; i < VAULT_SIZE; i++) {
    const folder = folders[i % folders.length];
    const icon = i % 7 === 0 ? `icon: Star\n` : "";
    const tasks =
      i % 3 === 0
        ? `- [ ] task ${i} due 📅 2026-0${(i % 8) + 1}-15\n- [x] done ${i} ✅ 2026-01-0${(i % 9) + 1}\n- [ ] scheduled ⏳ 2026-05-2${i % 9}\n`
        : "";
    writeFileSync(
      join(VAULT, folder, `note-${i}.md`),
      `---\ntags: [t${i % 20}, common]\n${icon}---\n\n# Note ${i}\n\nBody paragraph about topic-${i % 50} linking [[note-${(i * 7) % VAULT_SIZE}]] and #tag${i % 30}.\n\n${tasks}\n${"Filler sentence about knowledge graphs, spaced repetition, and daemons. ".repeat(12)}\n`,
    );
  }
}

// ── Event-loop stall probe ──────────────────────────────────────────────────
// Ticks every 5ms; any observed gap beyond the interval is main-thread starvation.
function probe() {
  let max = 0;
  let last = performance.now();
  const id = setInterval(() => {
    const now = performance.now();
    const lag = now - last - 5;
    if (lag > max) max = lag;
    last = now;
  }, 5);
  return { stop: () => (clearInterval(id), max) };
}

async function timed<T>(fn: () => Promise<T> | T): Promise<{ ms: number; stallMs: number }> {
  const p = probe();
  const t0 = performance.now();
  await fn();
  const ms = performance.now() - t0;
  await new Promise((r) => setTimeout(r, 15)); // let the probe observe the tail
  return { ms, stallMs: p.stop() };
}

const fmt = (n: number) => n.toFixed(1).padStart(8);
const results: Record<string, { ms: number; stallMs: number }> = {};

async function bench(name: string, warmups: number, runs: number, fn: () => Promise<unknown> | unknown): Promise<void> {
  for (let i = 0; i < warmups; i++) await fn();
  let best: { ms: number; stallMs: number } | null = null;
  for (let i = 0; i < runs; i++) {
    const r = await timed(fn);
    if (!best || r.ms < best.ms) best = { ms: r.ms, stallMs: Math.max(best?.stallMs ?? 0, r.stallMs) };
  }
  results[name] = best!;
  console.log(`${name.padEnd(34)} ${fmt(best!.ms)} ms   max-stall ${fmt(best!.stallMs)} ms`);
}

// ── Run ─────────────────────────────────────────────────────────────────────
console.log(`\n=== bismuth bench [${LABEL}] — vault ${VAULT_SIZE} notes ===\n`);
buildVault();

// 1. listTree: the tree rebuild that fires on every structural vault change (and blocked the
//    event loop with per-note statSync before the fix).
await bench("listTree (cold+warm icon cache)", 1, 5, () => listTree(VAULT));

// 2. Cold search-index build + query: invalidate first so every run rebuilds from scratch —
//    the "search right after a broad invalidation" path that froze the terminal.
await bench("searchVault (cold index build)", 0, 3, async () => {
  invalidateSearchIndex(VAULT);
  await searchVault(VAULT, "knowledge graphs daemons", { regex: false, caseSensitive: false, wholeWord: false });
});

// 3. Warm search (index cached) — should be fast in both versions; a regression tripwire.
await bench("searchVault (warm)", 1, 5, () => searchVault(VAULT, "spaced repetition", { regex: false, caseSensitive: false, wholeWord: false }));

// 4. Task query DSL over the whole vault's tasks (regex hoisting fix).
const tasks = await collectVaultTasks(VAULT);
console.log(`   (task corpus: ${tasks.length} tasks)`);
await bench("runTaskQuery (5 filters + sort)", 2, 5, () =>
  runTaskQuery(tasks, "not done\ndue before 2026-06-01\nscheduled after 2026-01-01\ndescription includes task\nsort by due reverse", "2026-07-06"),
);

console.log(`\nJSON:${JSON.stringify({ label: LABEL, vaultSize: VAULT_SIZE, results })}`);
