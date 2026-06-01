export const PAGE_W = 816;
export const PAGE_H = 1056;

export type PaperBg = "blank" | "lines" | "grid" | "dots";
export type Tool = "pen" | "hl";
export interface Stroke { t: Tool; c: string; w: number; straight?: boolean; pts: number[]; }
export interface Page { strokes: Stroke[]; }
export interface Paper { bg: PaperBg; }
export interface DrawingDoc { v: 1; kind: "drawing"; paper: Paper; pages: Page[]; }
export interface ThemeColors { bg: string; fg: string; }

export function emptyDoc(): DrawingDoc {
  return { v: 1, kind: "drawing", paper: { bg: "grid" }, pages: [{ strokes: [] }] };
}

const clampByte = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

export function roundDoc(doc: DrawingDoc): DrawingDoc {
  return {
    ...doc,
    pages: doc.pages.map((pg) => ({
      strokes: pg.strokes.map((s) => ({
        ...s,
        pts: s.pts.map((n, i) => (i % 3 === 2 ? clampByte(n) : Math.round(n))),
      })),
    })),
  };
}

export function serializeDoc(doc: DrawingDoc): string {
  return JSON.stringify(roundDoc(doc));
}

export function parseDoc(text: string): DrawingDoc {
  const o = JSON.parse(text);
  if (!o || o.kind !== "drawing" || !Array.isArray(o.pages)) {
    throw new Error("not a drawing document");
  }
  return o as DrawingDoc;
}
