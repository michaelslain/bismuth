import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../src/server";
import { writeNote, readNote } from "../src/files";
import { readSettings } from "../src/settings";
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

test("POST /folder-icon sets a directory icon surfaced on GET /tree", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-folder-icon-"));
  await writeNote(dir, "projects/a.md", "x");
  const server = createServer({ vault: dir, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const res = await fetch(`${base}/folder-icon`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "projects", icon: "Folder" }),
    });
    expect(res.status).toBe(200);

    const entries = await (await fetch(`${base}/tree`)).json();
    expect(entries).toContainEqual({ path: "projects", icon: "Folder", kind: "dir" });
  } finally {
    server.stop(true);
  }
});

test("POST /folder-icon with empty icon removes a previously-set directory icon", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-folder-icon-clear-"));
  await writeNote(dir, "projects/a.md", "x");
  const server = createServer({ vault: dir, port: 0 });
  const base = `http://localhost:${server.port}`;
  const post = (body: unknown) =>
    fetch(`${base}/folder-icon`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    await post({ path: "projects", icon: "Folder" });
    let entries = await (await fetch(`${base}/tree`)).json();
    expect(entries).toContainEqual({ path: "projects", icon: "Folder", kind: "dir" });

    await post({ path: "projects", icon: "" });
    entries = await (await fetch(`${base}/tree`)).json();
    expect(entries).toContainEqual({ path: "projects", kind: "dir" });
  } finally {
    server.stop(true);
  }
});

test("POST /folder-icon persists folderIcons into settings.yaml", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-folder-icon-persist-"));
  await writeNote(dir, "projects/a.md", "x");
  const server = createServer({ vault: dir, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    await fetch(`${base}/folder-icon`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "projects", icon: "Folder" }),
    });
    const res = await readSettings(dir);
    expect(res).not.toBeNull();
    expect((res!.data.folderIcons as Record<string, unknown>).projects).toBe("Folder");
  } finally {
    server.stop(true);
  }
});

test("POST /folder-icon bumps the version so the sidebar refetches", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-folder-icon-ver-"));
  await writeNote(dir, "projects/a.md", "x");
  const server = createServer({ vault: dir, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const v0 = (await (await fetch(`${base}/version`)).json()).version;
    await fetch(`${base}/folder-icon`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "projects", icon: "Folder" }),
    });
    const v1 = (await (await fetch(`${base}/version`)).json()).version;
    expect(v1).toBeGreaterThan(v0);
  } finally {
    server.stop(true);
  }
});

test("POST /folder-icon rejects a path that escapes the vault", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oa-folder-icon-esc-"));
  await writeNote(dir, "projects/a.md", "x");
  const server = createServer({ vault: dir, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const res = await fetch(`${base}/folder-icon`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "../escape", icon: "Folder" }),
    });
    expect(res.status).toBe(400);
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

