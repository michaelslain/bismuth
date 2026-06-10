#!/usr/bin/env bun
// Docs gate — two cheap, deterministic checks (no LLM):
//   1. LINK CHECK (blocking): every relative .md link under docs/ (and from CLAUDE.md
//      into docs/) must resolve. Exits non-zero on any broken link.
//   2. STALENESS WARNING (non-blocking, --pre-push only): if the pushed commit range
//      touched core/app/cli source but no docs/** or CLAUDE.md, print a reminder to
//      run /update-docs. Never blocks — docs regen is a deliberate step, not automatic.
//
// Usage: `bun run scripts/check-docs.ts` (links only) | `... --pre-push` (links + staleness).
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { execSync } from "node:child_process";

const ROOT = resolve(import.meta.dir, "..");
const DOCS = join(ROOT, "docs");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of (existsSync(dir) ? readdirSync(dir) : [])) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (name.endsWith(".md")) out.push(p);
  }
  return out;
}

// Pull relative .md link targets out of a markdown file (skips http(s), strips #anchors).
function mdLinks(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const out: string[] = [];
  for (const m of text.matchAll(/\]\(([^)]+?\.md)(#[^)]*)?\)/g)) {
    const target = m[1];
    if (/^https?:\/\//.test(target)) continue;
    out.push(target);
  }
  return out;
}

function checkLinks(): string[] {
  const broken: string[] = [];
  const files = walk(DOCS);
  // CLAUDE.md may link into docs/ too — include it.
  if (existsSync(join(ROOT, "CLAUDE.md"))) files.push(join(ROOT, "CLAUDE.md"));
  for (const f of files) {
    for (const link of mdLinks(f)) {
      const targetPath = resolve(dirname(f), link);
      if (!existsSync(targetPath)) broken.push(`${relative(ROOT, f)} → ${link}`);
    }
  }
  return broken;
}

function changedFiles(range: string): string[] {
  try {
    return execSync(`git diff --name-only ${range}`, { cwd: ROOT, encoding: "utf8" })
      .split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function staleness(): string | null {
  // What's about to be pushed to main. If origin/main is unknown, skip silently.
  let range = "origin/main..HEAD";
  try {
    execSync("git rev-parse --verify origin/main", { cwd: ROOT, stdio: "ignore" });
  } catch {
    return null;
  }
  const changed = changedFiles(range);
  if (changed.length === 0) return null;
  const SOURCE = /^((core|app|cli|mcp)\/src\/|relay\/)/;
  const touchedSource = changed.some((f) => SOURCE.test(f));
  const touchedDocs = changed.some((f) => f.startsWith("docs/") || f === "CLAUDE.md");
  if (touchedSource && !touchedDocs) {
    const src = changed.filter((f) => SOURCE.test(f));
    return `source changed in ${src.length} file(s) but no docs/ or CLAUDE.md updated — consider /update-docs\n  ${src.slice(0, 8).join("\n  ")}${src.length > 8 ? "\n  …" : ""}`;
  }
  return null;
}

const prePush = process.argv.includes("--pre-push");

const broken = checkLinks();
if (broken.length) {
  console.error(`✗ docs link check: ${broken.length} broken link(s):`);
  for (const b of broken) console.error(`  ${b}`);
  process.exit(1);
}
console.error(`✓ docs link check: all links resolve`);

if (prePush) {
  const warn = staleness();
  if (warn) {
    console.error(`\n⚠ ${warn}\n  (warning only — not blocking the push)`);
  }
}
process.exit(0);
