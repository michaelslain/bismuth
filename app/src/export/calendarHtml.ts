// app/src/export/calendarHtml.ts
// Static, themeable HTML rendering of a calendar Bases view — the "visual" export of a
// calendar base. Pure (no DOM, no Solid), so it runs in the same bun-compilable path as
// the rest of the exporter. Mirrors the live calendar (MonthView grid + TimeGrid columns)
// but as a flat HTML string that html2canvas/jsPDF can rasterize and a .html download can
// open standalone.
//
// Row -> event mapping reuses calendarSerialize.rowToEvent (the exact mapping the live
// calendar uses), and recurrence/date math reuses the headless core helpers, so an
// exported calendar agrees with what's on screen.
import { expandRecurrence, toDateStr, addDays } from "../../../core/src/bases/recurrence";
import { rowToEvent } from "../bases/calendarSerialize";
import type { CalendarEvent } from "../calendar/types";
import { escapeHtml } from "../htmlEscape";
import { tintStyle } from "./exportTheme";
import type { ExportCategory } from "./baseTable";
import type { BaseConfig, ViewResult } from "../../../core/src/bases/types";
import type { ExportOptions, ThemePalette, CalSpan } from "./types";

// An event carries a category NAME ("Work"); its color lives in the base's `categories`
// frontmatter (Work -> "blue"). Resolve name -> stored color (a theme token or hex), which
// tintStyle then turns into a concrete fill. Unknown/no category falls back to the accent.
type ColorFor = (category: string | undefined) => string | undefined;
function colorResolver(categories: ExportCategory[]): ColorFor {
  const byName = new Map(categories.map((c) => [c.name, c.color]));
  return (category) => (category ? byName.get(category) ?? undefined : undefined);
}

// Shared render context: the resolved live-theme palette, the 24h-time setting, and the
// category color resolver.
interface CalCtx { p: ThemePalette; military: boolean; colorFor: ColorFor; }

// ---- date helpers ----------------------------------------------------------------------

function parseLocal(iso: string): Date {
  return new Date(iso + "T00:00:00");
}
function startOfWeek(d: Date, mondayFirst: boolean): Date {
  const off = mondayFirst ? -((d.getDay() + 6) % 7) : -d.getDay();
  return addDays(d, off);
}
function fmtTime(t: string, military: boolean): string {
  const [h, m] = t.split(":").map(Number);
  if (Number.isNaN(h)) return t;
  if (military) return `${h}:${String(m || 0).padStart(2, "0")}`;
  const h12 = h % 12 || 12;
  return `${h12}:${String(m || 0).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
function fmtHourLabel(h: number, military: boolean): string {
  if (h === 0) return "";
  return military ? `${h}:00` : `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;
}
function minutesOf(t?: string): number | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return Number.isNaN(h) ? null : h * 60 + (m || 0);
}
const WEEKDAYS_SUN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_MON = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// ---- the renderer ----------------------------------------------------------------------

interface Occurrence extends CalendarEvent { date: string; }

/** Expand events to dated occurrences within [rangeStart, rangeEnd] (recurrence-aware). */
function occurrencesIn(events: CalendarEvent[], rangeStart: string, rangeEnd: string): Occurrence[] {
  const out: Occurrence[] = [];
  for (const e of events) {
    if (e.recurrence) {
      for (const d of expandRecurrence(e.recurrence, rangeStart, rangeEnd)) out.push({ ...e, date: d });
    } else if (e.date && e.date >= rangeStart && e.date <= rangeEnd) {
      out.push({ ...e, date: e.date });
    }
  }
  return out;
}

/** Occurrences on a given day, all-day first, then timed by start minute. */
function onDay(occ: Occurrence[], dateStr: string): Occurrence[] {
  return occ
    .filter((o) => o.date === dateStr)
    .sort((a, b) => (minutesOf(a.startTime) ?? -1) - (minutesOf(b.startTime) ?? -1));
}

function chipHtml(o: Occurrence, ctx: CalCtx): string {
  const time = o.startTime ? `<span class="exp-cal-time">${escapeHtml(fmtTime(o.startTime, ctx.military))}</span> ` : "";
  return `<div class="exp-cal-chip" style="${tintStyle(ctx.colorFor(o.category), ctx.p)}">${time}${escapeHtml(o.title || "Untitled")}</div>`;
}

