import { For, type JSX } from "solid-js";
import { resolveProperty } from "../../../core/src/bases/query";
import type { Row, BaseConfig } from "../../../core/src/bases/types";
import { Icon } from "../icons/Icon";
import { Stars } from "../ui/Stars";
import { StatusText } from "../ui/StatusDot";
import styles from "./BaseView.module.css";

// Re-export so existing bases imports of statusColor from renderValue keep working.
export { statusColor } from "../ui/StatusDot";

export function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Bare property name (drop file./note./this./formula. namespace), lowercased. */
export function bareName(id: string): string {
  const dot = id.indexOf(".");
  const base = dot >= 0 ? id.slice(dot + 1) : id;
  return base.toLowerCase();
}

/** Heuristic: which columns should render as colored-dot status text. */
export function isStatusColumn(id: string): boolean {
  return bareName(id) === "status";
}
/** Heuristic: which columns are tag lists (rendered as plain teal #tags). */
export function isTagColumn(id: string): boolean {
  const n = bareName(id);
  return n === "tags" || n === "tag";
}
/** Heuristic: which columns are numeric ratings (rendered as gold stars). */
export function isRatingColumn(id: string): boolean {
  const n = bareName(id);
  return n === "rating" || n === "stars" || n === "score";
}

/** Colored-dot + word status text (no pill). Delegates to the shared ui component. */
export function renderStatus(s: string): JSX.Element {
  return <StatusText status={s} />;
}

/** Plain mono #tag list in teal — no chips. */
export function renderTags(v: unknown): JSX.Element {
  const tags = Array.isArray(v) ? v.map(String) : v == null ? [] : [String(v)];
  if (tags.length === 0) return <span class="oa-empty">—</span>;
  return (
    <span class={styles.tagRow}>
      <For each={tags}>{(t) => <span>{t.startsWith("#") ? t : `#${t}`}</span>}</For>
    </span>
  );
}

/** Five lucide stars: filled gold up to `n`, faint outline for the rest. */
export function renderStars(n: number): JSX.Element {
  return <Stars value={n} />;
}

/** First-column title cell: accent book icon + medium-weight label. */
export function renderTitle(id: string, row: Row): JSX.Element {
  const v = resolveProperty(id, row);
  const label = v == null ? "" : String(v);
  const open = () => window.dispatchEvent(new CustomEvent("oa-open", { detail: row.file.path }));
  return (
    <span class={styles.cellTitle}>
      <Icon value="Book" size={14} />
      <a
        href="#"
        onClick={(e) => {
          e.preventDefault();
          open();
        }}
      >
        {label || row.file.name}
      </a>
    </span>
  );
}

/** Smart cell: routes status / tags / rating columns to their themed renderers,
 * everything else to the generic renderValue. The first/title column is handled
 * separately by renderTitle. */
export function renderCell(id: string, row: Row): JSX.Element {
  const v = resolveProperty(id, row);
  if (isStatusColumn(id) && v != null && typeof v !== "object") return renderStatus(String(v));
  if (isTagColumn(id)) return renderTags(v);
  if (isRatingColumn(id) && typeof v === "number") return renderStars(v);
  return renderValue(id, row);
}

export function columnLabel(id: string, config: BaseConfig): string {
  const customLabel = config.properties?.[id]?.displayName;
  if (customLabel) return customLabel;
  if (id.startsWith("file.")) return id.slice(5);
  if (id.startsWith("note.")) return id.slice(5);
  if (id.startsWith("this.")) return id.slice(5);
  if (id.startsWith("formula.")) return id.slice(8);
  return id;
}

export function renderValue(id: string, row: Row): JSX.Element {
  const v = resolveProperty(id, row);
  if (v === null || v === undefined) return <span class="oa-empty">—</span>;

  if (id === "file.name") {
    return (
      <a
        href="#"
        onClick={(e) => {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent("oa-open", { detail: row.file.path }));
        }}
      >
        {String(v)}
      </a>
    );
  }

  if (Array.isArray(v)) {
    return <span>{v.map((x) => String(x)).join(", ")}</span>;
  }

  if (typeof v === "boolean") {
    return <span>{v ? <Icon value="Check" size={14} /> : ""}</span>;
  }

  if (v instanceof Date) {
    return <span>{v.toISOString().slice(0, 10)}</span>;
  }

  return <span>{String(v)}</span>;
}
