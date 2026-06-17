// app/src/export/viewHtml.ts
// Static, themeable HTML rendering of the non-calendar visual Bases views (cards, kanban,
// list/bullets). Pure string builders — no Solid, no DOM — so they share the exporter's
// bun-compilable path. Each consumes a runView ViewResult (already filtered/sorted/grouped)
// and reuses the same value formatting the live views + the data table use (cellText +
// renderCellHtml), so a visual export reads like what's on screen. Colors/fonts come from
// the resolved live-theme palette so the export matches the app.
import { resolveProperty } from "../../../core/src/bases/query";
import type { BaseConfig, ViewResult, Row, ResultGroup } from "../../../core/src/bases/types";
import { columnLabel } from "../bases/columnLabel";
import { renderCellHtml } from "../bases/markdown";
import { cellText } from "./baseTable";
import { escapeHtml } from "../htmlEscape";
import { groupColorHex, tintStyle } from "./exportTheme";
import type { ThemePalette } from "./types";

export interface ViewHtml { body: string; css: string; }

const titleOf = (row: Row, col: string | undefined): string => {
  const v = col ? cellText(resolveProperty(col, row)) : "";
  return v || row.file.name || "Untitled";
};

// label: value field rows for a card/list item, skipping the title column + empty values.
function fieldsHtml(cols: string[], row: Row, config: BaseConfig, skipFirst: boolean): string {
  return cols
    .filter((_, i) => !(skipFirst && i === 0))
    .map((id) => ({ id, text: cellText(resolveProperty(id, row)) }))
    .filter((f) => f.text !== "")
    .map((f) => `<div class="exp-field"><span class="exp-flabel">${escapeHtml(columnLabel(f.id, config))}</span>` +
      `<span class="exp-fval">${renderCellHtml(f.text)}</span></div>`)
    .join("");
}

function groupHeader(key: string, p: ThemePalette): string {
  return key === "" ? "" : `<div class="exp-group" style="color:${groupColorHex(key, p)}">${escapeHtml(key)}</div>`;
}

// ---- cards -----------------------------------------------------------------------------

export function cardsHtml(config: BaseConfig, vr: ViewResult, p: ThemePalette): ViewHtml {
  const cols = vr.columns;
  const groups = vr.groups.map((g) => groupHeader(g.key, p) +
    `<div class="exp-cardgrid">` +
    g.rows.map((row) =>
      `<div class="exp-card"><div class="exp-cardtitle">${escapeHtml(titleOf(row, cols[0]))}</div>` +
      `<div class="exp-cardfields">${fieldsHtml(cols, row, config, true)}</div></div>`,
    ).join("") +
    `</div>`,
  ).join("");
  return { body: `<div class="exp-cards">${groups}</div>`, css: cardsCss(p) };
}

// ---- kanban ----------------------------------------------------------------------------

// Mirror the live kanban: hide the persistence-only `order` column unless the view
// explicitly lists it.
function kanbanCols(vr: ViewResult): string[] {
  const explicit = vr.view.order && vr.view.order.length > 0;
  return explicit ? vr.columns : vr.columns.filter((c) => c !== "note.order" && c !== "order");
}

export function kanbanHtml(config: BaseConfig, vr: ViewResult, p: ThemePalette): ViewHtml {
  const cols = kanbanCols(vr);
  const columns = vr.groups.map((g: ResultGroup) => {
    const color = groupColorHex(g.key, p);
    const cards = g.rows.map((row) =>
      `<div class="exp-kbcard" style="${tintStyle(g.key === "" ? undefined : g.key, p, p.scheme === "dark" ? 0.16 : 0.08)}">` +
      `<div class="exp-cardfields">${fieldsHtml(cols, row, config, false)}</div></div>`,
    ).join("");
    return `<div class="exp-kbcol">` +
      `<div class="exp-kbhead" style="color:${color}"><span class="exp-kbdot" style="background:${color}"></span>` +
      `${escapeHtml(g.key === "" ? "(none)" : g.key)} <span class="exp-kbcount">${g.rows.length}</span></div>` +
      `<div class="exp-kbcards">${cards}</div></div>`;
  }).join("");
  return { body: `<div class="exp-kanban">${columns}</div>`, css: kanbanCss(p) };
}

