// bench/clipBox.ts — the story audit's screenshot clip rectangle, as ONE source shared by the page
// probe (storyAudit.ts interpolates CLIP_BOX_SRC into its in-page PROBE) and the unit test
// (clipBox.test.ts evaluates the very same text). Kept out of storyAudit.ts because that file runs
// a whole sweep at import time.
//
// The probe measures element rects in VIEWPORT coordinates, but Page.captureScreenshot reads the
// clip as DOCUMENT coordinates. A story whose play() scrolled the page (bases-gallery--map-pins-land
// parks at scrollY 3408) therefore needs its origin shifted by the scroll offset, or the capture
// photographs a flat background band far from the content. Only the ORIGIN shifts; width and height
// are sizes. At scroll 0 the shift is a no-op.

export type ClipInput = {
    minX: number
    minY: number
    maxX: number
    maxY: number
    vw: number
    vh: number
    sx: number
    sy: number
    pad: number
    maxH: number
}
export type ClipBox = { x: number; y: number; width: number; height: number }

/** Plain-JS source (no TS syntax) so it can be pasted into the page unchanged. */
export const CLIP_BOX_SRC = `function clipBox(m) {
  var box = (m.minX === Infinity)
    ? { x: m.sx, y: m.sy, width: Math.min(m.vw, 600), height: Math.min(m.vh, 400) }
    : {
        x: m.sx + Math.max(0, Math.floor(m.minX - m.pad)),
        y: m.sy + Math.max(0, Math.floor(m.minY - m.pad)),
        width: Math.min(m.vw, Math.ceil(m.maxX - Math.max(0, m.minX - m.pad) + m.pad)),
        height: Math.min(m.maxH, Math.ceil(m.maxY - Math.max(0, m.minY - m.pad) + m.pad)),
      };
  box.width = Math.max(32, box.width); box.height = Math.max(32, box.height);
  return box;
}`

export const clipBox = new Function(`${CLIP_BOX_SRC}; return clipBox`)() as (m: ClipInput) => ClipBox
