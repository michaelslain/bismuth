// app/src/bases/numberFormat.ts
// Pure display/edit formatting for a `number`-kind base property (#100). Kept out of
// PropertyValueEditor.tsx / KanbanCard.tsx so the formatting rules are unit-testable
// without dragging in Solid/JSX.
//
// PERCENT STORAGE CONVENTION: the property's STORED (raw frontmatter) value is a plain
// fraction 0–1 (0.25 means 25%) — the same convention `Intl.NumberFormat({style:"percent"})`
// expects natively, so DISPLAY needs no manual ×100/÷100. The EDIT BOX, though, shows and
// accepts the human percentage number (25, not 0.25) — typing "25" into a percent field is
// far less surprising than typing "0.25" — so `numberEditValue`/`parseNumberEdit` scale by
// 100 at that boundary while the canonical stored value stays the 0–1 fraction.
import type { NumberFormat } from "../../../core/src/bases/types";

/** Render a stored number for display, per its declared `number` format. `unit` is the
 *  label ("kg") for `"unit"` or the ISO currency code ("USD") for `"currency"`. Falls back
 *  to a bare string for a non-finite value (shouldn't normally reach here — callers only
 *  call this for a value that already resolved as `typeof v === "number"`). */
export function formatNumberDisplay(value: number, format: NumberFormat | undefined, unit: string | undefined): string {
  if (!Number.isFinite(value)) return String(value);
  switch (format) {
    case "currency": {
      const code = (unit && unit.trim() ? unit.trim() : "USD").toUpperCase();
      try {
        return new Intl.NumberFormat(undefined, { style: "currency", currency: code }).format(value);
      } catch {
        // Unrecognized currency code (malformed-tolerant, matching the rest of the codebase).
        return `${value} ${code}`;
      }
    }
    case "percent":
      return new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 2 }).format(value);
    case "unit":
      return unit && unit.trim() ? `${value} ${unit.trim()}` : String(value);
    case "plain":
    default:
      return String(value);
  }
}

/** The value an EDIT INPUT should show for a stored number, per format — percent scales
 *  ×100 (see module doc); every other format passes the stored value straight through. */
export function numberEditValue(value: number, format: NumberFormat | undefined): number {
  return format === "percent" ? value * 100 : value;
}

/** Parse a raw edit-box string back into the canonical STORED number, per format — percent
 *  divides by 100. Returns null for blank/unparseable input; the caller decides the
 *  fallback (commit null, keep the raw string, etc.). */
export function parseNumberEdit(raw: string, format: NumberFormat | undefined): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return format === "percent" ? n / 100 : n;
}