test("GET /graph does not emit a synthetic self node", async () => {
  const { vault } = await makeSampleVault();
  const server = createServer({ vault, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const g = await (await fetch(`${base}/graph`)).json();
    expect(g.nodes.some((n: any) => n.id === "self")).toBe(false);
    expect(g.nodes.some((n: any) => n.kind === "self")).toBe(false);
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

test("POST /create returns 409 on collision", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const res = await fetch(`${base}/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "essay.md", kind: "file" }),
    });
    expect(res.status).toBe(409);
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

test("POST /set-property returns 404 for a path that doesn't exist (no silent create)", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const res = await fetch(`${base}/set-property`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "no-such-note.md", key: "status", value: "todo" }),
    });
    expect(res.status).toBe(404);
    // The endpoint must NOT have created the file as a side effect.
    expect(await Bun.file(`${vault}/no-such-note.md`).exists()).toBe(false);
  } finally {
    server.stop(true);
  }
});

test("POST /delete-property removes a frontmatter key, keeping the others", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const res = await fetch(`${base}/delete-property`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "housing.md", key: "priority" }),
    });
    expect(res.status).toBe(200);
    const meta = await (await fetch(`${base}/meta?path=housing.md`)).json();
    expect(meta.priority).toBeUndefined();
    expect(meta.status).toBe("in-progress"); // siblings preserved
  } finally {
    server.stop(true);
  }
});

test("POST /delete-property drops the whole block when removing the last key (no empty fence)", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    await writeNote(vault, "iconned.md", "---\nicon: House\n---\n# Title\n\nbody\n");
    const res = await fetch(`${base}/delete-property`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "iconned.md", key: "icon" }),
    });
    expect(res.status).toBe(200);
    const raw = await readNote(vault, "iconned.md");
    expect(raw).toBe("# Title\n\nbody\n");
    expect(raw).not.toContain("---");
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

test("GET /cards/decks returns decks with due counts", async () => {
  const vault = mkdtempSync(join(tmpdir(), "oa-srs-srv-"));
  const memory = mkdtempSync(join(tmpdir(), "oa-srs-mem-"));
  await writeNote(vault, "m.md", "#flashcards/math\n\n2+2::4");
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const decks = await (await fetch(`${base}/cards/decks`)).json();
    expect(decks.find((d: any) => d.name === "math").due).toBe(1);
  } finally {
    server.stop(true);
  }
});

test("GET /cards/due returns due cards; POST /cards/review schedules them", async () => {
  const vault = mkdtempSync(join(tmpdir(), "oa-srs-srv2-"));
  const memory = mkdtempSync(join(tmpdir(), "oa-srs-mem2-"));
  await writeNote(vault, "m.md", "#flashcards\n\n2+2::4");
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const due = await (await fetch(`${base}/cards/due`)).json();
    expect(due.length).toBe(1);
    const id = due[0].id;
    const res = await fetch(`${base}/cards/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, response: "good" }),
    });
    expect(res.ok).toBe(true);
    const text = await readNote(vault, "m.md");
    expect(text).toContain("<!--SR:");
  } finally {
    server.stop(true);
  }
});

test("GET /cards/all returns every card regardless of due date", async () => {
  const vault = mkdtempSync(join(tmpdir(), "oa-srs-all-"));
  const memory = mkdtempSync(join(tmpdir(), "oa-srs-all-mem-"));
  await writeNote(vault, "m.md", "#flashcards\n\na::b\n\nc::d <!--SR:!2099-01-01,5,250-->");
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const all = await (await fetch(`${base}/cards/all`)).json();
    expect(all.length).toBe(2);
  } finally {
    server.stop(true);
  }
});

