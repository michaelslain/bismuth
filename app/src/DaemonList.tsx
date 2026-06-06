// app/src/DaemonList.tsx
// Daemon-mode sidebar panel: lists cron and process nodes with live status.
// Replaces the community ClusterLegend when graph mode is "daemon".
import { For, Show, createMemo } from "solid-js";
import type { GraphNode } from "../../core/src/graph";

function relTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

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
  if (dom === "*" && dow === "*" && !hour.includes("*") && !hour.includes("/")) return "daily";
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
  if (d.lastFiredMs !== null) return relTime(d.lastFiredMs);
  return "never";
}

function CronRow(props: { node: GraphNode; onFocus: (ids: string[]) => void }) {
  const status = () => nodeStatus(props.node);
  const freq = () => {
    const s = props.node.daemon?.schedule;
    return s ? cronFrequency(s) : "";
  };
  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => props.onFocus([props.node.id])}
      style={{
        display: "flex",
        "align-items": "center",
        gap: "7px",
        padding: "3px 6px",
        "border-radius": "3px",
        cursor: "pointer",
        opacity: status() === "disabled" ? 0.45 : 1,
      }}
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
      <span
        style={{
          flex: 1,
          "min-width": 0,
          overflow: "hidden",
          "text-overflow": "ellipsis",
          "white-space": "nowrap",
          color: "var(--fg)",
        }}
      >
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

function ProcessRow(props: { node: GraphNode; onFocus: (ids: string[]) => void }) {
  const enabled = () => props.node.daemon?.enabled !== false;
  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => props.onFocus([props.node.id])}
      style={{
        display: "flex",
        "align-items": "center",
        gap: "7px",
        padding: "3px 6px",
        "border-radius": "3px",
        cursor: "pointer",
        opacity: enabled() ? 1 : 0.45,
      }}
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
      <span
        style={{
          flex: 1,
          "min-width": 0,
          overflow: "hidden",
          "text-overflow": "ellipsis",
          "white-space": "nowrap",
          color: "var(--fg)",
        }}
      >
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
}) {
  const crons = createMemo(() => props.nodes.filter((n) => n.kind === "cron"));
  const processes = createMemo(() => props.nodes.filter((n) => n.kind === "process"));
  const empty = createMemo(() => crons().length === 0 && processes().length === 0);

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "1px",
        width: "100%",
        height: "100%",
        "overflow-y": "auto",
        "pointer-events": "auto",
        "font-family": "inherit",
        "font-size": "11px",
      }}
    >
      <Show when={empty()}>
        <div style={{ padding: "8px 6px", color: "var(--text-muted)", "font-size": "11px" }}>
          No daemons configured
        </div>
      </Show>
      <Show when={crons().length > 0}>
        <div
          style={{
            padding: "4px 6px 2px",
            "font-size": "10px",
            color: "var(--text-muted)",
            "text-transform": "uppercase",
            "letter-spacing": "0.06em",
            "font-weight": "600",
          }}
        >
          Crons <span style={{ opacity: 0.6 }}>{crons().length}</span>
        </div>
        <For each={crons()}>{(node) => <CronRow node={node} onFocus={props.onFocus} />}</For>
      </Show>
      <Show when={processes().length > 0}>
        <div
          style={{
            padding: "4px 6px 2px",
            "font-size": "10px",
            color: "var(--text-muted)",
            "text-transform": "uppercase",
            "letter-spacing": "0.06em",
            "font-weight": "600",
            "margin-top": crons().length > 0 ? "4px" : "0",
          }}
        >
          Processes <span style={{ opacity: 0.6 }}>{processes().length}</span>
        </div>
        <For each={processes()}>{(node) => <ProcessRow node={node} onFocus={props.onFocus} />}</For>
      </Show>
    </div>
  );
}
