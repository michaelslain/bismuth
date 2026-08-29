import type { Component } from 'solid-js'
import { For } from 'solid-js'
import styles from './FontSpecimen.module.css'

/** The exact family name registered by the `@font-face` rules this specimen exercises
 *  (`@fontsource-variable/newsreader`'s `wght.css` / `wght-italic.css`, imported in
 *  `index.tsx`). Fontsource's OWN convention names a variable-axis package's family
 *  "<Family> Variable" — distinct from the static `@fontsource/newsreader` package,
 *  which would register plain "Newsreader" — exactly the same way this app's mono
 *  face is registered as "Monaspace Xenon", not "Monaspace" (tokens.css `--editor-font`).
 *  Whatever wave wires `--prose-font` must reference this string verbatim or the token
 *  silently falls through to the Georgia/serif fallback with no error anywhere. */
const NEWSREADER = "'Newsreader Variable', Georgia, serif"
const MONO = "'Monaspace Xenon', ui-monospace, monospace"

const WEIGHTS = [200, 300, 400, 500, 600, 700, 800] as const

const READ_SAMPLE =
    'The wikilink resolves by file name, not path, so two notes with the same title in ' +
    'different folders are ambiguous on purpose — the graph would rather surface a collision ' +
    'than silently pick one.'

const BODY_SAMPLE =
    'Backlinks update on save; the debounce is two hundred fifty milliseconds, tuned against a ' +
    'vault of nine thousand notes.'

const NUMERAL_SAMPLE = '0123456789 — 1,204.50 km · §9.2 · 27 Aug 2026 · £83.19'

/**
 * A specimen page for the Newsreader variable font — NOT a reusable app component. It exists
 * only so the font choice (note prose + chat message bodies, per the visual-unification audit
 * §9.1) can be judged in Storybook before any real surface consumes it. Nothing in `app/` renders
 * this; it is reachable only via its own story.
 *
 * Sections: prose at the two sizes note prose actually ships at (`--fs-read`/`--fs-body`, with
 * fallbacks matching their pre-token literals since this wave does not define those tokens yet),
 * the full 200–800 weight axis, italic, numeral rendering, and a same-text side-by-side against
 * the current mono face so the contrast this token is FOR is visible in one frame.
 */
const FontSpecimen: Component = () => {
    return (
        <div class={styles.page}>
            <header class={styles.head}>
                <h1 class={styles.title}>Newsreader — prose serif specimen</h1>
                <p class={styles.meta}>
                    @fontsource-variable/newsreader · variable weight 200–800 · italic · latin +
                    latin-ext + vietnamese · self-hosted, no network fetch
                </p>
            </header>

            <section class={styles.section}>
                <h2 class={styles.label}>
                    Note prose size — var(--fs-read, 15px)
                </h2>
                <p
                    class={styles.prose}
                    style={{
                        'font-family': NEWSREADER,
                        'font-size': 'var(--fs-read, 15px)',
                    }}
                >
                    {READ_SAMPLE}
                </p>
            </section>

            <section class={styles.section}>
                <h2 class={styles.label}>
                    Dense/panel size — var(--fs-body, 13px)
                </h2>
                <p
                    class={styles.prose}
                    style={{
                        'font-family': NEWSREADER,
                        'font-size': 'var(--fs-body, 13px)',
                    }}
                >
                    {BODY_SAMPLE}
                </p>
            </section>

            <section class={styles.section}>
                <h2 class={styles.label}>Weight axis, 200–800</h2>
                <div class={styles.weightRamp}>
                    <For each={WEIGHTS}>
                        {w => (
                            <div class={styles.weightRow}>
                                <span class={styles.weightTag}>{w}</span>
                                <span
                                    class={styles.weightSample}
                                    style={{
                                        'font-family': NEWSREADER,
                                        'font-weight': String(w),
                                    }}
                                >
                                    Knowledge graphs render as ASCII, not pixels.
                                </span>
                            </div>
                        )}
                    </For>
                </div>
            </section>

            <section class={styles.section}>
                <h2 class={styles.label}>Italic</h2>
                <p
                    class={styles.prose}
                    style={{
                        'font-family': NEWSREADER,
                        'font-size': 'var(--fs-read, 15px)',
                        'font-style': 'italic',
                    }}
                >
                    A note's frontmatter is tolerated when malformed — the parser degrades rather
                    than refusing the whole file over one bad line.
                </p>
            </section>

            <section class={styles.section}>
                <h2 class={styles.label}>Numerals</h2>
                <p
                    class={styles.prose}
                    style={{
                        'font-family': NEWSREADER,
                        'font-size': 'var(--fs-read, 15px)',
                        'font-variant-numeric': 'lining-nums',
                    }}
                >
                    lining &nbsp; {NUMERAL_SAMPLE}
                </p>
                <p
                    class={styles.prose}
                    style={{
                        'font-family': NEWSREADER,
                        'font-size': 'var(--fs-read, 15px)',
                        'font-variant-numeric': 'oldstyle-nums',
                    }}
                >
                    oldstyle &nbsp; {NUMERAL_SAMPLE}
                </p>
            </section>

            <section class={styles.section}>
                <h2 class={styles.label}>
                    Side-by-side — same text, prose serif vs the current mono chrome face
                </h2>
                <div class={styles.compareGrid}>
                    <div class={styles.compareCol}>
                        <div class={styles.compareTag}>
                            Newsreader Variable (prose — proposed)
                        </div>
                        <p
                            class={styles.prose}
                            style={{
                                'font-family': NEWSREADER,
                                'font-size': 'var(--fs-read, 15px)',
                            }}
                        >
                            {READ_SAMPLE}
                        </p>
                    </div>
                    <div class={styles.compareCol}>
                        <div class={styles.compareTag}>
                            Monaspace Xenon (chrome — unchanged)
                        </div>
                        <p
                            class={styles.prose}
                            style={{
                                'font-family': MONO,
                                'font-size': 'var(--fs-read, 15px)',
                            }}
                        >
                            {READ_SAMPLE}
                        </p>
                    </div>
                </div>
            </section>
        </div>
    )
}

export default FontSpecimen