// ---- list / bullets --------------------------------------------------------------------

export function listHtml(_config: BaseConfig, vr: ViewResult, p: ThemePalette): ViewHtml {
  const cols = vr.columns;
  const groups = vr.groups.map((g) => groupHeader(g.key, p) +
    `<ul class="exp-list-ul">` +
    g.rows.map((row) => {
      const meta = cols.slice(1)
        .map((id) => cellText(resolveProperty(id, row)))
        .filter((t) => t !== "")
        .map((t) => `<span class="exp-listmeta">${renderCellHtml(t)}</span>`)
        .join("");
      return `<li class="exp-listitem"><span class="exp-listtitle">${escapeHtml(titleOf(row, cols[0]))}</span>${meta}</li>`;
    }).join("") +
    `</ul>`,
  ).join("");
  return { body: `<div class="exp-list">${groups}</div>`, css: listCss(p) };
}

// ---- shared field CSS + per-view CSS ---------------------------------------------------

function fieldCss(t: ThemePalette): string {
  return `
  .exp-field { display: flex; gap: 0.5rem; font-size: 0.82rem; line-height: 1.5; }
  .exp-flabel { color: ${t.muted}; min-width: 6.5em; flex: 0 0 auto; }
  .exp-fval { color: ${t.fg}; }
  .exp-fval a { color: ${t.accent}; }
  .exp-group { font-size: 0.78rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;
    margin: 1.2rem 0 0.5rem; }
  .exp-cardfields { display: flex; flex-direction: column; gap: 1px; }`;
}

function cardsCss(t: ThemePalette): string {
  return `
  body { max-width: 1000px; }
  ${fieldCss(t)}
  .exp-cardgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 0.75rem; }
  .exp-card { border: 1px solid ${t.border}; border-radius: 8px; padding: 0.7rem 0.8rem; background: ${t.cell};
    break-inside: avoid; }
  .exp-cardtitle { font-weight: 600; font-size: 0.95rem; margin-bottom: 0.4rem; color: ${t.fg}; }`;
}

function kanbanCss(t: ThemePalette): string {
  return `
  body { max-width: none; }
  ${fieldCss(t)}
  .exp-kanban { display: flex; gap: 0.75rem; align-items: flex-start; overflow-x: auto; }
  .exp-kbcol { flex: 0 0 250px; background: ${t.cell}; border: 1px solid ${t.border}; border-radius: 8px;
    padding: 0.5rem; }
  .exp-kbhead { display: flex; align-items: center; gap: 0.4rem; font-weight: 600; font-size: 0.85rem;
    padding: 0.1rem 0.2rem 0.5rem; }
  .exp-kbdot { width: 8px; height: 8px; border-radius: 999px; display: inline-block; }
  .exp-kbcount { color: ${t.muted}; font-weight: 400; margin-left: auto; }
  .exp-kbcards { display: flex; flex-direction: column; gap: 0.5rem; }
  .exp-kbcard { border: 1px solid ${t.border}; border-radius: 6px; padding: 0.5rem 0.6rem; background: ${t.bg};
    break-inside: avoid; }`;
}

function listCss(t: ThemePalette): string {
  return `
  ${fieldCss(t)}
  .exp-list-ul { list-style: none; margin: 0; padding: 0; }
  .exp-listitem { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5rem; padding: 0.35rem 0;
    border-bottom: 1px solid ${t.border}; }
  .exp-listtitle { font-weight: 500; color: ${t.fg}; }
  .exp-listmeta { font-size: 0.8rem; color: ${t.muted}; }`;
}
