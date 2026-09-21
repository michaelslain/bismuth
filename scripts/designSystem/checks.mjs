// design-system skill scripts v4 (2026-09-21) — copied into repos by install-gate; compare this line to detect a stale copy
// Pure logic for the design-system skill. No filesystem access — every input arrives as a
// string or an array of { path, content }. This file is copied into user repos alongside its
// lib/ siblings, so it (and they) must stay dependency-free (plain Node ESM, node:path/posix
// only).

import { basename, extname } from 'node:path/posix'
import { parseYamlGovernanceBlock } from './lib/yamlSubset.mjs'
import { NAMED_COLORS } from './lib/namedColors.mjs'

// Where a repo keeps its design files, relative to the repo root. DESIGN.md stays at the root
// because impeccable reads it only there (plus .agents/context/ and docs/); the tooling state
// the gate owns goes in design/, out of the root.
export const BASELINE_PATH = 'design/baseline.json'

// `governance:` block of DESIGN.md's frontmatter → the parsed object, or null if there is no
// frontmatter / no governance key. Throws a clear error on YAML outside the documented subset.
export function parseGovernance(designMdText) {
    return parseYamlGovernanceBlock(designMdText)
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const CHECK_NAMES = [
    'storyCoverage', 'oneImporter', 'hardcodedColor', 'hardcodedFont',
    'hardcodedFontSize', 'hardcodedRadius', 'bareElement', 'propsDestructure',
    'ignoreReason', 'globalReach', 'oneGlobalFile',
]

const DEFAULT_COMPONENTS_MATCH = '**/[A-Z]*.tsx'
const DEFAULT_COMPONENTS_EXCLUDE = ['**/*.stories.tsx', '**/*.test.tsx', '**/_*']
// manifest.md's example shows a single `**/*.module.css` pattern but notes "also .module.scss" —
// ambiguous whether .scss should count by default. Chosen reading: include it, since scanning
// more files is the stricter option.
const DEFAULT_STYLESHEETS_MATCH = ['**/*.module.css', '**/*.module.scss']
const DEFAULT_STYLESHEETS_IMPORTERS_EXEMPT = ['**/*.stories.*', '**/*.test.*', '**/_*']
// Class names a component stylesheet may legitimately reach with `:global()`: ones whose DOM is
// built outside the bundler's view, so no hashed local can ever land on it. The built-in list is
// the common plain-DOM libraries; `externalClasses` in the manifest ADDS to it (it never replaces
// it), and is where a repo declares its own runtime-emitted prefix.
const DEFAULT_EXTERNAL_CLASSES = [
    'cm-*', 'xterm*', 'ProseMirror*', 'milkdown*', 'univer-*', 'leaflet-*',
    'maplibregl-*', 'mapboxgl-*', 'ql-*', 'fc-*', 'tox-*', 'monaco-*', 'ag-*',
]
const DEFAULT_TOKENS_USE = 'var(--'
const DEFAULT_STORIES_SIBLING = '{name}.stories.tsx'
const DEFAULT_PRIMITIVES_ELEMENTS = {
    p: 'Text', span: 'Text', h1: 'Heading', h2: 'Heading', h3: 'Heading', h4: 'Heading',
    h5: 'Heading', h6: 'Heading', button: 'Button', input: 'Field', textarea: 'Field',
    select: 'Field', label: 'Label',
}

function toArr(v, fallback = []) {
    if (v === undefined || v === null) return fallback
    return Array.isArray(v) ? v : [v]
}

export function withDefaults(governance) {
    const g = governance || {}
    const out = {}
    out.framework = g.framework || 'other'
    out.source = toArr(g.source)
    out.components = {
        match: (g.components && g.components.match) || DEFAULT_COMPONENTS_MATCH,
        exclude: toArr(g.components && g.components.exclude, DEFAULT_COMPONENTS_EXCLUDE),
    }
    out.stylesheets = {
        match: g.stylesheets && g.stylesheets.match ? toArr(g.stylesheets.match) : DEFAULT_STYLESHEETS_MATCH,
        importersExempt: toArr(g.stylesheets && g.stylesheets.importersExempt, DEFAULT_STYLESHEETS_IMPORTERS_EXEMPT),
    }
    out.tokens = {
        files: toArr(g.tokens && g.tokens.files),
        use: (g.tokens && g.tokens.use) || DEFAULT_TOKENS_USE,
    }
    out.global = toArr(g.global)
    out.externalClasses = DEFAULT_EXTERNAL_CLASSES.concat(toArr(g.externalClasses))
    out.primitives = {
        dir: (g.primitives && g.primitives.dir) || '',
        elements: (g.primitives && g.primitives.elements) || DEFAULT_PRIMITIVES_ELEMENTS,
    }
    out.stories = {
        sibling: (g.stories && g.stories.sibling) || DEFAULT_STORIES_SIBLING,
        exempt: toArr(g.stories && g.stories.exempt),
    }
    out.checks = {}
    for (const name of CHECK_NAMES) {
        const v = g.checks && g.checks[name]
        out.checks[name] = v === undefined ? true : v === true
    }
    return out
}

// ---------------------------------------------------------------------------
// matchGlob — minimatch-style subset: ** * ? [A-Z] {a,b}
// ---------------------------------------------------------------------------

export function matchGlob(pattern, path) {
    return expandBraces(pattern).some(p => globToRegExp(p).test(path))
}

function expandBraces(pattern) {
    const m = pattern.match(/\{([^{}]*)\}/)
    if (!m) return [pattern]
    const results = []
    for (const opt of m[1].split(',')) {
        results.push(...expandBraces(pattern.slice(0, m.index) + opt + pattern.slice(m.index + m[0].length)))
    }
    return results
}

function globToRegExp(glob) {
    let re = ''
    let i = 0
    while (i < glob.length) {
        const c = glob[i]
        if (c === '*' && glob[i + 1] === '*') {
            if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 3 } else { re += '.*'; i += 2 }
        } else if (c === '*') {
            re += '[^/]*'; i++
        } else if (c === '?') {
            re += '[^/]'; i++
        } else if (c === '[') {
            let j = i + 1
            let cls = '['
            if (glob[j] === '!' || glob[j] === '^') { cls += '^'; j++ }
            while (j < glob.length && glob[j] !== ']') { cls += glob[j]; j++ }
            cls += ']'
            re += cls
            i = j + 1
        } else if ('.+^$()|\\'.includes(c)) {
            re += '\\' + c; i++
        } else {
            re += c; i++
        }
    }
    return new RegExp('^' + re + '$')
}

