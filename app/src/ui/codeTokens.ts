// app/src/ui/codeTokens.ts
// Static syntax highlighting for CodeBlock: parse `code` with the editor's own lezer grammars and
// split it into runs of text, each carrying the class the given highlighter assigns its tokens.
// No framework imports; CodeBlock supplies a highlighter built from its own module classes.
import { highlightCode, type Highlighter } from '@lezer/highlight'
import { markdown } from '@codemirror/lang-markdown'
import { yaml, yamlFrontmatter } from '@codemirror/lang-yaml'

/** `markdown` is a note: markdown with a YAML frontmatter block. */
export type CodeLanguage = 'yaml' | 'markdown'

/** One run of text; `cls` is '' for unhighlighted text and for line breaks. */
export type CodeToken = { text: string; cls: string }

// A lezer parser, typed off the grammar rather than importing @lezer/common (not a direct dep).
type Parser = ReturnType<typeof yaml>['language']['parser']

const parsers: Partial<Record<CodeLanguage, Parser>> = {}

function parserFor(language: CodeLanguage): Parser {
    return (parsers[language] ??=
        language === 'yaml'
            ? yaml().language.parser
            : yamlFrontmatter({ content: markdown() }).language.parser)
}

export function codeTokens(
    code: string,
    language: CodeLanguage,
    highlighter: Highlighter,
): CodeToken[] {
    const out: CodeToken[] = []
    highlightCode(
        code,
        parserFor(language).parse(code),
        highlighter,
        (text, cls) => out.push({ text, cls }),
        () => out.push({ text: '\n', cls: '' }),
    )
    return out
}
