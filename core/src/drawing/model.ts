export const PAGE_W = 816;
export const PAGE_H = 1056;

export type PaperBg = "blank" | "lines" | "grid" | "dots";
export type Tool = "pen" | "hl";
export interface Stroke { t: Tool; c: string; w: number; straight?: boolean; pts: number[]; }
// A placed raster image, in the page's 816×1056 logical coordinate space. `src` is a
// self-contained `data:image/...;base64,...` URL so the `.draw` stays fully portable (the
// headless CLI export needs zero asset resolution). Drawn UNDER the ink (background-ish), so
// you can both import a picture into a sketch and annotate a photo by stroking over it.
export interface ImageEl { src: string; x: number; y: number; w: number; h: number; }
export interface Page { strokes: Stroke[]; images?: ImageEl[]; }
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
      // Carry images through (rebuilding the page as `{ strokes }` only would silently
      // strip them on save). Round the geometry; NEVER touch `src` (the data URL).
      ...(pg.images
        ? { images: pg.images.map((im) => ({ ...im, x: Math.round(im.x), y: Math.round(im.y), w: Math.round(im.w), h: Math.round(im.h) })) }
        : {}),
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
