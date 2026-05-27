import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../src/server";
import { writeNote } from "../src/files";
import { makeSampleVault } from "./helpers";

test("GET /graph returns the merged brain graph", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const g = await (await fetch(`${base}/graph`)).json();
    const ids = g.nodes.map((n: any) => n.id);
    expect(ids).toContain("internship");
    expect(ids).toContain("mem:michael-profile");
    expect(ids).toContain("self");
    expect(g.edges).toContainEqual({ from: "mem:michael-profile", to: "internship", kind: "about" });

    const before = await (await fetch(`${base}/file?path=essay.md`)).text();
    expect(before).toContain("Essay");

    const meta = await (await fetch(`${base}/meta?path=housing.md`)).json();
    expect(meta).toEqual({ status: "in-progress", priority: 1, tags: ["logistics"] });
  } finally {
    server.stop(true);
  }
});

test("GET /config returns the launch vault and memory paths", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const cfg = await (await fetch(`${base}/config`)).json();
    expect(cfg).toEqual({ vault, memory });
  } finally {
    server.stop(true);
  }
});

test("GET /agent-graph returns an object with nodes and edges arrays", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const ag = await (await fetch(`${base}/agent-graph`)).json();
    expect(Array.isArray(ag.nodes)).toBe(true);
    expect(Array.isArray(ag.edges)).toBe(true);
  } finally {
    server.stop(true);
  }
});

test("GET /version returns { version: <number> }", async () => {
  const { vault } = await makeSampleVault();
  const server = createServer({ vault, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const res = await (await fetch(`${base}/version`)).json();
    expect(typeof res.version).toBe("number");
  } finally {
    server.stop(true);
  }
});

test("GET /file with missing path parameter returns 400", async () => {
  const { vault } = await makeSampleVault();
  const server = createServer({ vault, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const res = await fetch(`${base}/file`);
    expect(res.status).toBe(400);
  } finally {
    server.stop(true);
  }
});

test("GET /file with nonexistent file returns empty string with 200", async () => {
  const { vault } = await makeSampleVault();
  const server = createServer({ vault, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const res = await fetch(`${base}/file?path=nonexistent.md`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe("");
  } finally {
    server.stop(true);
  }
});

test("OPTIONS request returns CORS headers", async () => {
  const { vault } = await makeSampleVault();
  const server = createServer({ vault, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const res = await fetch(`${base}/graph`, { method: "OPTIONS" });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
  } finally {
    server.stop(true);
  }
});

test("GET /meta with missing path parameter returns 400", async () => {
  const { vault } = await makeSampleVault();
  const server = createServer({ vault, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const res = await fetch(`${base}/meta`);
    expect(res.status).toBe(400);
  } finally {
    server.stop(true);
  }
});

test("GET /meta for nonexistent file returns empty object", async () => {
  const { vault } = await makeSampleVault();
  const server = createServer({ vault, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const res = await fetch(`${base}/meta?path=nonexistent.md`);
    const data = await res.json();
    expect(data).toEqual({});
  } finally {
    server.stop(true);
  }
});

test("GET /tree returns array of { path } entries", async () => {
  const { vault } = await makeSampleVault();
  const server = createServer({ vault, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const res = await fetch(`${base}/tree`);
    const entries = await res.json();
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.every((e: any) => typeof e.path === "string")).toBe(true);
    expect(entries.map((e: any) => e.path)).toContain("housing.md");
    expect(entries.every((e: any) => e.kind === "file" || e.kind === "dir")).toBe(true);
  } finally {
    server.stop(true);
  }
});

test("GET /tree surfaces a note's `icon` frontmatter", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-tree-icon-"));
  await writeNote(dir, "fire.md", "---\nicon: 🔥\n---\nhot");
  await writeNote(dir, "plain.md", "no frontmatter");
  const server = createServer({ vault: dir, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const entries = await (await fetch(`${base}/tree`)).json();
    expect(entries).toContainEqual({ path: "fire.md", icon: "🔥", kind: "file" });
    expect(entries).toContainEqual({ path: "plain.md", kind: "file" });
  } finally {
    server.stop(true);
  }
});

test("PUT /file writes file and returns ok", async () => {
  const { vault } = await makeSampleVault();
  const server = createServer({ vault, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const res = await fetch(`${base}/file`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "test-write.md", contents: "New content" })
    });
    const text = await res.text();
    expect(text).toBe("ok");
  } finally {
    server.stop(true);
  }
});

test("POST /backup returns committed boolean", async () => {
  const { vault } = await makeSampleVault();
  const server = createServer({ vault, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const res = await fetch(`${base}/backup`, { method: "POST" });
    const data = await res.json();
    expect(typeof data.committed).toBe("boolean");
  } finally {
    server.stop(true);
  }
});

test("GET /graph includes self node", async () => {
  const { vault } = await makeSampleVault();
  const server = createServer({ vault, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const g = await (await fetch(`${base}/graph`)).json();
    expect(g.nodes.some((n: any) => n.id === "self")).toBe(true);
  } finally {
    server.stop(true);
  }
});

test("graph caching: second request returns same graph without rebuild", async () => {
  const { vault } = await makeSampleVault();
  const server = createServer({ vault, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const first = await (await fetch(`${base}/graph`)).json();
    const second = await (await fetch(`${base}/graph`)).json();
    expect(first.nodes.length).toBe(second.nodes.length);
    expect(first.edges.length).toBe(second.edges.length);
  } finally {
    server.stop(true);
  }
});

test("version increments are consistent", async () => {
  const { vault } = await makeSampleVault();
  const server = createServer({ vault, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const v1 = await (await fetch(`${base}/version`)).json();
    const v2 = await (await fetch(`${base}/version`)).json();
    expect(v1.version).toBeLessThanOrEqual(v2.version);
  } finally {
    server.stop(true);
  }
});

test("config endpoint returns vault and memory paths", async () => {
  const server = createServer({ vault: "/custom/vault", memory: "/custom/memory", port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const cfg = await (await fetch(`${base}/config`)).json();
    expect(cfg.vault).toBe("/custom/vault");
    expect(cfg.memory).toBe("/custom/memory");
  } finally {
    server.stop(true);
  }
});

test("config endpoint handles undefined memory", async () => {
  const { vault } = await makeSampleVault();
  const server = createServer({ vault, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const cfg = await (await fetch(`${base}/config`)).json();
    expect(cfg.memory).toBeNull();
  } finally {
    server.stop(true);
  }
});
