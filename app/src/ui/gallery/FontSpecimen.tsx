import type { Component } from 'solid-js'
import { For } from 'solid-js'
import styles from './FontSpecimen.module.css'

/** The prose face this app actually ships, loaded via @fontsource-variable/lora (index.tsx) and
 *  consumed via --prose-font (styles/tokens.css). Repointed here from CMU Serif: leaving the old
 *  constant would have rendered the Georgia FALLBACK while the page still claimed to be
 *  specimening CMU — the package is uninstalled — which is the exact silent-fallback failure
 *  the previous comment warned about, just from the other direction. The family string must be
 *  'Lora Variable', NOT bare 'Lora' — the package declares the former, and the latter resolves
 *  nothing and falls silently through to Georgia. See the --prose-font comment in tokens.css. */
const PROSE = "'Lora Variable', Lora, Georgia, serif"
const MONO = "'Monaspace Xenon', ui-monospace, monospace"

/* Lora Variable is a continuous 400-700 weight axis (see @fontsource-variable/lora/wght.css) —
   unlike CMU Serif's two discrete static weights, so this ramp samples four stops across the
   real axis instead of listing every weight the face happens to ship. */
const WEIGHTS = [400, 500, 600, 700] as const

const READ_SAMPLE =
    'The wikilink resolves by file name, not path, so two notes with the same title in ' +
    'different folders are ambiguous on purpose — the graph would rather surface a collision ' +
    'than silently pick one.'

const BODY_SAMPLE =
    'Backlinks update on save; the debounce is two hundred fifty milliseconds, tuned against a ' +
    'vault of nine thousand notes.'

const NUMERAL_SAMPLE = '0123456789 — 1,204.50 km · §9.2 · 27 Aug 2026 · £83.19'

/**
 * A specimen page for the Lora variable font — NOT a reusable app component. It exists
 * only so the font choice (note prose + chat message bodies, per the visual-unification audit
 * §9.1) can be judged in Storybook before any real surface consumes it. Nothing in `app/` renders
 * this; it is reachable only via its own story.
 *
 * Sections: prose at the two sizes note prose actually ships at (`--prose-font-size`, the real
 * token note prose renders at, and `--fs-body` with its pre-token literal fallback since this
 * wave does not define that token yet), the 400–700 weight axis, italic, numeral rendering, and
 * a same-text side-by-side against the current mono face so the contrast this token is FOR is
 * visible in one frame.
 */
const FontSpecimen: Component = () => {
    return (
        <div class={styles.page}>
            <header class={styles.head}>
                <h1 class={styles.title}>Lora — prose serif specimen</h1>
                <p class={styles.meta}>
                    @fontsource-variable/lora // variable weight 400–700 // italic // latin +
                    latin-ext + cyrillic + cyrillic-ext + vietnamese + math + symbols //
                    self-hosted, no network fetch
                </p>
            </header>

            <section class={styles.section}>
                <h2 class={styles.label}>
                    Note prose size — var(--prose-font-size)
                </h2>
                <p
                    class={styles.prose}
                    style={{
                        'font-family': PROSE,
                        'font-size': 'var(--prose-font-size)',
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
                        'font-family': PROSE,
                        'font-size': 'var(--fs-body, 13px)',
                    }}
                >
                    {BODY_SAMPLE}
                </p>
            </section>

            <section class={styles.section}>
                <h2 class={styles.label}>Weight axis, 400–700</h2>
                <div class={styles.weightRamp}>
                    <For each={WEIGHTS}>
                        {w => (
                            <div class={styles.weightRow}>
                                <span class={styles.weightTag}>{w}</span>
                                <span
                                    class={styles.weightSample}
                                    style={{
                                        'font-family': PROSE,
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
                        'font-family': PROSE,
                        'font-size': 'var(--prose-font-size)',
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
                        'font-family': PROSE,
                        'font-size': 'var(--prose-font-size)',
                        'font-variant-numeric': 'lining-nums',
                    }}
                >
                    lining &nbsp; {NUMERAL_SAMPLE}
                </p>
                <p
                    class={styles.prose}
                    style={{
                        'font-family': PROSE,
                        'font-size': 'var(--prose-font-size)',
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
                            Lora Variable (prose)
                        </div>
                        <p
                            class={styles.prose}
                            style={{
                                'font-family': PROSE,
                                'font-size': 'var(--prose-font-size)',
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
                                'font-size': 'var(--prose-font-size)',
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