// ---------------------------------------------------------------------------
// runChecks
// ---------------------------------------------------------------------------

const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.vue', '.svelte', '.astro'])
const CSS_EXTS = new Set(['.css', '.scss'])

function makeLineFinder(content) {
    const offsets = [0]
    for (let i = 0; i < content.length; i++) if (content[i] === '\n') offsets.push(i + 1)
    return index => {
        let lo = 0
        let hi = offsets.length - 1
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1
            if (offsets[mid] <= index) lo = mid; else hi = mid - 1
        }
        return lo + 1
    }
}

function posixJoin(dir, spec) {
    const parts = (dir ? dir.split('/') : []).concat(spec.split('/'))
    const stack = []
    for (const part of parts) {
        if (part === '' || part === '.') continue
        if (part === '..') stack.pop()
        else stack.push(part)
    }
    return stack.join('/')
}

// Blank out `//` and `/* */` comments in a JS/TS/JSX source file (replacing comment characters
// with spaces, preserving length and line breaks) before running any regex-based scan over it.
// This codebase's comments routinely quote tag names and import paths in prose
// (`// a <textarea> can't carry per-line ::before`, `// PaneTree.module.css (Task 12's …)`) —
// without this, bareElement and the import scanner both "read" prose as code.
//
// String/template-literal CONTENTS are preserved (not blanked) here, because the import scanner
// that shares this helper (checkOneImporter) needs to read the quoted specifier inside
// `import styles from './Foo.module.css'`.
function blankJsComments(content) {
    let out = ''
    let i = 0
    const n = content.length
    let inLine = false
    let inBlock = false
    let inStr = null
    while (i < n) {
        const c = content[i]
        const c2 = i + 1 < n ? content[i + 1] : ''
        if (inLine) {
            if (c === '\n') { inLine = false; out += c } else { out += ' ' }
            i++; continue
        }
        if (inBlock) {
            if (c === '*' && c2 === '/') { out += '  '; inBlock = false; i += 2; continue }
            out += c === '\n' ? '\n' : ' '
            i++; continue
        }
        if (inStr) {
            if (c === '\\') { out += '  '; i += 2; continue }
            if (c === inStr) inStr = null
            out += c === '\n' ? '\n' : c
            i++; continue
        }
        if (c === '/' && c2 === '/') { inLine = true; out += '  '; i += 2; continue }
        if (c === '/' && c2 === '*') { inBlock = true; out += '  '; i += 2; continue }
        if (c === '"' || c === "'" || c === '`') { inStr = c; out += c; i++; continue }
        out += c
        i++
    }
    return out
}

// Returns the previous non-whitespace character in `content` before index `i`, or '' if none.
// Used by blankJsCode's string-open heuristic below.
function prevNonWhitespace(content, i) {
    let j = i - 1
    while (j >= 0 && /\s/.test(content[j])) j--
    return j >= 0 ? content[j] : ''
}

// Returns the identifier/keyword run ending right before index `i` (skipping whitespace first),
// or '' if the preceding character isn't a word character. Used by blankJsCode to tell "a keyword
// that opens a string" (`return`, `case`) from "a word ending in an apostrophe" (`don't`) — both
// end in `[\w]`, so the single-character lookback in prevNonWhitespace can't tell them apart.
function prevWord(content, i) {
    let j = i - 1
    while (j >= 0 && /\s/.test(content[j])) j--
    const end = j + 1
    while (j >= 0 && /\w/.test(content[j])) j--
    return content.slice(j + 1, end)
}