test("POST /cards/review with an unknown card id returns 404", async () => {
  const vault = mkdtempSync(join(tmpdir(), "oa-srs-bad-"));
  const memory = mkdtempSync(join(tmpdir(), "oa-srs-bad-mem-"));
  await writeNote(vault, "m.md", "#flashcards\n\na::b");
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const res = await fetch(`${base}/cards/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "m.md::99::0", response: "good" }),
    });
    expect(res.status).toBe(404);
  } finally {
    server.stop(true);
  }
});

test("GET /cards/note returns all cards for one note (tagless ok)", async () => {
  const vault = mkdtempSync(join(tmpdir(), "oa-srs-note-"));
  const memory = mkdtempSync(join(tmpdir(), "oa-srs-note-mem-"));
  await writeNote(vault, "n.md", "a::b\n\nc::d");
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const cards = await (await fetch(`${base}/cards/note?path=${encodeURIComponent("n.md")}`)).json();
    expect(cards.length).toBe(2);
  } finally {
    server.stop(true);
  }
});

test("GET /events frame includes the changed path on mutation", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    // Prime — gets headers flushed so the SSE response actually starts streaming.
    await fetch(`${base}/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "prime-paths.md", kind: "file" }),
    });
    const res = await fetch(`${base}/events`);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    // Trigger another mutation we'll wait for.
    await fetch(`${base}/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "tracked-path.md", kind: "file" }),
    });

    let buf = "";
    const start = Date.now();
    while (Date.now() - start < 2000) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value);
      // Walk frames; only look at data frames (skip heartbeat comments).
      const frames = buf.split("\n\n");
      buf = frames.pop() ?? "";
      for (const f of frames) {
        if (!f.startsWith("data: ")) continue;
        const payload = JSON.parse(f.slice(6));
        if (Array.isArray(payload.paths) && payload.paths.includes("tracked-path.md")) {
          expect(typeof payload.version).toBe("number");
          expect(payload.paths).toContain("tracked-path.md");
          await reader.cancel();
          return;
        }
      }
    }
    throw new Error(`no SSE frame mentioned tracked-path.md; buf=${buf}`);
  } finally {
    server.stop(true);
  }
});

import { initializeSettings } from "../src/settings";
import { rmSync, existsSync } from "node:fs";

test("GET /settings returns parsed app settings with defaults", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const s = await (await fetch(`${base}/settings`)).json();
    expect(s.appearance.theme).toBe("oxide-duotone");
    expect(s.graph.nodeSize).toBe(6);
    expect(s.properties).toBeUndefined();
  } finally {
    server.stop(true);
  }
});

test("GET /schema returns the property registry from settings.yaml", async () => {
  const { vault, memory } = await makeSampleVault();
  await writeNote(vault, "settings.yaml", "properties:\n  due: date\n  rating: number\n");
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const schema = await (await fetch(`${base}/schema`)).json();
    expect(schema.due.type).toBe("date");
    expect(schema.rating.type).toBe("number");
  } finally {
    server.stop(true);
  }
});

test("createServer writes a settings.yaml on boot when missing", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  try {
    // initializeSettings is fire-and-forget on boot; allow the write to land.
    await initializeSettings(vault); // idempotent — ensures the file is present
    const exists = await Bun.file(join(vault, "settings.yaml")).exists();
    expect(exists).toBe(true);
  } finally {
    server.stop(true);
  }
});

test("GET /file materializes settings.yaml from defaults when missing at read time", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    // Defeat the fire-and-forget boot init so the file is genuinely absent at the
    // moment of the read — the exact state a stale/never-booted server leaves behind.
    await initializeSettings(vault); // drain any pending boot write deterministically
    rmSync(join(vault, "settings.yaml"));
    const res = await fetch(`${base}/file?path=settings.yaml`);
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).toContain("appearance:"); // default content, not a blank editor
    expect(text).toContain("theme: oxide-duotone");
    expect(existsSync(join(vault, "settings.yaml"))).toBe(true); // recreated on disk
  } finally {
    server.stop(true);
  }
});

test("editing settings.yaml refreshes GET /schema without restart", async () => {
  const { vault, memory } = await makeSampleVault();
  await writeNote(vault, "settings.yaml", "properties:\n  due: date\n");
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const before = await (await fetch(`${base}/schema`)).json();
    expect(before.due.type).toBe("date");
    expect(before.rating).toBeUndefined();

    // Rewrite via PUT /file (the path the frontend uses) then poll the schema.
    await fetch(`${base}/file`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "settings.yaml", contents: "properties:\n  rating: number\n" }),
    });

    const after = await (await fetch(`${base}/schema`)).json();
    expect(after.rating.type).toBe("number");
    expect(after.due).toBeUndefined();
  } finally {
    server.stop(true);
  }
});

test("GET /events streams a version event after a mutating call", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    // Prime the version counter so the server sends an immediate snapshot when the
    // SSE stream connects. Without this, Bun won't flush response headers until the
    // first enqueue — causing `await fetch('/events')` to hang.
    await fetch(`${base}/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "prime.md", kind: "file" }),
    });

    const res = await fetch(`${base}/events`);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    // Read until we see a data frame with a version number (the initial snapshot).
    let buf = "";
    const start = Date.now();
    while (Date.now() - start < 2000) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value);
      const m = buf.match(/data: (\{.*?\})\n\n/);
      if (m) {
        const payload = JSON.parse(m[1]);
        expect(typeof payload.version).toBe("number");
        expect(payload.version).toBeGreaterThan(0);
        await reader.cancel();
        return;
      }
    }
    throw new Error(`no SSE event received; buffer: ${buf}`);
  } finally {
    server.stop(true);
  }
});

