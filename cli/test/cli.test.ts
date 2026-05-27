import { test, expect } from "bun:test";

test("`oa graph --vault test/fixtures/sample-vault` prints graph JSON with the self node", async () => {
  const proc = Bun.spawn(["bun", "run", "cli/src/index.ts", "graph", "--vault", "test/fixtures/sample-vault"], {
    stdout: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  const g = JSON.parse(out);
  expect(g.nodes.some((n: any) => n.id === "self")).toBe(true);
  expect(g.nodes.some((n: any) => n.id === "internship")).toBe(true);
});
