// Visual spec for <DaemonList> — the daemon-mode sidebar panel: cron/process rows with live
// status, grouped under "Crons"/"Processes" section heads. Right-click opens the shared
// <ContextMenu> (Run now / Enable / Disable) via `openContextMenu`, which always falls back to
// the HTML menu outside Tauri (`nativeMenu.ts`) — no native-menu dependency to fake here. Row
// actions POST to /daemon/*/toggle|run, which the shared fakeTransport acks generically (a
// 200 "ok" Response), so the menu items work as real callbacks, not just visual props.
//
// `sampleGraphNode()` (app/src/ui/_graphFixtures.ts) defaults to kind "note"; overridden here
// with "cron"/"process" + a `daemon` viz-state object (core/src/graph.ts's DaemonVizState) —
// the same shape core/src/daemonGraph.ts attaches to real nodes in daemon-mode graphs.
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { DaemonList } from "./DaemonList";
import { sampleGraphNode } from "./ui/_graphFixtures";
import type { GraphNode } from "../../core/src/graph";

const NOW = Date.now();
const MIN = 60 * 1000;

const NODES: GraphNode[] = [
  sampleGraphNode({
    id: "cron:dream",
    label: "dream",
    kind: "cron",
    daemon: { enabled: true, running: true, lastResult: "success", lastFiredMs: NOW - 3 * MIN, schedule: "0 * * * *" },
  }),
  sampleGraphNode({
    id: "cron:vault-review",
    label: "vault-review",
    kind: "cron",
    daemon: { enabled: true, running: false, lastResult: "success", lastFiredMs: NOW - 90 * MIN, schedule: "0 */4 * * *" },
  }),
  sampleGraphNode({
    id: "cron:gcal-sync",
    label: "gcal-sync",
    kind: "cron",
    daemon: { enabled: true, running: false, lastResult: "failed", lastFiredMs: NOW - 6 * 60 * MIN, schedule: "*/15 * * * *" },
  }),
  sampleGraphNode({
    id: "cron:legacy-digest",
    label: "legacy-digest",
    kind: "cron",
    daemon: { enabled: false, running: false, lastResult: null, lastFiredMs: null, schedule: "0 9 * * 1" },
  }),
  sampleGraphNode({
    id: "process:relay-watch",
    label: "relay-watch",
    kind: "process",
    daemon: { enabled: true, running: true, lastResult: null, lastFiredMs: null },
  }),
  sampleGraphNode({
    id: "process:backup-watch",
    label: "backup-watch",
    kind: "process",
    daemon: { enabled: false, running: false, lastResult: null, lastFiredMs: null },
  }),
];

const meta = {
  title: "App/DaemonList",
  component: DaemonList,
  parameters: { layout: "padded" },
} satisfies Meta<typeof DaemonList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A mix of crons and processes across every status: running (glowing dot), idle,
 *  last-run-failed, and disabled (dimmed). */
export const Default: Story = {
  render: () => (
    <div style={{ width: "260px" }}>
      <DaemonList nodes={NODES} onFocus={() => {}} onChanged={() => {}} />
    </div>
  ),
};

/** No crons or processes configured — the panel's empty message. */
export const Empty: Story = {
  render: () => (
    <div style={{ width: "260px" }}>
      <DaemonList nodes={[]} onFocus={() => {}} onChanged={() => {}} />
    </div>
  ),
};
