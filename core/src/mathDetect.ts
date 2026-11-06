// core/src/mathDetect.ts
// Does a page look like math? Judged from on-device recognition's text, which garbles formulas but
// keeps their tells: relation and operator symbols, lone single-letter variables, digits glued to
// letters. Measured on handwritten lecture notes against handwritten prose: math pages had 20–61%
// of their lines carry a tell, prose pages at most 11%.

const SYMBOL = /[=<>→←↔⇒⇔∀∃∈∉⊂⊆∪∩≤≥≠≈∑∏∫√∞±^|{}[\]~∂∇λεδθσμπ]/
const LONE_LETTER = /^[A-Za-z]['’]?[,.;:)]?$/
const DIGIT_LETTER = /\d[A-Za-z]|[A-Za-z]\d|\d\s*[+\-*/]\s*\d/

/** The share of lines a page needs with a math tell, and the fewest such lines. */
export const MATH_LINE_SHARE = 0.15
export const MATH_MIN_LINES = 2

/** A line with a relation or operator symbol, two lone variables, or a digit glued to a letter. */
export function isMathLine(line: string): boolean {
    const words = line.split(/\s+/).filter(Boolean)
    if (words.length === 0) return false
    if (SYMBOL.test(line)) return true
    // `a` and `I` are words, not variables.
    const lone = words.filter(w => LONE_LETTER.test(w) && !/^[aI]$/i.test(w.replace(/[^A-Za-z]/g, ''))).length
    if (lone >= 2) return true
    return DIGIT_LETTER.test(line)
}

/** True when at least MATH_MIN_LINES lines, and MATH_LINE_SHARE of all lines, carry a math tell. */
export function looksLikeMath(text: string): boolean {
    const lines = text.split('\n').filter(l => l.trim() !== '')
    const math = lines.filter(isMathLine).length
    return math >= MATH_MIN_LINES && math / lines.length >= MATH_LINE_SHARE
}
