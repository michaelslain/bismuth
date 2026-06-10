// app/src/DaemonList.tsx
// Daemon-mode sidebar panel: lists cron and process nodes with live status.
// Replaces the community ClusterLegend when graph mode is "daemon".
//
// Right-clicking a row opens the app's shared context menu (openContextMenu →
// native menu in Tauri, else the HTML <ContextMenu>) to enable/disable a cron or
// process and run a cron on command. Actions hit the /daemon/* write routes, toast
// the result, and ask the parent to re-poll the graph so the row updates at once.
import { For, Show, createMemo, createSignal } from "solid-js";
import { Portal } from "solid-js/web";
import type { GraphNode } from "../../core/src/graph";
import { openContextMenu } from "./nativeMenu";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { api } from "./api";
import { pushToast } from "./Toast";
import { relTimeMs } from "./relTime";

/** Convert a 5-part cron expression to a short human-readable frequency string. */
function cronFrequency(expr: string): string {
  if (!expr) return "";
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return expr;
  const [min, hour, dom, , dow] = parts;

  // Every N minutes: */N * * * *
  if (min.startsWith("*/") && hour === "*" && dom === "*" && dow === "*") {
    const n = parseInt(min.slice(2));
    return n === 1 ? "every min" : `every ${n}m`;
  }
  // Every minute: * * * * *
  if (min === "*" && hour === "*" && dom === "*" && dow === "*") return "every min";
  // Every N hours: 0 */N * * *
  if (min === "0" && hour.startsWith("*/") && dom === "*" && dow === "*") {
    const n = parseInt(hour.slice(2));
    return n === 1 ? "hourly" : `every ${n}h`;
  }
  // Hourly: 0 * * * *
  if (min === "0" && hour === "*" && dom === "*" && dow === "*") return "hourly";
  // Every N days: M H */N * *
  if (dom.startsWith("*/") && dow === "*") {
    const n = parseInt(dom.slice(2));
    return n === 1 ? "daily" : `every ${n}d`;
  }
  // Daily: 0 H * * *  or  H H * * *
  if (
    dom === "*" &&
    dow === "*" &&
    !hour.includes("*") &&
    !hour.includes("/") &&
    !min.includes("*") &&
    !min.includes("/")
  )
    return "daily";
  // Weekly: specific day of week
  if (dow !== "*" && !dow.includes("*") && !dow.includes("/")) return "weekly";
  // Monthly: specific day of month
  if (dom !== "*" && !dom.includes("*") && !dom.includes("/") && dow === "*") return "monthly";
  return expr;
}

type StatusKey = "running" | "failed" | "idle" | "disabled";

function nodeStatus(node: GraphNode): StatusKey {
  const d = node.daemon;
  if (!d || !d.enabled) return "disabled";
  if (d.running) return "running";
  if (d.lastResult === "failed") return "failed";
  return "idle";
}

const STATUS_DOT: Record<StatusKey, string> = {
  running: "var(--accent)",
  failed: "#e06c75",
  idle: "var(--text-muted)",
  disabled: "var(--text-muted)",
};

function statusLabel(node: GraphNode): string {
  const d = node.daemon;
  if (!d || !d.enabled) return "off";
  if (d.running) return "running";
  if (d.lastFiredMs !== null) return relTimeMs(d.lastFiredMs);
  return "never";
}

function CronRow(props: {
  node: GraphNode;
  onFocus: (ids: string[]) => void;
  onMenu: (node: GraphNode, e: MouseEvent) => void;
}) {
  const status = () => nodeStatus(props.node);
  const freq = () => {
    const s = props.node.daemon?.schedule;
    return s ? cronFrequency(s) : "";
  };
  return (
    <div
      class="daemon-row"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => props.onFocus([props.node.id])}
      onContextMenu={(e) => props.onMenu(props.node, e)}
      style={{ opacity: status() === "disabled" ? 0.45 : 1 }}
    >
      <span
        style={{
          width: "7px",
          height: "7px",
          "border-radius": "50%",
          background: STATUS_DOT[status()],
          "flex-shrink": 0,
          "box-shadow": status() === "running" ? "0 0 4px var(--accent)" : "none",
        }}
      />
      <span class="daemon-row-label">
        {props.node.label}
      </span>
      <Show when={freq()}>
        <span
          style={{
            "font-size": "10px",
            color: "var(--text-muted)",
            "white-space": "nowrap",
            "flex-shrink": 0,
            opacity: 0.7,
          }}
        >
          {freq()}
        </span>
      </Show>
      <span
        style={{
          "font-size": "10px",
          color:
            status() === "running"
              ? "var(--accent)"
              : status() === "failed"
                ? "#e06c75"
                : "var(--text-muted)",
          "white-space": "nowrap",
          "flex-shrink": 0,
        }}
      >
        {statusLabel(props.node)}
      </span>
    </div>
  );
}

