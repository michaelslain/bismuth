import { For, type Component } from 'solid-js'
import styles from './FontBakeOff.module.css'

// ── The candidates' web fonts ────────────────────────────────────────────────────────────────
// Imported HERE, not in .storybook/preview.ts, so they load only for this one page. Fifteen
// families is a lot of bytes and none of them belong in the app bundle unless one gets picked —
// at which point exactly one of these imports moves to src/index.tsx and the rest are uninstalled.
import '@fontsource-variable/newsreader'
import '@fontsource-variable/lora'
import '@fontsource-variable/literata'
import '@fontsource-variable/faustina'
import '@fontsource-variable/vollkorn'
import '@fontsource-variable/alegreya'
import '@fontsource-variable/bitter'
import '@fontsource-variable/source-serif-4'
import '@fontsource/pt-serif'
import '@fontsource/spectral'
import '@fontsource-variable/crimson-pro'
import '@fontsource-variable/eb-garamond'
import '@fontsource-variable/stix-two-text'
import '@fontsource/libertinus-serif'
import '@fontsource/tinos'
import 'computer-modern/cmu-serif.css'

export type FontBakeOffProps = {
    /** Sample size in px. Defaults to the app's real prose size (--editor-font-size x --prose-scale). */
    size?: number
    /** Sample line-height in px. Defaults to the app's real prose leading (--row-h x 1.5). */
    leading?: number
}

type Face = {
    name: string
    /** The CSS stack. Family names are the REGISTERED ones — @fontsource-variable packages register
     *  as "<Family> Variable", which is the trap FontSpecimen.tsx documents: the plain name silently
     *  falls through to the fallback with no error anywhere. */
    stack: string
    note: string
}

type Group = { title: string; faces: Face[] }

/** Grouped by register rather than alphabetically, because "which of these feels right" is a
 *  question about register — the groups ARE the decision, and the rows inside one are fine-tuning. */
const GROUPS: Group[] = [
    {
        title: 'Reference — what the app already had',
        faces: [
            {
                name: 'Monaspace Xenon',
                stack: "'Monaspace Xenon', ui-monospace, monospace",
                note: 'What prose was in before this session. Not a sans — Xenon is the SLAB SERIF of the Monaspace family, so prose was already serif, just monospaced.',
            },
            {
                name: 'Monaspace Argon',
                stack: "'Monaspace Argon', ui-monospace, monospace",
                note: 'The humanist mono of the same family. Softer than Xenon; already installed.',
            },
            {
                name: 'Newsreader',
                stack: "'Newsreader Variable', Georgia, serif",
                note: 'What is live right now. Drawn for newsprint — high contrast, hairline thins, which is what fights the character grid.',
            },
        ],
    },
    {
        title: 'Warm & bookish — the Lora register',
        faces: [
            {
                name: 'Lora',
                stack: "'Lora Variable', Georgia, serif",
                note: 'The one this repo shipped and retired. Moderate contrast, brush-like terminals.',
            },
            {
                name: 'Literata',
                stack: "'Literata Variable', Georgia, serif",
                note: "Google Books' face. Nearest thing to Lora but drawn harder for screens.",
            },
            {
                name: 'Faustina',
                stack: "'Faustina Variable', Georgia, serif",
                note: 'Same temperature as Lora, more personality in the italics.',
            },
            {
                name: 'Vollkorn',
                stack: "'Vollkorn Variable', Georgia, serif",
                note: 'Warmer and slightly quirkier; sturdy but friendly.',
            },
            {
                name: 'Alegreya',
                stack: "'Alegreya Variable', Georgia, serif",
                note: 'Pushes the calligraphic side furthest. Most character, least neutral.',
            },
            {
                name: 'Bitter',
                stack: "'Bitter Variable', Georgia, serif",
                note: "Lora's slabbier cousin. LOW contrast — sits best of this group against mono.",
            },
        ],
    },
    {
        title: 'Neutral & sturdy',
        faces: [
            {
                name: 'Source Serif 4',
                stack: "'Source Serif 4 Variable', Georgia, serif",
                note: 'Adobe. Clean, low contrast, no brushiness. The safe modern choice.',
            },
            {
                name: 'PT Serif',
                stack: "'PT Serif', Georgia, serif",
                note: 'The neutral end. Unfussy, screen-first, no flavour to get tired of.',
            },
            {
                name: 'Spectral',
                stack: "'Spectral', Georgia, serif",
                note: 'Production Type, screen-first, but crisper and higher contrast than the rest here.',
            },
        ],
    },
    {
        title: 'Academic — the "research paper" register',
        faces: [
            {
                name: 'CMU Serif (Computer Modern)',
                stack: "'CMU Serif', Georgia, serif",
                note: "Knuth's, the LaTeX default. THE papers font — and a Didone, so expect thin hairlines on screen. Included so you can see that for yourself.",
            },
            {
                name: 'Libertinus Serif',
                stack: "'Libertinus Serif', Georgia, serif",
                note: 'Scholarly like Computer Modern but far sturdier. The academic feel that survives a screen.',
            },
            {
                name: 'STIX Two Text',
                stack: "'STIX Two Text Variable', Georgia, serif",
                note: 'Purpose-built for scientific publishing. Excellent math coverage if that ever matters.',
            },
            {
                name: 'Crimson Pro',
                stack: "'Crimson Pro Variable', Georgia, serif",
                note: 'Minion lineage — reads like a monograph.',
            },
            {
                name: 'EB Garamond',
                stack: "'EB Garamond Variable', Georgia, serif",
                note: 'Old-style and scholarly. Lighter on the page than the rest of this group.',
            },
            {
                name: 'Tinos',
                stack: "'Tinos', 'Times New Roman', serif",
                note: 'Metric-compatible with Times New Roman — the other journal default.',
            },
        ],
    },
    {
        title: 'System faces — zero install, macOS only',
        faces: [
            {
                name: 'New York',
                stack: "'New York', ui-serif, Georgia, serif",
                note: "Apple's reading serif. NOTE: measured identical to Georgia in headless Chrome, i.e. it fell through to the fallback there — judge this row in your own browser, and treat a Georgia-looking sample as 'not resolving' rather than as New York.",
            },
            {
                name: 'Charter',
                stack: "Charter, Georgia, serif",
                note: 'Matthew Carter, drawn for LOW-resolution output. Very sturdy; already on your Mac.',
            },
            {
                name: 'Iowan Old Style',
                stack: "'Iowan Old Style', Georgia, serif",
                note: 'Warm bookish system face; the one Apple Books uses.',
            },
            {
                name: 'Palatino',
                stack: "Palatino, 'Palatino Linotype', Georgia, serif",
                note: 'Calligraphic, wide, generous. A classic that reads older than the rest.',
            },
            {
                name: 'Georgia',
                stack: "Georgia, serif",
                note: 'The screen-serif baseline. Sturdy, ubiquitous, slightly large on the body.',
            },
        ],
    },
]

