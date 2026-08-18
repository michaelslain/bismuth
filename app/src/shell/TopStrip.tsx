import type { JSX } from 'solid-js'
import styles from './TopStrip.module.css'

// The wordmark + platform titlebar strip, lifted out of App.tsx verbatim (design/ascii/README.md
// "App shell", §1). macOS runs a transparent Overlay titlebar (native traffic lights float over
// the strip, left padding reserves room for them via `top-strip--mac`) with no typed controls;
// Windows/Linux run fully undecorated with typed `[-] [+] [x]` controls rendered as `children`
// (see WindowControls); the browser/dev build gets neither.
//
// `data-tauri-drag-region="deep"` (not a bare/"true" value): Tauri's injected drag script only
// treats a bare attribute as "this exact element", checked via `el === composedPath[0]` — since
// the wordmark span and the flex:1 `.top-strip-spacer` (the strip's largest visual area) are
// child elements that receive the actual click target, a bare attribute here left almost the
// entire strip undraggable. "deep" lets any non-interactive descendant trigger the drag; the
// `.win-btn` window-control buttons stay excluded automatically (Tauri's script never treats a
// clickable tag like <button> as a drag target unless IT carries the attribute itself), so no
// pointer-events juggling is needed. Also requires `core:window:allow-start-dragging` in
// capabilities/default.json (silently no-ops without it). Double-click-to-maximize on macOS is
// Tauri's own built-in behavior for any drag region (fires `internal_toggle_maximize`, already
// covered by `core:window:default`) — do NOT add a manual dblclick handler here, it would race
// the native one.
//
// `.top-strip` and `.top-strip-spacer` are reached through the imported `styles` object; the
// `top-strip--mac` modifier hashes too, so it goes into `classList` as `[styles["top-strip--mac"]]`
// rather than a bare string (a literal would compile and match nothing). Bracket access, not
// `styles.topStrip`: Vite only exposes camelCase aliases under css.modules.localsConvention, which
// app/vite.config.ts does not set. `.asc-wordmark` stays a bare global permanently: it is an
// `asc-*` design-system class living in App.css's ASCII register alongside its `@keyframes
// asc-sheen` and its reduced-motion `@media`, not chrome owned by this component.
export function TopStrip(props: {
    mac: boolean
    dragRegion: boolean
    children?: JSX.Element
}) {
    return (
        <div
            class={styles['top-strip']}
            classList={{ [styles['top-strip--mac']]: props.mac }}
            data-tauri-drag-region={props.dragRegion ? 'deep' : undefined}
        >
            <span class="asc-wordmark" aria-label="Bismuth">
                ,;']--]';,
            </span>
            <div class={styles['top-strip-spacer']} />
            {props.children}
        </div>
    )
}