function monthGrid(occ: Occurrence[], anchor: Date, mondayFirst: boolean, ctx: CalCtx): string {
  const y = anchor.getFullYear();
  const m = anchor.getMonth();
  const firstOfMonth = new Date(y, m, 1);
  const weekStart = startOfWeek(firstOfMonth, mondayFirst);
  const firstDay = Math.round((firstOfMonth.getTime() - weekStart.getTime()) / 86400000);
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const total = Math.ceil((firstDay + daysInMonth) / 7) * 7;
  const todayStr = toDateStr(new Date());

  const names = (mondayFirst ? WEEKDAYS_MON : WEEKDAYS_SUN)
    .map((d) => `<div class="exp-cal-dayname">${d}</div>`).join("");

  let cells = "";
  for (let i = 0; i < total; i++) {
    const offset = i - firstDay;
    const date = new Date(y, m, 1 + offset);
    const dateStr = toDateStr(date);
    const inMonth = offset >= 0 && offset < daysInMonth;
    const isToday = dateStr === todayStr;
    const chips = onDay(occ, dateStr).map((o) => chipHtml(o, ctx)).join("");
    cells += `<div class="exp-cal-cell${inMonth ? "" : " out"}${isToday ? " today" : ""}">` +
      `<div class="exp-cal-num">${date.getDate()}</div>` +
      `<div class="exp-cal-cellevents">${chips}</div></div>`;
  }
  const title = `${MONTHS[m]} ${y}`;
  return `<div class="exp-cal-title">${title}</div>` +
    `<div class="exp-cal-month">` +
    `<div class="exp-cal-names">${names}</div>` +
    `<div class="exp-cal-grid">${cells}</div></div>`;
}

// Week / 3-day / day share a column-per-day time grid: a left hour gutter + one column per
// day, all-day events in a band on top, timed events absolutely positioned. 1px-per-minute
// would be huge; mirror the live grid's 50px/hour (1200px tall).
const HOUR_PX = 44;
const GRID_PX = HOUR_PX * 24;

function timedBlocks(events: Occurrence[], ctx: CalCtx): string {
  const timed = events.filter((e) => minutesOf(e.startTime) !== null);
  if (!timed.length) return "";
  // Simple lane assignment so overlapping events don't stack on top of each other.
  type Placed = { o: Occurrence; start: number; end: number; lane: number };
  const placed: Placed[] = [];
  const laneEnds: number[] = [];
  for (const o of timed) {
    const start = minutesOf(o.startTime)!;
    const end = Math.max(start + 30, minutesOf(o.endTime) ?? start + 60);
    let lane = laneEnds.findIndex((e) => e <= start);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(end); } else { laneEnds[lane] = end; }
    placed.push({ o, start, end, lane });
  }
  const lanes = laneEnds.length || 1;
  return placed.map(({ o, start, end, lane }) => {
    const top = (start / 1440) * GRID_PX;
    const height = Math.max(20, ((end - start) / 1440) * GRID_PX);
    const width = 100 / lanes;
    const left = lane * width;
    const title = escapeHtml(o.title || "Untitled");
    // Short blocks can't fit a stacked title + time line, so collapse to one line
    // (start-time + title) rather than letting the time wrap + clip.
    const inner = height < 42
      ? `<div class="exp-cal-blockline"><span class="exp-cal-time">${escapeHtml(fmtTime(o.startTime!, ctx.military))}</span> ${title}</div>`
      : `<div class="exp-cal-blocktitle">${title}</div>` +
        `<div class="exp-cal-time">${escapeHtml(`${fmtTime(o.startTime!, ctx.military)}${o.endTime ? "–" + fmtTime(o.endTime, ctx.military) : ""}`)}</div>`;
    return `<div class="exp-cal-block" style="${tintStyle(ctx.colorFor(o.category), ctx.p)}top:${top.toFixed(1)}px;height:${height.toFixed(1)}px;left:${left}%;width:calc(${width}% - 3px);">${inner}</div>`;
  }).join("");
}