// Keywords after which a quote can ONLY be opening a new string, never closing a contraction —
// `return '<span>'` and `case '<span>':` are the two shapes item 9 exists for (a tag-shaped
// string literal used as a plain VALUE, not JSX). Deliberately narrow: only the two keywords the
// check is proven against, not a general JS tokenizer.
const STRING_OPENING_KEYWORDS = new Set(['return', 'case'])

// Same shape as blankJsComments, but ALSO blanks the CONTENTS of string and template literals
// (comments AND strings become spaces, length and line breaks preserved). Real JSX is never
// written inside a JS string, so a component that builds markup as text — an `innerHTML`
// template literal, a string handed to a DOM library — must not have its tag-shaped text read as
// JSX. Used only by checkBareElement, which has no need to see inside a string the way the import
// scanner does.
//
// A `'`/`"` only OPENS a string when the previous non-whitespace character does not look like
// the end of a word, a `)`, or a `]` — that shape is a contraction or possessive apostrophe in
// JSX prose ("don't", "base's own fields"), not real code, and treating it as a string opener
// blanks everything up to the next matching quote, hiding real JSX possibly lines later. An open
// `'`/`"` string that hits a newline before its closing quote is likewise not a real string (JS
// string literals cannot contain a raw line break) — it is closed at the newline instead of
// continuing to blank subsequent lines. Backticks are unaffected: a template literal legitimately
// spans multiple lines, so it keeps opening unconditionally and closing only on its own backtick.
function blankJsCode(content) {
    let out = ''
    let i = 0
    const n = content.length
    let inLine = false
    let inBlock = false
    let inStr = null
    while (i < n) {
        const c = content[i]
        const c2 = i + 1 < n ? content[i + 1] : ''
        if (inLine) {
            if (c === '\n') { inLine = false; out += c } else { out += ' ' }
            i++; continue
        }
        if (inBlock) {
            if (c === '*' && c2 === '/') { out += '  '; inBlock = false; i += 2; continue }
            out += c === '\n' ? '\n' : ' '
            i++; continue
        }
        if (inStr) {
            if (c === '\n' && inStr !== '`') { inStr = null; out += c; i++; continue }
            if (c === '\\') { out += '  '; i += 2; continue }
            if (c === inStr) { inStr = null; out += ' ' } else { out += c === '\n' ? '\n' : ' ' }
            i++; continue
        }
        if (c === '/' && c2 === '/') { inLine = true; out += '  '; i += 2; continue }
        if (c === '/' && c2 === '*') { inBlock = true; out += '  '; i += 2; continue }
        if (c === '`') { inStr = c; out += ' '; i++; continue }
        if (c === '"' || c === "'") {
            const opensString = !/[\w)\]]/.test(prevNonWhitespace(content, i))
                || STRING_OPENING_KEYWORDS.has(prevWord(content, i))
            if (opensString) { inStr = c; out += ' '; i++; continue }
        }
        out += c
        i++
    }
    return out
}

const IMPORT_RE = /import\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g

function checkStoryCoverage(g, files, fileSet, isComponentFile, isStoryExempt) {
    const findings = []
    for (const f of files) {
        if (!isComponentFile(f.path) || isStoryExempt(f.path)) continue
        const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : ''
        const base = basename(f.path).replace(/\.[^.]+$/, '')
        const siblingName = g.stories.sibling.replace('{name}', base)
        const siblingPath = dir ? `${dir}/${siblingName}` : siblingName
        if (!fileSet.has(siblingPath)) {
            findings.push({
                check: 'storyCoverage', path: f.path, line: 0,
                message: `no ${siblingName} beside ${basename(f.path)}`,
                suggestion: `add ${siblingPath}`,
            })
        }
    }
    return findings
}

