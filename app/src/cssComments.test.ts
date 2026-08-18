// Guards against a silent, high-blast-radius CSS failure: a comment that CLOSES EARLY because its
// prose contains a `*/` sequence.
//
// This shipped. ChatView.css's header comment described the design system's token families as
// `--r-*/--rule-*/--shadow-*`. The `*/` inside `--r-*/` terminated the comment 2 lines early; the
// parser then hit the remaining prose as garbage and error-recovered by consuming the next `{…}`
// block — which was the entire `.chat-host` rule. The consequences were invisible in review and
// severe at runtime:
//   * `display:flex; flex-direction:column; height:100%` never applied, so the chat pane collapsed
//     to content height and the composer floated a third of the way up an empty pane;
//   * the six `--chat-surface-*/--chat-border-*` custom properties that rule DEFINES went undefined,
//     so 33 downstream declarations (the composer's own background + border among them) resolved to
//     invalid and silently dropped — the message box rendered with no fill and no border at all.
// The identical bug was live in sheet/univer-theme.css (`--univer-gray-*/--univer-primary-*`), where
// it ate the rule that gives the sheet chrome the app's UI font.
//
// Nothing catches this: the file is valid UTF-8, the build succeeds, no console warning is emitted,
// and every OTHER rule in the file keeps working — so a reviewer reading the source sees a rule that
// is simply not there at runtime.
//
// The invariant: a comment's closing `*/` must be preceded by whitespace or by `*`. Every
// deliberate closer in this codebase is written `… */` or `…**/`; a closer that lands directly
// against a word character or `-` is prose being mistaken for the end of the comment.
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Glob } from 'bun'

const SRC = join(import.meta.dir)

// Every comment-terminating star-slash in `css`, with the char immediately before it.
// (Written as a line comment on purpose: a JSDoc block here could not mention the
// star-slash sequence it is about without closing itself — this bug's whole point.)
function commentClosers(
    css: string,
): { line: number; before: string; excerpt: string }[] {
    const out: { line: number; before: string; excerpt: string }[] = []
    let i = 0
    for (;;) {
        const open = css.indexOf('/*', i)
        if (open < 0) break
        const close = css.indexOf('*/', open + 2)
        if (close < 0) break // unterminated comment — a different (and louder) failure
        out.push({
            line: css.slice(0, close).split('\n').length,
            before: close > 0 ? css[close - 1]! : '',
            excerpt: css.slice(Math.max(open, close - 46), close + 2),
        })
        i = close + 2
    }
    return out
}

const cssFiles = [...new Glob('**/*.css').scanSync(SRC)].sort()

describe('CSS comments never close early', () => {
    it('finds the stylesheets it is supposed to be guarding', () => {
        // Without this the suite would pass vacuously if the glob ever stopped matching.
        expect(cssFiles.length).toBeGreaterThan(20)
        expect(cssFiles).toContain('ChatView.css')
        expect(cssFiles).toContain('sheet/univer-theme.css')
    })

    for (const rel of cssFiles) {
        it(`${rel} closes every comment on whitespace or '*'`, () => {
            const closers = commentClosers(readFileSync(join(SRC, rel), 'utf8'))
            const bad = closers.filter(
                c => !/\s/.test(c.before) && c.before !== '*',
            )
            expect(
                bad.map(
                    c =>
                        `${rel}:${c.line} — comment ends mid-prose at ...${c.excerpt}`,
                ),
            ).toEqual([])
        })
    }
})

describe('commentClosers detects the bug that shipped', () => {
    // The real pre-fix text from ChatView.css. Asserting on a reconstruction of the ACTUAL defect
    // (not a synthetic `/* */`) is what makes the guard above meaningful rather than decorative.
    const REGRESSION = `/* Theme-aware throughout via
   App.css custom properties + the design system's --r-*/--rule-*/--shadow-* tokens. */
.chat-host { display: flex; height: 100%; --chat-surface-2: var(--surface-2); }`

    it('flags the --r-*/ closer', () => {
        const bad = commentClosers(REGRESSION).filter(
            c => !/\s/.test(c.before) && c.before !== '*',
        )
        expect(bad).toHaveLength(1)
        expect(bad[0]!.before).toBe('-') // the char before `*/` is the trailing `-` of `--r-`
        expect(bad[0]!.excerpt).toContain('--r-*/')
    })

    it('accepts the fixed text', () => {
        const fixed = REGRESSION.replace(
            '--r-*/--rule-*/--shadow-*',
            '--r-*, --rule-* and --shadow-*',
        )
        const bad = commentClosers(fixed).filter(
            c => !/\s/.test(c.before) && c.before !== '*',
        )
        expect(bad).toEqual([])
    })
})
