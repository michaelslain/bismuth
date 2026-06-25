import { readFileSync, writeFileSync } from "node:fs";
import type { CommandMap } from "../types";
import { bool, flag, positionals, fail, out } from "../args";
import { parseDoc } from "../../../core/src/drawing/model";
import { renderDocToPng, renderDocToPdf } from "../../../core/src/drawing/export";

async function render(args: string[]): Promise<void> {
  const [file] = positionals(args);
  if (!file) fail("usage: <file.draw> [--pdf] [--out FILE]");
  const pdf = bool(args, "pdf");
  const doc = parseDoc(readFileSync(file, "utf8"));
  const bytes = pdf ? await renderDocToPdf(doc, "dark") : await renderDocToPng(doc, "dark");
  const outPath = flag(args, "out") ?? `${file}.${pdf ? "pdf" : "png"}`;
  writeFileSync(outPath, bytes);
  out(`wrote ${outPath}`, args);
}

export const commands: CommandMap = {
  render: {
    summary: "Render a .draw file to PNG (or --pdf), headless",
    usage: "<file.draw> [--pdf] [--out FILE]",
    run: render,
  },
};