function ProcessRow(props: {
  node: GraphNode;
  onFocus: (ids: string[]) => void;
  onMenu: (node: GraphNode, e: MouseEvent) => void;
}) {
  const enabled = () => props.node.daemon?.enabled !== false;
  return (
    <div
      class="daemon-row"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => props.onFocus([props.node.id])}
      onContextMenu={(e) => props.onMenu(props.node, e)}
      style={{ opacity: enabled() ? 1 : 0.45 }}
    >
      <span
        style={{
          width: "7px",
          height: "7px",
          "border-radius": "50%",
          background: enabled() ? "var(--accent)" : "var(--text-muted)",
          "flex-shrink": 0,
        }}
      />
      <span class="daemon-row-label">
        {props.node.label}
      </span>
      <span
        style={{
          "font-size": "10px",
          color: enabled() ? "var(--accent)" : "var(--text-muted)",
          "white-space": "nowrap",
          "flex-shrink": 0,
        }}
      >
        {enabled() ? "on" : "off"}
      </span>
    </div>
  );
}

export function DaemonList(props: {
  nodes: GraphNode[];
  onFocus: (ids: string[]) => void;
  /** Re-poll the daemon graph after an action so the row reflects it immediately. */
  onChanged?: () => void;
}) {
  const crons = createMemo(() => props.nodes.filter((n) => n.kind === "cron"));
  const processes = createMemo(() => props.nodes.filter((n) => n.kind === "process"));
  const empty = createMemo(() => crons().length === 0 && processes().length === 0);

  const [menu, setMenu] = createSignal<{ x: number; y: number; items: MenuItem[] } | null>(null);

  /** The name claude-bot keys on = the node label (frontmatter name ?? filename). */
  const nameOf = (node: GraphNode) => node.label;

  async function toggleEnabled(node: GraphNode) {
    const enabled = node.daemon?.enabled !== false;
    const verb = enabled ? "Disabled" : "Enabled";
    const call = node.kind === "cron" ? api.setCronEnabled : api.setProcessEnabled;
    const res = await call(nameOf(node), !enabled);
    if (res.ok) {
      pushToast(`${verb} ${node.label}`);
      props.onChanged?.();
    } else {
      pushToast(`Couldn't ${enabled ? "disable" : "enable"} ${node.label}`);
    }
  }

  async function runNow(node: GraphNode) {
    const res = await api.runCron(nameOf(node));
    if (res.ok) {
      pushToast(`Triggered ${node.label}`);
      // The daemon fires it on its next poll (~5s); nudge a refresh so the row's
      // "running" state shows up shortly after.
      setTimeout(() => props.onChanged?.(), 600);
    } else {
      pushToast(`Couldn't run ${node.label}`);
    }
  }

  function itemsFor(node: GraphNode): MenuItem[] {
    const enabled = node.daemon?.enabled !== false;
    const toggle: MenuItem = enabled
      ? { label: "Disable", icon: "PowerOff", onSelect: () => void toggleEnabled(node) }
      : { label: "Enable", icon: "Power", onSelect: () => void toggleEnabled(node) };
    if (node.kind === "cron") {
      return [
        {
          label: "Run now",
          icon: "Play",
          // claude-bot ignores a run trigger for an already-running job.
          disabled: node.daemon?.running === true,
          onSelect: () => void runNow(node),
        },
        { ...toggle, separatorBefore: true },
      ];
    }
    return [toggle];
  }

  const openMenu = (node: GraphNode, e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openContextMenu(e.clientX, e.clientY, itemsFor(node), setMenu);
  };

  return (
    <div class="daemon-list">
      <Show when={empty()}>
        <div style={{ padding: "8px 6px", color: "var(--text-muted)", "font-size": "11px" }}>
          No daemons configured
        </div>
      </Show>
      <Show when={crons().length > 0}>
        <div class="daemon-section-head">
          Crons <span style={{ opacity: 0.6 }}>{crons().length}</span>
        </div>
        <For each={crons()}>{(node) => <CronRow node={node} onFocus={props.onFocus} onMenu={openMenu} />}</For>
      </Show>
      <Show when={processes().length > 0}>
        <div
          class="daemon-section-head"
          style={{ "margin-top": crons().length > 0 ? "4px" : "0" }}
        >
          Processes <span style={{ opacity: 0.6 }}>{processes().length}</span>
        </div>
        <For each={processes()}>{(node) => <ProcessRow node={node} onFocus={props.onFocus} onMenu={openMenu} />}</For>
      </Show>
      <Show when={menu()}>
        {(m) => (
          // Portal to <body>: the menu is `position: fixed`, but `.graph-legend-card`'s
          // backdrop-filter makes it a containing block — without the portal the menu
          // would be positioned relative to the card, not the viewport (lands off-cursor).
          <Portal>
            <ContextMenu x={m().x} y={m().y} items={m().items} onClose={() => setMenu(null)} />
          </Portal>
        )}
      </Show>
    </div>
  );
}