function timeGrid(occ: Occurrence[], days: Date[], ctx: CalCtx): string {
  const todayStr = toDateStr(new Date());
  const hours = Array.from({ length: 24 }, (_, h) =>
    `<div class="exp-cal-hour"><span class="exp-cal-hourlabel">${fmtHourLabel(h, ctx.military)}</span></div>`,
  ).join("");

  let anyAllDay = false;
  const cols = days.map((date) => {
    const dateStr = toDateStr(date);
    const dayEvents = onDay(occ, dateStr);
    const allDay = dayEvents.filter((e) => minutesOf(e.startTime) === null);
    if (allDay.length) anyAllDay = true;
    const allDayHtml = allDay.map((o) => chipHtml(o, ctx)).join("");
    const isToday = dateStr === todayStr;
    const weekday = WEEKDAYS_SUN[date.getDay()];
    return {
      head: `<div class="exp-cal-colhead${isToday ? " today" : ""}"><span class="exp-cal-wd">${weekday}</span> <span class="exp-cal-dn">${date.getMonth() + 1}/${date.getDate()}</span></div>`,
      allDay: `<div class="exp-cal-allday">${allDayHtml}</div>`,
      body: `<div class="exp-cal-colbody" style="height:${GRID_PX}px;">${timedBlocks(dayEvents, ctx)}</div>`,
    };
  });

  const heads = `<div class="exp-cal-gutterhead"></div>` + cols.map((c) => c.head).join("");
  const alldays = anyAllDay
    ? `<div class="exp-cal-gutterlabel">all-day</div>` + cols.map((c) => c.allDay).join("")
    : "";
  const bodies = `<div class="exp-cal-gutter" style="height:${GRID_PX}px;">${hours}</div>` + cols.map((c) => c.body).join("");

  const gridCols = `grid-template-columns: 56px repeat(${days.length}, minmax(0, 1fr));`;
  const title = days.length === 1
    ? `${WEEKDAYS_SUN[days[0].getDay()]}, ${MONTHS[days[0].getMonth()]} ${days[0].getDate()}, ${days[0].getFullYear()}`
    : `${MONTHS[days[0].getMonth()]} ${days[0].getDate()} – ${MONTHS[days[days.length - 1].getMonth()]} ${days[days.length - 1].getDate()}, ${days[days.length - 1].getFullYear()}`;

  return `<div class="exp-cal-title">${title}</div>` +
    `<div class="exp-cal-time-grid" style="${gridCols}">` +
    `<div class="exp-cal-row heads">${heads}</div>` +
    (alldays ? `<div class="exp-cal-row alldays">${alldays}</div>` : "") +
    `<div class="exp-cal-row bodies">${bodies}</div>` +
    `</div>`;
}

/**
 * Render a calendar view to an HTML body fragment + a scoped CSS block (injected into the
 * export document head). `opts.calStart` anchors the grid (empty = today); `opts.calSpan`
 * picks month / week / 3day / day; `opts.weekStartsOnMonday` aligns the week.
 */
export function calendarHtml(
  _config: BaseConfig,
  vr: ViewResult,
  opts: ExportOptions,
  palette: ThemePalette,
  categories: ExportCategory[] = [],
): { body: string; css: string } {
  const events = vr.groups.flatMap((g) => g.rows).map((r, i) => rowToEvent(r, i, vr.view));
  const ctx: CalCtx = { p: palette, military: opts.militaryTime, colorFor: colorResolver(categories) };
  const anchor = opts.calStart ? parseLocal(opts.calStart) : new Date();
  const span: CalSpan = opts.calSpan;
  const mondayFirst = opts.weekStartsOnMonday;

  let body: string;
  if (span === "month") {
    const y = anchor.getFullYear(), m = anchor.getMonth();
    const weekStart = startOfWeek(new Date(y, m, 1), mondayFirst);
    const firstDay = Math.round((new Date(y, m, 1).getTime() - weekStart.getTime()) / 86400000);
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const total = Math.ceil((firstDay + daysInMonth) / 7) * 7;
    const rangeStart = toDateStr(new Date(y, m, 1 - firstDay));
    const rangeEnd = toDateStr(new Date(y, m, 1 - firstDay + total - 1));
    body = monthGrid(occurrencesIn(events, rangeStart, rangeEnd), anchor, mondayFirst, ctx);
  } else {
    let days: Date[];
    if (span === "week") {
      const s = startOfWeek(anchor, mondayFirst);
      days = Array.from({ length: 7 }, (_, i) => addDays(s, i));
    } else if (span === "3day") {
      days = [0, 1, 2].map((i) => addDays(anchor, i));
    } else {
      days = [anchor];
    }
    const rangeStart = toDateStr(days[0]);
    const rangeEnd = toDateStr(days[days.length - 1]);
    body = timeGrid(occurrencesIn(events, rangeStart, rangeEnd), days, ctx);
  }

  return { body: `<div class="exp-cal">${body}</div>`, css: calendarCss(palette) };
}