/**
 * Side-by-side comparison of every prose-face candidate, at the app's REAL shipping size and
 * leading, so a judgement here transfers straight to the editor without re-testing.
 *
 * NOT a reusable app component — it is a decision aid, in the same spirit as FontSpecimen.tsx.
 * It exists because the current prose face was chosen with nothing to compare it against
 * (FontSpecimen renders exactly one candidate, labelled "proposed"), which is how the app ended up
 * with a newsprint face on a monospace grid. When a face is picked, one import from this file's
 * header moves to src/index.tsx, `--prose-font` changes in styles/tokens.css, and the other
 * fourteen packages get uninstalled along with this file.
 *
 * The sample sentence is deliberately real note prose and carries bold, italic, a wikilink and an
 * inline code span: the code span stays Monaspace, and how the two faces sit together is most of
 * what decides whether a candidate works HERE rather than in the abstract.
 */
const FontBakeOff: Component<FontBakeOffProps> = props => {
    const size = () => props.size ?? 16.875
    const leading = () => props.leading ?? 27
    return (
        <div class={styles.host}>
            <div class={styles.intro}>
                Every candidate at the app's real prose size (<b>{size()}px</b>{' '}
                / <b>{leading()}px</b> leading). The inline{' '}
                <code>code span</code> stays Monaspace in every row on purpose —
                how the prose face sits against the mono grid is most of what
                decides this. Adjust size and leading in the Controls panel.
            </div>
            <For each={GROUPS}>
                {group => (
                    <>
                        <div class={styles.groupHead}>{group.title}</div>
                        <For each={group.faces}>
                            {face => (
                                <div class={styles.row}>
                                    <div class={styles.name}>{face.name}</div>
                                    <div class={styles.note}>{face.note}</div>
                                    <div
                                        class={styles.sample}
                                        style={{
                                            'font-family': face.stack,
                                            'font-size': `${size()}px`,
                                            'line-height': `${leading()}px`,
                                        }}
                                    >
                                        The vault is a folder of plain markdown —{' '}
                                        <b>nothing is locked in a database</b>,
                                        and every note stays a file you can read
                                        with <code>cat</code> in 20 years. Links
                                        are written{' '}
                                        <a href="#" onClick={e => e.preventDefault()}>
                                            [[by name]]
                                        </a>
                                        , not by path, so moving a note never
                                        breaks one. <i>The graph is derived</i>,
                                        never authored: 1,247 notes, 3,891 edges,
                                        rebuilt in 40ms.
                                    </div>
                                    <div class={styles.stack}>{face.stack}</div>
                                </div>
                            )}
                        </For>
                    </>
                )}
            </For>
        </div>
    )
}

export default FontBakeOff
export { FontBakeOff }
