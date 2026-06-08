import type { CommandMap } from "../types";
import { requireVault, memoryDir, out } from "../args";
import { buildGraph } from "../../../core/src/engine";

export const commands: CommandMap = {
  graph: {
    summary: "Build the knowledge graph (vault + optional memory) and print it as JSON",
    usage: "[--vault <dir>] [--memory <dir>] [--pretty]",
    run: async (args) => {
      const graph = await buildGraph(requireVault(args), memoryDir(args));
      out(graph, args);
    },
  },
};