test("GET /base returns config + rows for a type:base file", async () => {
  const { vault, memory } = await makeSampleVault();
  await writeNote(vault, "Cal.md", "---\ntype: base\nview: calendar\n---\n\n| title | date |\n| --- | --- |\n| X | 2026-06-01 |");
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const res = await fetch(`${base}/base?file=Cal.md`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.config.views[0].type).toBe("calendar");
    expect(data.rows[0].note.title).toBe("X");
    const missing = await fetch(`${base}/base?file=Nope.md`);
    expect(missing.status).toBe(404);
  } finally {
    server.stop(true);
  }
});

test("POST /row/update edits a base row and bumps version", async () => {
  const { vault, memory } = await makeSampleVault();
  await writeNote(vault, "Cal.md", "---\ntype: base\nview: table\n---\n\n| id | title |\n| --- | --- |\n| 1 | A |");
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const v0 = (await (await fetch(`${base}/version`)).json()).version;
    const res = await fetch(`${base}/row/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file: "Cal.md", index: 0, note: { id: 1, title: "Z" } }),
    });
    expect(res.ok).toBe(true);
    const data = await (await fetch(`${base}/base?file=Cal.md`)).json();
    expect(data.rows[0].note.title).toBe("Z");
    const v1 = (await (await fetch(`${base}/version`)).json()).version;
    expect(v1).toBeGreaterThan(v0);
  } finally {
    server.stop(true);
  }
});

test("POST /row/update appends a new row when index is null", async () => {
  const { vault, memory } = await makeSampleVault();
  await writeNote(vault, "Cal.md", "---\ntype: base\nview: table\n---\n\n| id | title |\n| --- | --- |\n| 1 | A |");
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    await fetch(`${base}/row/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file: "Cal.md", index: null, note: { id: 2, title: "B" } }),
    });
    const data = await (await fetch(`${base}/base?file=Cal.md`)).json();
    expect(data.rows.length).toBe(2);
    expect(data.rows[1].note.title).toBe("B");
  } finally {
    server.stop(true);
  }
});

test("POST /cards/review (row-based) advances a flashcard base row", async () => {
  const { vault, memory } = await makeSampleVault();
  await writeNote(vault, "Deck.md", "---\ntype: base\nview: flashcards\n---\n\n| front | back | due | ease | interval |\n| --- | --- | --- | --- | --- |\n| 2+2 | 4 |  | 250 | 0 |");
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const res = await fetch(`${base}/cards/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file: "Deck.md", index: 0, response: "good" }),
    });
    expect(res.ok).toBe(true);
    const data = await (await fetch(`${base}/base?file=Deck.md`)).json();
    expect(data.rows[0].note.interval).toBe(1);
    expect(typeof data.rows[0].note.due).toBe("string");
  } finally {
    server.stop(true);
  }
});

test("POST /rows resolves a scoped-tasks spec via base composition", async () => {
  const vault = mkdtempSync(join(tmpdir(), "oa-rows-"));
  const memory = mkdtempSync(join(tmpdir(), "oa-rows-mem-"));
  await writeNote(vault, "Keep.md", '---\ntype: base\nsource: notes\nwhere: file.hasTag("keep")\n---\n');
  await writeNote(vault, "keep/x.md", "---\ntags: [keep]\n---\n- [ ] scoped task");
  await writeNote(vault, "other/y.md", "- [ ] unscoped task");
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const rows = await (
      await fetch(`${base}/rows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec: { kind: "tasks", from: "[[Keep]]" } }),
      })
    ).json();
    expect(rows.map((r: any) => r.note.description)).toEqual(["scoped task"]);
  } finally {
    server.stop(true);
  }
});

test("POST /set-setting merges one key and preserves the rest of settings.yaml", async () => {
  const { vault } = await makeSampleVault();
  // Seed a settings.yaml with a comment + a custom key + the properties registry.
  await writeNote(vault, "settings.yaml", "# my settings\nappearance:\n  theme: oxide-duotone\n  myCustom: 7\nproperties:\n  due: date\n");
  const server = createServer({ vault, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const res = await fetch(`${base}/set-setting`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: ["appearance", "editorFont"], value: "Georgia" }),
    });
    expect(res.status).toBe(200);

    const settings = await (await fetch(`${base}/settings`)).json();
    expect(settings.appearance.editorFont).toBe("Georgia"); // changed key
    expect(settings.appearance.theme).toBe("oxide-duotone"); // reconciled default present

    const raw = await readNote(vault, "settings.yaml");
    expect(raw).toContain("# my settings");                // comment preserved
    expect(raw).toContain("myCustom: 7");                  // unknown key preserved
    expect(raw).toContain("due: date");                    // properties registry preserved
  } finally {
    server.stop(true);
  }
});

