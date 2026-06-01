import { buildGraph } from "../../core/src/engine";
import { commitVault, snapshotMessage } from "../../core/src/backup";
import { createServer, cliArg } from "../../core/src/server";
import { parseDoc } from "../../core/src/drawing/model";
import { renderDocToPng, renderDocToPdf } from "../../core/src/drawing/export";
import { readFileSync, writeFileSync } from "node:fs";

const USAGE = "usage: oa <graph|backup|serve|render> --vault <dir> [--memory <dir>] [--port n]";

function fail(): never {
  console.error(USAGE);
  process.exit(1);
}

const cmd = Bun.argv[2];
const args = Bun.argv.slice(3);

if (cmd === "render") {
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) {
    console.error("usage: oa render <path.draw> [--pdf|--png] [--out <file>]");
    process.exit(1);
  }
  const pdf = args.includes("--pdf");
  const doc = parseDoc(readFileSync(file, "utf8"));
  const bytes = pdf ? await renderDocToPdf(doc, "dark") : await renderDocToPng(doc, "dark");
  const outIdx = args.indexOf("--out");
  const out = outIdx !== -1 ? args[outIdx + 1] : `${file}.${pdf ? "pdf" : "png"}`;
  writeFileSync(out, bytes);
  console.log(`wrote ${out}`);
} else {
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
}
