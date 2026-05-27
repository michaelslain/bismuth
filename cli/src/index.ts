import { buildGraph } from "../../core/src/engine";
import { commitVault, snapshotMessage } from "../../core/src/backup";
import { createServer, cliArg } from "../../core/src/server";

const USAGE = "usage: oa <graph|backup|serve> --vault <dir> [--memory <dir>] [--port n]";

function fail(): never {
  console.error(USAGE);
  process.exit(1);
}

const cmd = Bun.argv[2];
const vault = cliArg("vault");
const memory = cliArg("memory");

if (!vault) fail();

if (cmd === "graph") {
  console.log(JSON.stringify(await buildGraph(vault, memory), null, 2));
} else if (cmd === "backup") {
  const committed = await commitVault(vault, snapshotMessage());
  console.log(committed ? "committed" : "nothing to commit");
} else if (cmd === "serve") {
  const port = cliArg("port");
  const s = createServer({ vault, memory, port: port ? Number(port) : 4321 });
  console.log(`core listening on http://localhost:${s.port}`);
} else {
  fail();
}