test("POST /set-setting rejects a non-array path with 400", async () => {
  const { vault } = await makeSampleVault();
  const server = createServer({ vault, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const res = await fetch(`${base}/set-setting`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "appearance.theme", value: "light" }),
    });
    expect(res.status).toBe(400);
  } finally {
    server.stop(true);
  }
});

test("GET /templates lists .md files in the templates folder", async () => {
  const { vault, memory } = await makeSampleVault();
  await writeNote(vault, "Templates/Daily.md", "# {{date}}\n");
  await writeNote(vault, "Templates/Meeting.md", "# Meeting\n");
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const list = await (await fetch(`${base}/templates`)).json();
    const names = list.map((t: any) => t.name).sort();
    expect(names).toEqual(["Daily", "Meeting"]);
    expect(list.find((t: any) => t.name === "Daily").path).toBe("Templates/Daily.md");
  } finally {
    server.stop(true);
  }
});

test("GET /templates returns [] when the folder is absent", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const list = await (await fetch(`${base}/templates`)).json();
    expect(list).toEqual([]);
  } finally {
    server.stop(true);
  }
});

test("POST /daily-note creates today's note from the template, then reopens it without clobbering", async () => {
  const vault = mkdtempSync(join(tmpdir(), "oa-daily-"));
  await writeNote(vault, "settings.yaml", [
    "dailyNotes:",
    "  - id: journal",
    "    label: Journal",
    "    icon: BookOpen",
    "    folder: Journal",
    '    fileName: "{{date}} journal"',
    "    template: Templates/Journal.md",
  ].join("\n"));
  await writeNote(vault, "Templates/Journal.md", "# {{title}}\n\n");
  const server = createServer({ vault, port: 0 });
  const base = `http://localhost:${server.port}`;
  const call = (id: string) => fetch(`${base}/daily-note`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }),
  });
  try {
    const r1 = await (await call("journal")).json();
    expect(r1.created).toBe(true);
    expect(r1.path).toMatch(/^Journal\/\d{4}-\d{2}-\d{2} journal\.md$/);
    const titleBase = r1.path.replace(/^Journal\//, "").replace(/\.md$/, "");
    expect(await readNote(vault, r1.path)).toBe(`# ${titleBase}\n\n`);

    await writeNote(vault, r1.path, "my entry");      // user edits today's note
    const r2 = await (await call("journal")).json();  // pressing again must reopen, not clobber
    expect(r2).toEqual({ path: r1.path, created: false });
    expect(await readNote(vault, r1.path)).toBe("my entry");

    const r3 = await call("does-not-exist");           // unknown id → 400
    expect(r3.status).toBe(400);
  } finally {
    server.stop(true);
  }
});

test("GET /graph/views returns 2nd/3rd-brain view layouts", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const views = await fetch(`${base}/graph/views`).then((r) => r.json());
    expect(views).toHaveProperty("second");
    expect(views).toHaveProperty("third");
    expect(typeof views.second.pos3d).toBe("object");
    expect(typeof views.second.pos2d).toBe("object");
    expect(typeof views.third.pos3d).toBe("object");
    expect(typeof views.third.pos2d).toBe("object");
  } finally {
    server.stop(true);
  }
});

test("after /graph/views, /graph includes the view layouts", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    await fetch(`${base}/graph/views`).then((r) => r.json());
    const g = await fetch(`${base}/graph`).then((r) => r.json());
    expect(g.views).toBeDefined();
    expect(g.views.second).toBeDefined();
    expect(g.views.third).toBeDefined();
  } finally {
    server.stop(true);
  }
});

test("GET /graph is consistent across concurrent requests", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const [a, b] = await Promise.all([
      fetch(`${base}/graph`).then((r) => r.json()),
      fetch(`${base}/graph`).then((r) => r.json()),
    ]);
    expect(a.nodes.length).toBe(b.nodes.length);
    expect(a.edges.length).toBe(b.edges.length);
  } finally {
    server.stop(true);
  }
});

