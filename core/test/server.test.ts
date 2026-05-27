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

test("GET /vault-data returns a row per note with file meta + frontmatter", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const rows = await (await fetch(`${base}/vault-data`)).json();
    expect(Array.isArray(rows)).toBe(true);
    const housing = rows.find((r: any) => r.file.name === "housing");
    expect(housing).toBeDefined();
    expect(housing.note.status).toBe("in-progress");
    expect(housing.file.tags).toContain("logistics");
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

test("POST /create then /move then /delete then /restore round-trips a file", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  const post = (path: string, body: unknown) =>
    fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    expect((await post("/create", { path: "fresh.md", kind: "file" })).status).toBe(200);
    let paths = (await (await fetch(`${base}/tree`)).json()).map((e: any) => e.path);
    expect(paths).toContain("fresh.md");

    expect((await post("/move", { from: "fresh.md", to: "renamed.md" })).status).toBe(200);
    paths = (await (await fetch(`${base}/tree`)).json()).map((e: any) => e.path);
    expect(paths).toContain("renamed.md");
    expect(paths).not.toContain("fresh.md");

    const { trashPath } = await (await post("/delete", { path: "renamed.md" })).json();
    expect(typeof trashPath).toBe("string");
    paths = (await (await fetch(`${base}/tree`)).json()).map((e: any) => e.path);
    expect(paths).not.toContain("renamed.md");

    expect((await post("/restore", { trashPath, to: "renamed.md" })).status).toBe(200);
    paths = (await (await fetch(`${base}/tree`)).json()).map((e: any) => e.path);
    expect(paths).toContain("renamed.md");
  } finally {
    server.stop(true);
  }
});

test("POST /create returns 400 on collision", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const res = await fetch(`${base}/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "essay.md", kind: "file" }),
    });
    expect(res.status).toBe(400);
  } finally {
    server.stop(true);
  }
});

test("POST /set-property writes a frontmatter key reflected in /vault-data and /meta", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    // housing.md starts at status: in-progress — flip it to done.
    const res = await fetch(`${base}/set-property`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "housing.md", key: "status", value: "done" }),
    });
    expect(res.status).toBe(200);

    const rows = await (await fetch(`${base}/vault-data`)).json();
    const housing = rows.find((r: any) => r.file.name === "housing");
    expect(housing.note.status).toBe("done");
    // other keys are preserved
    expect(housing.note.priority).toBe(1);

    const meta = await (await fetch(`${base}/meta?path=housing.md`)).json();
    expect(meta.status).toBe("done");
  } finally {
    server.stop(true);
  }
});

test("POST /set-property bumps the version so views refetch", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const v0 = (await (await fetch(`${base}/version`)).json()).version;
    await fetch(`${base}/set-property`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "essay.md", key: "status", value: "todo" }),
    });
    const v1 = (await (await fetch(`${base}/version`)).json()).version;
    expect(v1).toBeGreaterThan(v0);
  } finally {
    server.stop(true);
  }
});

test("POST /move bumps the version so the sidebar refetches", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const v0 = (await (await fetch(`${base}/version`)).json()).version;
    await fetch(`${base}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: "essay.md", to: "essay2.md" }),
    });
    const v1 = (await (await fetch(`${base}/version`)).json()).version;
    expect(v1).toBeGreaterThan(v0);
  } finally {
    server.stop(true);
  }
});
