// app/src/editor/codeLanguages.ts
//
// The language list a fenced code block's info string is matched against (` ```python `). It is
// `@codemirror/language-data` plus the fence names people actually write that the stock list has
// no alias for — ` ```matlab ` above all, which the stock list only knows as "Octave", so a MATLAB
// block rendered as plain text. Matching is by name/alias (`LanguageDescription.matchLanguageName`),
// never by file extension, so an alias here is the only way a spelling resolves.
import { LanguageDescription, LanguageSupport, StreamLanguage } from '@codemirror/language'
import { languages } from '@codemirror/language-data'

/** Extra fence spellings per stock language name. Lowercase; matching is case-insensitive. */
export const EXTRA_ALIASES: Record<string, string[]> = {
    Octave: ['matlab'],
    Python: ['py'],
    Julia: ['jl'],
    Haskell: ['hs'],
}

/** The stock Octave mode files `function` under its builtins list, so the word that opens every
 *  MATLAB/Octave function rendered as a plain identifier. Re-tag it as the keyword it is. */
async function loadOctave(): Promise<LanguageSupport> {
    const { octave } = await import('@codemirror/legacy-modes/mode/octave')
    return new LanguageSupport(
        StreamLanguage.define({
            ...octave,
            token(stream, state) {
                const style = octave.token(stream, state)
                return style === 'builtin' && stream.current() === 'function' ? 'keyword' : style
            },
        }),
    )
}

const LOADERS: Record<string, () => Promise<LanguageSupport>> = { Octave: loadOctave }

export const codeLanguages: LanguageDescription[] = languages.map(desc => {
    const extra = EXTRA_ALIASES[desc.name]
    const loader = LOADERS[desc.name]
    if (!extra && !loader) return desc
    return LanguageDescription.of({
        name: desc.name,
        alias: [...desc.alias, ...(extra ?? [])],
        extensions: desc.extensions,
        filename: desc.filename,
        load: loader ?? (() => desc.load()),
    })
})