test("a structural mutation invalidates the cached /graph", async () => {
  const { vault, memory } = await makeSampleVault();
  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const before = await fetch(`${base}/graph`).then((r) => r.json());
    await fetch(`${base}/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "brand-new-note-mutation-test.md", kind: "file" }),
    });
    const after = await fetch(`${base}/graph`).then((r) => r.json());
    expect(after.nodes.length).toBe(before.nodes.length + 1);
  } finally {
    server.stop(true);
  }
});

test("POST /set-setting serializes concurrent requests without clobbering changes", async () => {
  const { vault } = await makeSampleVault();
  // Seed settings with multiple keys
  await writeNote(vault, "settings.yaml", "appearance:\n  theme: oxide-duotone\n  editorFont: Lora\ngraph:\n  nodeSize: 5\n");
  const server = createServer({ vault, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    // Fire 3 concurrent POST /set-setting requests that each modify a different key
    const requests = [
      fetch(`${base}/set-setting`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: ["appearance", "theme"], value: "indigo-oxide" }),
      }),
      fetch(`${base}/set-setting`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: ["appearance", "editorFont"], value: "Georgia" }),
      }),
      fetch(`${base}/set-setting`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: ["graph", "nodeSize"], value: 10 }),
      }),
    ];

    const responses = await Promise.all(requests);
    expect(responses.every((r) => r.status === 200)).toBe(true);

    // Verify all three changes were persisted (none clobbered)
    const settings = await (await fetch(`${base}/settings`)).json();
    expect(settings.appearance.theme).toBe("indigo-oxide");
    expect(settings.appearance.editorFont).toBe("Georgia");
    expect(settings.graph.nodeSize).toBe(10);
  } finally {
    server.stop(true);
  }
});

test("daemon routes: status + devices read shared state, owner round-trips", async () => {
  const { vault, memory } = await makeSampleVault();
  // Point the daemon home at a tmp dir with fake state so the routes are deterministic.
  const home = mkdtempSync(join(tmpdir(), "claude-bot-"));
  const { writeFileSync } = await import("node:fs");
  writeFileSync(join(home, "device-id"), "dev-a");
  writeFileSync(
    join(home, "devices.json"),
    JSON.stringify({
      "dev-a": { label: "laptop", lastSeenISO: "2026-06-01T00:00:00.000Z" },
      "dev-b": { label: "desktop", lastSeenISO: "2026-06-02T00:00:00.000Z" },
    }),
  );
  const prev = process.env.OA_CLAUDEBOT_HOME;
  process.env.OA_CLAUDEBOT_HOME = home;

  const server = createServer({ vault, memory, port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const status = await (await fetch(`${base}/daemon/status`)).json();
    expect(status.running).toBe(false); // no daemon.pid written
    expect(status.thisDeviceId).toBe("dev-a");
    expect(status.owner).toBeNull(); // unclaimed

    const devices = await (await fetch(`${base}/daemon/devices`)).json();
    expect(devices.ownerDeviceId).toBeNull();
    expect(devices.devices.map((d: any) => d.deviceId).sort()).toEqual(["dev-a", "dev-b"]);

    // Claim dev-b as owner; the response + a follow-up read both reflect it.
    const claimed = await (
      await fetch(`${base}/daemon/owner`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: "dev-b" }),
      })
    ).json();
    expect(claimed.ownerDeviceId).toBe("dev-b");
    expect(claimed.ownerLabel).toBe("desktop");
    expect(Object.keys(claimed).sort()).toEqual(["ownerDeviceId", "ownerLabel", "updatedAt"]);

    const after = await (await fetch(`${base}/daemon/status`)).json();
    expect(after.owner.ownerDeviceId).toBe("dev-b");

    // An unknown device is rejected with a 400.
    const bad = await fetch(`${base}/daemon/owner`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: "nope" }),
    });
    expect(bad.status).toBe(400);
  } finally {
    server.stop(true);
    if (prev === undefined) delete process.env.OA_CLAUDEBOT_HOME;
    else process.env.OA_CLAUDEBOT_HOME = prev;
  }
});
