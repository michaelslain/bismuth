// app/src/ui/ascii/glyphCanvas.ts
// STUB pre-registered for the intro-redesign plan so GlyphArt (Task 2) typechecks in parallel with
// this file's real implementation (Task 1). Task 1 replaces every body and this header; the public
// signature below is fixed.
import type { GlyphScene } from './glyphScene'

export default class GlyphCanvas {
    mount(_host: HTMLElement): void {}
    /** Resets the clock to t = 0 and draws frame(0). */
    setScene(_scene: GlyphScene): void {}
    setVisible(_active: boolean): void {}
    /** Pin time: draw frame(t) once and stop the loop. undefined = live. */
    setTime(_t: number | undefined): void {}
    destroy(): void {}
}
