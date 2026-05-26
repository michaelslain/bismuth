import { buildGraph } from "../../core/src/engine";
import { commitVault } from "../../core/src/backup";
import { createServer } from "../../core/src/server";

function arg(k: string): string | undefined {
  const i = Bun.argv.indexOf(`--${k}`);
  return i >= 0 ? Bun.argv[i + 1] : undefined;
}

const cmd = Bun.argv[2];
const vault = arg("vault") ?? "sample-vault";
const memory = arg("memory");

if (cmd === "graph") {
  console.log(JSON.stringify(await buildGraph(vault, memory), null, 2));
} else if (cmd === "backup") {
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const committed = await commitVault(vault, `vault snapshot ${stamp}`);
  console.log(committed ? "committed" : "nothing to commit");
} else if (cmd === "serve") {
  const s = createServer({ vault, memory, port: arg("port") ? Number(arg("port")) : 4321 });
  console.log(`core listening on http://localhost:${s.port}`);
} else {
  console.error("usage: oa <graph|backup|serve> --vault <dir> [--memory <dir>] [--port n]");
  process.exit(1);
}