function checkOneImporter(g, files, isStylesheetFile, isGlobal, isImporterExempt) {
    const findings = []
    const importedBy = new Map()
    for (const f of files) {
        if (!SOURCE_EXTS.has(extname(f.path)) || isImporterExempt(f.path)) continue
        const clean = blankJsComments(f.content)
        IMPORT_RE.lastIndex = 0
        let m
        while ((m = IMPORT_RE.exec(clean))) {
            const spec = m[1]
            if (!spec.startsWith('.')) continue
            const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : ''
            const resolved = posixJoin(dir, spec)
            if (!importedBy.has(resolved)) importedBy.set(resolved, new Set())
            importedBy.get(resolved).add(f.path)
        }
    }
    for (const f of files) {
        if (!isStylesheetFile(f.path) || isGlobal(f.path)) continue
        const importers = [...(importedBy.get(f.path) || new Set())]
        const base = basename(f.path).replace(/\.module\.(css|scss)$/, '')
        if (importers.length !== 1) {
            findings.push({
                check: 'oneImporter', path: f.path, line: 0,
                message: `imported by ${importers.length} non-exempt file${importers.length === 1 ? '' : 's'}${importers.length ? ' (' + importers.join(', ') + ')' : ''}`,
                suggestion: importers.length === 0
                    ? `remove it if unused, or import it from the ${base} component`
                    : `extract a shared component so only one file imports this stylesheet`,
            })
        } else if (basename(importers[0]).replace(/\.[^.]+$/, '') !== base) {
            findings.push({
                check: 'oneImporter', path: f.path, line: 0,
                message: `its one importer (${importers[0]}) is not its namesake (expected a file named ${base}.*)`,
                suggestion: `rename the importer to match ${base}, or extract ${base} as its own component and import THAT`,
            })
        }
    }
    return findings
}

// Colour properties. Beyond the exact names, three widened families:
//  - `border-(top|right|bottom|left)-color` (existing longhand) AND the bare directional
//    shorthand `border-(top|right|bottom|left)` (`border-left: 1px solid #fff` hides a literal
//    behind a shorthand just as easily as the `-color` longhand does).
//  - `background-image` and `mask-image`, which is where a gradient (`linear-gradient(…, #fff,
//    …)`) most often hides a literal colour as one of its stops. A mask's channel is alpha-only,
//    so a BARE `black`/`white` stop there is exempt (see hasHardcodedColor) — but a hex or
//    colour-function stop still flags, since that spelling usually means a real colour drifted in.
//  - any custom property (`--foo: …`) — components routinely stash a colour in a local custom
//    property instead of a real token; the value test still requires the value to actually look
//    like a colour, so `--radius-local: 8px` is never touched by this.
const COLOR_PROP_NAMES = new Set([
    'color', 'background', 'background-color', 'background-image', 'border', 'border-color',
    'border-top', 'border-right', 'border-bottom', 'border-left',
    'outline', 'outline-color', 'fill', 'stroke', 'box-shadow', 'text-shadow',
    'text-decoration-color', 'caret-color', 'accent-color', 'mask-image',
])
function isColorProp(name) {
    if (COLOR_PROP_NAMES.has(name)) return true
    if (/^border-(top|right|bottom|left)-color$/.test(name)) return true
    if (name.startsWith('--')) return true
    return false
}

// border-radius, plus every longhand corner (`border-top-left-radius` etc) — a component can
// hardcode one corner while leaving the shorthand alone entirely.
function isRadiusProp(name) {
    return name === 'border-radius' || /^border-(top|bottom)-(left|right)-radius$/.test(name)
}

// CSS-wide keywords that defer to the cascade rather than hardcoding anything. None of these
// are a "literal" in any property, so they're exempt from every hardcoded-* check.
function isCascadeKeyword(value) {
    const s = value.trim().toLowerCase()
    return s === 'inherit' || s === 'initial' || s === 'unset' || s === 'revert'
}

// Remove every `tokensUse(...)` call from a value, balancing parens so a fallback holding its
// own nested token call (`var(--a, var(--b, #fff))`) is removed whole. `tokensUse` already ends
// in the call's own opening paren (default `"var(--"`), so the scan starts at depth 1.
function stripTokenCalls(value, tokensUse) {
    const openParen = tokensUse.includes('(')
    if (!openParen) return value.split(tokensUse).join(' ')
    let out = ''
    let i = 0
    while (i < value.length) {
        if (value.startsWith(tokensUse, i)) {
            let depth = 1
            let j = i + tokensUse.length
            while (j < value.length && depth > 0) {
                if (value[j] === '(') depth++
                else if (value[j] === ')') depth--
                j++
            }
            i = j
            continue
        }
        out += value[i]
        i++
    }
    return out
}

// A value "hardcodes" a colour when, after removing every token-reference call (fallback and
// all — a literal INSIDE a var() fallback is accepted, only a literal OUTSIDE any token call is
// a finding), what remains still looks like a colour: a hex triplet, a colour function, or a
// bare named-colour keyword.
// `black` and `white` are the two named colours that are not always PAINT. In two contexts they
// are the only spelling available, so flagging them produces a finding no token can ever fix —
// a check that can only be silenced, never satisfied:
//
//  - **A `color-mix()` darkening/lightening operand on a token**
//    (`color-mix(in srgb, var(--accent) 82%, black)`). The colour still comes from the token;
//    `black` is the direction of the mix, and no token expresses "the accent, 18% darker".
//    Requires a token reference in the same value — `color-mix(in srgb, #f00, black)` still flags,
//    because there the literal IS the colour.
//  - **A mask gradient** (`mask-image: linear-gradient(to bottom, black 90%, transparent)`).
//    A mask reads only the ALPHA channel, so black/white are opacity stops that paint nothing.
//
// Deliberately narrow: bare keywords only. A hex or colour function in either context still
// flags, since those spellings are far likelier to be a real colour that drifted in.
const ACHROMATIC_KEYWORDS = /\b(black|white)\b/gi
const MASK_PROPS = /^(-webkit-)?mask(-image)?$/

