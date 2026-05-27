import { test, expect } from "bun:test";
import { createServer } from "../src/server";

test("GET /graph returns the merged brain graph", async () => {
  const server = createServer({ vault: "sample-vault", memory: "sample-vault/.memory", port: 0 });
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
  const server = createServer({ vault: "sample-vault", memory: "sample-vault/.memory", port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const cfg = await (await fetch(`${base}/config`)).json();
    expect(cfg).toEqual({ vault: "sample-vault", memory: "sample-vault/.memory" });
  } finally {
    server.stop(true);
  }
});

test("GET /agent-graph returns an object with nodes and edges arrays", async () => {
  const server = createServer({ vault: "sample-vault", memory: "sample-vault/.memory", port: 0 });
  const base = `http://localhost:${server.port}`;
  try {
    const ag = await (await fetch(`${base}/agent-graph`)).json();
    expect(Array.isArray(ag.nodes)).toBe(true);
    expect(Array.isArray(ag.edges)).toBe(true);
  } finally {
    server.stop(true);
  }
});
