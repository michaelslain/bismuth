import type { JSX } from "solid-js";
import { resolveProperty } from "../../../core/src/bases/query";
import type { Row, BaseConfig } from "../../../core/src/bases/types";

export function columnLabel(id: string, config: BaseConfig): string {
  const dn = config.properties?.[id]?.displayName;
  if (dn) return dn;
  if (id.startsWith("file.")) return id.slice(5);
  if (id.startsWith("note.")) return id.slice(5);
  if (id.startsWith("formula.")) return id.slice(8);
  return id;
}

export function renderValue(id: string, row: Row): JSX.Element {
  const v = resolveProperty(id, row);
  if (v === null || v === undefined) return <span class="oa-empty">—</span>;

  // Make the note's own name a clickable link that opens the note.
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

  if (Array.isArray(v)) return <span>{v.map((x) => String(x)).join(", ")}</span>;
  if (typeof v === "boolean") return <span>{v ? "✓" : ""}</span>;
  if (v instanceof Date) return <span>{v.toISOString().slice(0, 10)}</span>;
  return <span>{String(v)}</span>;
}