function allowsAchromaticKeywords(value, stripped, prop) {
    if (prop && MASK_PROPS.test(prop)) return true
    // a color-mix whose value also references a token: the token is the colour being derived from
    return /color-mix\(/i.test(value) && stripped !== value
}

function hasHardcodedColor(value, tokensUse, prop) {
    if (isCascadeKeyword(value)) return false
    let stripped = stripTokenCalls(value, tokensUse)
    if (allowsAchromaticKeywords(value, stripped, prop)) stripped = stripped.replace(ACHROMATIC_KEYWORDS, ' ')
    const v = stripped.trim().toLowerCase()
    if (v === '' || v === 'transparent' || v === 'currentcolor' || v === 'none') return false
    if (/url\(/i.test(stripped)) return false // avoid flagging color-ish words inside asset filenames
    if (/#[0-9a-f]{3,8}\b/i.test(stripped)) return true
    if (/\b(rgba?|hsla?|oklch|oklab|lab|lch|color)\(/i.test(stripped)) return true
    const words = stripped.toLowerCase().match(/[a-z]+/g) || []
    return words.some(w => NAMED_COLORS.has(w))
}

function hasHardcodedFont(value, tokensUse) {
    if (isCascadeKeyword(value)) return false
    return !value.includes(tokensUse)
}

function hasHardcodedFontSize(value, tokensUse) {
    if (value.includes(tokensUse) || isCascadeKeyword(value)) return false
    return /\d+(\.\d+)?(px|rem|em|pt)\b/i.test(value)
}

function hasHardcodedRadius(value, tokensUse) {
    if (value.includes(tokensUse) || isCascadeKeyword(value)) return false
    const v = value.trim()
    if (/^(0(px|rem|em|pt|%)?\s*)+$/.test(v)) return false // bare zero never needs a token
    // a percentage border-radius (50% for a circle, "50% 50% 0 0" …) describes a SHAPE
    // relative to the box, not a design-scale length — it can never come from a radius token.
    if (/^(\d+(\.\d+)?%\s*){1,4}$/.test(v)) return false
    return /\d+(\.\d+)?(px|rem|em|pt|vh|vw|ch|ex)\b/i.test(v)
}

// property name must not be preceded by a word char, `$`, `@` or `-` — keeps SCSS/LESS
// variable declarations ($accent-color: …) and mid-identifier fragments from matching.
// The name itself allows digits (`[a-zA-Z0-9-]+`), not just letters and hyphens — a custom
// property can legitimately contain one (`--fs-h1`, `--icon-2x-tint`), and without this the whole
// declaration was invisible to DECL_RE: the name capture stopped at the digit, so the required
// `\s*:\s*` right after it never matched and the line was silently skipped by every check.
const DECL_RE = /(?<![\w$@-])([a-zA-Z0-9-]+)\s*:\s*([^;{}]+);?/g

// Blank out /* ... */ comments (replace non-newline chars with spaces) so DECL_RE can never
// match prose inside a comment — a real stylesheet in the wild had a comment quoting
// `border-radius: 11px` in backticks, which DECL_RE happily "read" as a live declaration.
// Preserves length and line breaks so line numbers computed against the original content stay
// correct.
function blankCssComments(content) {
    return content.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
}

function scanCssLiterals(checkName, g, files, isStyleScanTarget, isTokenFile, propTest, valueTest) {
    const findings = []
    for (const f of files) {
        if (!isStyleScanTarget(f.path) || isTokenFile(f.path)) continue
        const find = makeLineFinder(f.content)
        const clean = blankCssComments(f.content)
        DECL_RE.lastIndex = 0
        let m
        while ((m = DECL_RE.exec(clean))) {
            const prop = m[1].trim().toLowerCase()
            if (!propTest(prop)) continue
            const value = m[2].trim()
            if (!valueTest(value, g.tokens.use, prop)) continue
            findings.push({
                check: checkName, path: f.path, line: find(m.index),
                message: `${prop}: ${value} is a hardcoded literal, not a token`,
                suggestion: `reference a ${g.tokens.use}…) token${g.tokens.files.length ? ' from ' + g.tokens.files.join(', ') : ''}`,
            })
        }
    }
    return findings
}

// `:global(.foo)` in a component stylesheet is the one-importer rule violated in a spelling the
// importer check cannot see. `oneImporter` counts IMPORT statements, so a component that reaches
// another component's classes without importing anything is invisible to it — and if those classes
// live in a file listed under `global:`, they are invisible to every other check too.
//
// Measured on Bismuth 2026-09-20, with the audit reporting ZERO findings: 69 of 190 component
// stylesheets used `:global()`, including `.btn--icon` 24x, `.btn--text` 19x and `.btn` 15x — one
// primitive's own classes restyled from 58 places outside it. Every one is the same defect the
// importer check exists to catch: a component nobody extracted, or a prop nobody added.
//
// Exempt: a class whose DOM is built outside the bundler (a plain-DOM library, a runtime-emitted
// HTML string), declared via `externalClasses` or covered by the built-in library list — there a
// hashed local can never land, so `:global()` is the only spelling available.
// The global layer is ONE file. A project has exactly two kinds of stylesheet — the global one and
// `<Component>.module.css` — and there is no third kind. A second global file is always one of two
// things: a component nobody extracted (`ui.css`, `shared.css`), or a section of the global layer
// that was filed as a file (`tokens.css`, `reset.css`, `Editor.css`). The first is debt; the second
// is filing, and a comment heading does filing without costing a file.
//
// Splitting the global layer is not free, either: CSS `@import` HOISTS, so moving a rule out to a
// sibling file silently reorders precedence, and nothing reports it until a rule stops applying.
//
// One finding for the whole project, not one per file — the shape of the layer is a single
// decision, and N findings would just be the same sentence N times.
function checkOneGlobalFile(g, files, isGlobal) {
    const sheets = files.filter(f => CSS_EXTS.has(extname(f.path)) && isGlobal(f.path)).map(f => f.path).sort()
    if (sheets.length <= 1) return []
    return [{
        check: 'oneGlobalFile', path: sheets[0], line: 0,
        message: `the global layer is ${sheets.length} files, not 1: ${sheets.join(', ')}`,
        suggestion: 'merge them into one global stylesheet, each former file a commented section — or, where a file is really a pile of unextracted components, extract those components and let it disappear. @import does not count: it is still N files, and it hoists',
    }]
}

function checkGlobalReach(g, files, isStylesheetFile, isGlobal, isTokenFile) {
    const findings = []
    const isExternal = name => g.externalClasses.some(pat => matchGlob(pat, name))
    for (const f of files) {
        if (!isStylesheetFile(f.path) || isGlobal(f.path) || isTokenFile(f.path)) continue
        if (!CSS_EXTS.has(extname(f.path))) continue
        const find = makeLineFinder(f.content)
        const clean = blankCssComments(f.content)
        const re = /:global\s*\(([^)]*)\)/g
        const seen = new Set()
        let m
        while ((m = re.exec(clean))) {
            const line = find(m.index)
            for (const cls of m[1].match(/\.[A-Za-z_][\w-]*/g) || []) {
                const name = cls.slice(1)
                if (isExternal(name)) continue
                const key = `${line}:${name}`
                if (seen.has(key)) continue
                seen.add(key)
                findings.push({
                    check: 'globalReach', path: f.path, line,
                    message: `:global(.${name}) reaches a class this component does not own`,
                    suggestion: `import the component that owns .${name} and compose it (or add the prop it lacks); if .${name} is built by plain-DOM code, declare its prefix in externalClasses`,
                })
            }
        }
    }
    return findings
}

function checkBareElement(g, files, isComponentFile, isInPrimitivesDir) {
    const findings = []
    const names = Object.keys(g.primitives.elements)
    if (names.length === 0) return findings
    const tagRe = new RegExp(`<(${names.join('|')})(?=[\\s/>])`, 'g')
    for (const f of files) {
        if (!isComponentFile(f.path) || isInPrimitivesDir(f.path)) continue
        const find = makeLineFinder(f.content)
        const clean = blankJsCode(f.content)
        tagRe.lastIndex = 0
        let m
        while ((m = tagRe.exec(clean))) {
            const tag = m[1]
            findings.push({
                check: 'bareElement', path: f.path, line: find(m.index),
                message: `bare <${tag}> used directly`,
                suggestion: g.primitives.elements[tag],
            })
        }
    }
    return findings
}

const ARROW_DESTRUCTURE_RE = /const\s+([A-Z][A-Za-z0-9_]*)\s*(?::[^=\n]+)?=\s*\(\s*\{/g
const FUNC_DESTRUCTURE_RE = /function\s+([A-Z][A-Za-z0-9_]*)\s*\(\s*\{/g
const PROPS_DESTRUCTURE_RE = /const\s*\{[^}]*\}\s*=\s*props\b/g

function checkPropsDestructure(g, files, isComponentFile) {
    if (g.framework !== 'solid') return []
    const findings = []
    for (const f of files) {
        if (!isComponentFile(f.path)) continue
        if (f.path.includes('.stories.') || f.path.includes('.test.')) continue
        const find = makeLineFinder(f.content)
        const clean = blankJsComments(f.content)
        for (const re of [ARROW_DESTRUCTURE_RE, FUNC_DESTRUCTURE_RE]) {
            re.lastIndex = 0
            let m
            while ((m = re.exec(clean))) {
                findings.push({
                    check: 'propsDestructure', path: f.path, line: find(m.index),
                    message: `${m[1]} destructures props in its signature`,
                    suggestion: 'take props whole and read props.x at use — destructuring unsubscribes permanently in Solid',
                })
            }
        }
        PROPS_DESTRUCTURE_RE.lastIndex = 0
        let m2
        while ((m2 = PROPS_DESTRUCTURE_RE.exec(clean))) {
            findings.push({
                check: 'propsDestructure', path: f.path, line: find(m2.index),
                message: 'destructures props via "const { … } = props"',
                suggestion: 'read props.x at each use site instead of destructuring',
            })
        }
    }
    return findings
}

// ---------------------------------------------------------------------------
// Per-line exemption: `design-system-ignore <check-id>: <reason>`, in `//`, `/* */` or
// `{/* */}`, on the same line as the finding or the line directly above it. A directive with no
// reason after the colon (or no colon at all) exempts nothing and is itself a finding
// (`ignoreReason`), so a bare "ignore" comment can never silently swallow debt. So is an unknown
// check-id (not one of CHECK_NAMES) — a typo'd check name would otherwise exempt nothing and look
// exempt to a human skimming the file, so it earns the same `ignoreReason` finding.
// A directive is read ONLY inside an actual comment span — see commentSpansOnly below — so the
// same text sitting in a JS string or template literal (documentation, a test fixture, prose
// about the directive itself) is never mistaken for a real exemption.
// ---------------------------------------------------------------------------

const IGNORE_TOKEN_RE = /design-system-ignore\s+([A-Za-z]+)/g

// Strip a trailing comment closer (`*/`, or `*/}` for a JSX `{/* ... */}`) plus surrounding
// whitespace, so what's left is just the human-written reason text.
function stripCommentTail(s) {
    return s.replace(/\s*\*\/\s*\}?\s*$/, '').trim()
}

// The inverse of blankJsComments/blankCssComments: everything OUTSIDE a `//` or `/* */` comment
// (including string/template-literal contents) is replaced with a space, length and line breaks
// preserved, so IGNORE_TOKEN_RE can only match text actually written inside a real comment.
// `hasLineComments` is false for CSS/SCSS, which has no `//` syntax.
function commentSpansOnly(content, hasLineComments) {
    let out = ''
    let i = 0
    const n = content.length
    let inLine = false
    let inBlock = false
    let inStr = null
    while (i < n) {
        const c = content[i]
        const c2 = i + 1 < n ? content[i + 1] : ''
        if (inLine) {
            if (c === '\n') { inLine = false; out += c } else { out += c }
            i++; continue
        }
        if (inBlock) {
            if (c === '*' && c2 === '/') { out += '*/'; inBlock = false; i += 2; continue }
            out += c
            i++; continue
        }
        if (inStr) {
            if (c === '\n' && inStr !== '`') { inStr = null; out += c; i++; continue }
            if (c === '\\') { out += '  '; i += 2; continue }
            if (c === inStr) inStr = null
            out += c === '\n' ? '\n' : ' '
            i++; continue
        }
        if (hasLineComments && c === '/' && c2 === '/') { inLine = true; out += '//'; i += 2; continue }
        if (c === '/' && c2 === '*') { inBlock = true; out += '/*'; i += 2; continue }
        if (c === '"' || c === "'" || c === '`') { inStr = c; out += ' '; i++; continue }
        out += c === '\n' ? '\n' : ' '
        i++
    }
    return out
}

function parseIgnoreDirectivesForFile(content, hasLineComments) {
    const find = makeLineFinder(content)
    const spans = commentSpansOnly(content, hasLineComments)
    const byLine = new Map() // line -> Map(checkId -> reasonOk boolean)
    IGNORE_TOKEN_RE.lastIndex = 0
    let m
    while ((m = IGNORE_TOKEN_RE.exec(spans))) {
        const checkId = m[1]
        const line = find(m.index)
        const afterMatch = m.index + m[0].length
        const nlIdx = content.indexOf('\n', afterMatch)
        const restOfLine = content.slice(afterMatch, nlIdx === -1 ? content.length : nlIdx)
        const colonIdx = restOfLine.indexOf(':')
        let reasonOk = false
        if (colonIdx !== -1 && restOfLine.slice(0, colonIdx).trim() === '') {
            reasonOk = stripCommentTail(restOfLine.slice(colonIdx + 1)).length > 0
        }
        if (!byLine.has(line)) byLine.set(line, new Map())
        byLine.get(line).set(checkId, reasonOk)
    }
    return byLine
}

function buildIgnoreIndex(files) {
    const index = new Map()
    for (const f of files) {
        const byLine = parseIgnoreDirectivesForFile(f.content, SOURCE_EXTS.has(extname(f.path)))
        if (byLine.size) index.set(f.path, byLine)
    }
    return index
}

// A finding is exempt only when its own check id has a VALID (reasoned) directive on its own
// line or the line directly above. An invalid directive (see checkIgnoreReasons) exempts nothing
// — it earns its own finding instead of a free pass.
function filterExempt(findings, ignoreIndex) {
    return findings.filter(f => {
        if (f.line <= 0) return true
        const byLine = ignoreIndex.get(f.path)
        if (!byLine) return true
        const same = byLine.get(f.line)
        const above = byLine.get(f.line - 1)
        const exempt = (same && same.get(f.check) === true) || (above && above.get(f.check) === true)
        return !exempt
    })
}

function checkIgnoreReasons(files, ignoreIndex) {
    const findings = []
    for (const f of files) {
        const byLine = ignoreIndex.get(f.path)
        if (!byLine) continue
        for (const [line, checks] of byLine) {
            for (const [checkId, reasonOk] of checks) {
                if (!CHECK_NAMES.includes(checkId)) {
                    findings.push({
                        check: 'ignoreReason', path: f.path, line,
                        message: `design-system-ignore ${checkId} is not a known check`,
                        suggestion: `use one of: ${CHECK_NAMES.join(', ')}`,
                    })
                    continue
                }
                if (reasonOk) continue
                findings.push({
                    check: 'ignoreReason', path: f.path, line,
                    message: `design-system-ignore ${checkId} has no reason`,
                    suggestion: `design-system-ignore ${checkId}: <why this line is exempt>`,
                })
            }
        }
    }
    return findings
}

export function runChecks(manifest, files) {
    const g = withDefaults(manifest)
    const fileSet = new Set(files.map(f => f.path))

    const isUnderSource = p => g.source.some(root => {
        const r = root.replace(/\/$/, '')
        return p === r || p.startsWith(r + '/')
    })
    const matchesAny = (patterns, p) => toArr(patterns).some(pat => matchGlob(pat, p))
    const isComponentFile = p => isUnderSource(p) && matchGlob(g.components.match, p) && !matchesAny(g.components.exclude, p)
    const isStylesheetFile = p => isUnderSource(p) && matchesAny(g.stylesheets.match, p)
    const isGlobal = p => matchesAny(g.global, p)
    const isImporterExempt = p => matchesAny(g.stylesheets.importersExempt, p)
    const isTokenFile = p => g.tokens.files.includes(p)
    const isStoryExempt = p => matchesAny(g.stories.exempt, p)
    const isInPrimitivesDir = p => !!g.primitives.dir && (p === g.primitives.dir || p.startsWith(g.primitives.dir + '/'))
    // Literal-scanning checks (colour/font/fontSize/radius) now also read the GLOBAL layer, not
    // just component stylesheets — a token definition is where a literal belongs, so token files
    // stay excepted via isTokenFile below, but the reset/content/icon CSS that used to be waved
    // through by isGlobal alone is not.
    const isStyleScanTarget = p => (isStylesheetFile(p) || isGlobal(p)) && CSS_EXTS.has(extname(p))

    const findings = []
    if (g.checks.storyCoverage) findings.push(...checkStoryCoverage(g, files, fileSet, isComponentFile, isStoryExempt))
    if (g.checks.oneImporter) findings.push(...checkOneImporter(g, files, isStylesheetFile, isGlobal, isImporterExempt))
    if (g.checks.hardcodedColor) findings.push(...scanCssLiterals('hardcodedColor', g, files, isStyleScanTarget, isTokenFile, isColorProp, hasHardcodedColor))
    if (g.checks.hardcodedFont) findings.push(...scanCssLiterals('hardcodedFont', g, files, isStyleScanTarget, isTokenFile, p => p === 'font-family', hasHardcodedFont))
    if (g.checks.hardcodedFontSize) findings.push(...scanCssLiterals('hardcodedFontSize', g, files, isStyleScanTarget, isTokenFile, p => p === 'font-size', hasHardcodedFontSize))
    if (g.checks.hardcodedRadius) findings.push(...scanCssLiterals('hardcodedRadius', g, files, isStyleScanTarget, isTokenFile, isRadiusProp, hasHardcodedRadius))
    if (g.checks.bareElement) findings.push(...checkBareElement(g, files, isComponentFile, isInPrimitivesDir))
    if (g.checks.propsDestructure) findings.push(...checkPropsDestructure(g, files, isComponentFile))
    if (g.checks.globalReach) findings.push(...checkGlobalReach(g, files, isStylesheetFile, isGlobal, isTokenFile))
    if (g.checks.oneGlobalFile) findings.push(...checkOneGlobalFile(g, files, isGlobal))

    const ignoreIndex = buildIgnoreIndex(files)
    let out = filterExempt(findings, ignoreIndex)
    if (g.checks.ignoreReason) out = out.concat(checkIgnoreReasons(files, ignoreIndex))

    out.sort((a, b) => a.check.localeCompare(b.check) || a.path.localeCompare(b.path) || a.line - b.line)
    return out
}