function calendarCss(t: ThemePalette): string {
  return `
  /* visual calendar export needs the full width, not the 760px prose column */
  body { max-width: 1100px; }
  .exp-cal { color: ${t.fg}; }
  .exp-cal-title { font-size: 1.3rem; font-weight: 600; margin: 0 0 0.8rem; }
  /* month — minmax(0,1fr) (not bare 1fr) so a long nowrap event chip can't force a
     column wider than 1/7 and overflow/clip the grid; cells shrink + ellipsize instead. */
  .exp-cal-names { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); }
  .exp-cal-dayname { padding: 0.35rem 0.5rem; font-size: 0.72rem; text-transform: uppercase;
    letter-spacing: 0.04em; color: ${t.muted}; border-bottom: 1px solid ${t.border}; min-width: 0; }
  .exp-cal-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); }
  .exp-cal-cell { min-height: 92px; min-width: 0; overflow: hidden; border-right: 1px solid ${t.border};
    border-bottom: 1px solid ${t.border}; padding: 3px 4px 5px; background: ${t.cell}; }
  .exp-cal-cell:nth-child(7n+1) { border-left: 1px solid ${t.border}; }
  .exp-cal-cell.out { background: ${t.bg}; }
  .exp-cal-cell.out .exp-cal-num { color: ${t.muted}; opacity: 0.55; }
  .exp-cal-num { font-size: 0.78rem; color: ${t.fg}; text-align: right; padding: 1px 3px; }
  .exp-cal-cell.today .exp-cal-num { display: inline-block; float: right; background: ${t.accent}; color: #fff;
    border-radius: 999px; min-width: 1.35em; text-align: center; }
  .exp-cal-cellevents { display: flex; flex-direction: column; gap: 2px; clear: both; padding-top: 2px; }
  .exp-cal-chip { font-size: 0.72rem; line-height: 1.25; padding: 1px 5px; border-radius: 3px;
    color: ${t.fg}; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .exp-cal-time { color: ${t.muted}; font-variant-numeric: tabular-nums; }
  /* week / 3day / day time grid */
  .exp-cal-time-grid { display: grid; border: 1px solid ${t.border}; border-radius: 6px; overflow: hidden; }
  .exp-cal-row { display: contents; }
  .exp-cal-colhead { padding: 0.4rem 0.5rem; text-align: center; font-size: 0.8rem; background: ${t.head};
    border-left: 1px solid ${t.border}; border-bottom: 1px solid ${t.border}; min-width: 0; overflow: hidden; }
  .exp-cal-colbody, .exp-cal-allday { min-width: 0; }
  .exp-cal-colhead.today { color: ${t.accent}; font-weight: 600; }
  .exp-cal-colhead .exp-cal-wd { color: ${t.muted}; }
  .exp-cal-gutterhead { background: ${t.head}; border-bottom: 1px solid ${t.border}; }
  .exp-cal-gutterlabel, .exp-cal-allday { border-left: 1px solid ${t.border}; border-bottom: 1px solid ${t.border};
    padding: 3px 4px; min-height: 20px; }
  .exp-cal-gutterlabel { font-size: 0.66rem; color: ${t.muted}; text-align: right; padding-right: 6px; }
  .exp-cal-allday { display: flex; flex-direction: column; gap: 2px; background: ${t.cell}; }
  .exp-cal-gutter { position: relative; }
  .exp-cal-hour { height: ${HOUR_PX}px; border-bottom: 1px solid ${t.border}; position: relative; }
  .exp-cal-hourlabel { position: absolute; top: -0.55em; right: 6px; font-size: 0.66rem; color: ${t.muted};
    background: ${t.bg}; padding: 0 2px; }
  .exp-cal-colbody { position: relative; border-left: 1px solid ${t.border};
    background-image: repeating-linear-gradient(${t.bg} 0, ${t.bg} ${HOUR_PX - 1}px, ${t.border} ${HOUR_PX - 1}px, ${t.border} ${HOUR_PX}px); }
  .exp-cal-block { position: absolute; border-radius: 3px; padding: 1px 4px; overflow: hidden;
    font-size: 0.7rem; line-height: 1.25; color: ${t.fg}; box-sizing: border-box; }
  /* keep each line single-line + clipped so a long time label can't wrap and overflow a
     short block (which overflow:hidden would then clip mid-line). */
  .exp-cal-blocktitle, .exp-cal-blockline { font-weight: 500; white-space: nowrap;
    text-overflow: ellipsis; overflow: hidden; }
  .exp-cal-blockline { font-weight: 400; }
  .exp-cal-blockline .exp-cal-time { font-weight: 600; }
  /* the STACKED time is a direct child of the block (own line); the compact-line time is an
     inline span inside .exp-cal-blockline and must stay inline — hence the child combinator. */
  .exp-cal-block > .exp-cal-time { display: block; white-space: nowrap; overflow: hidden;
    text-overflow: ellipsis; font-size: 0.64rem; }
`;
}
