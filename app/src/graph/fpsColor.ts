// FPS readout color is a fixed traffic-light scale (green/yellow/red), NOT derived
// from the theme's palette CSS vars — it should mean the same thing in every theme.
// The scale itself lives as --hud-fps-* tokens in global.css's `styles/tokens.css` section.
export default function fpsColor(fps: number): string {
    if (fps >= 50) return 'var(--hud-fps-good)' // green: smooth
    if (fps >= 30) return 'var(--hud-fps-ok)' // yellow: usable
    return 'var(--hud-fps-bad)' // red: janky
}
