import { test, expect } from "bun:test";
import { makeSampleVault } from "../../core/test/helpers";

test("`oa graph --vault <dir>` prints graph JSON with the self + vault nodes", async () => {
  const { vault } = await makeSampleVault();
  const proc = Bun.spawn(["bun", "run", "cli/src/index.ts", "graph", "--vault", vault], {
    stdout: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  const g = JSON.parse(out);
  expect(g.nodes.some((n: any) => n.id === "self")).toBe(true);
  expect(g.nodes.some((n: any) => n.id === "internship")).toBe(true);
});
