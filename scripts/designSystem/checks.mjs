// design-system skill scripts v1 (2026-09-17) — copied into repos by install-gate; compare this line to detect a stale copy
// Pure logic for the design-system skill. No filesystem access — every input arrives as a
// string or an array of { path, content }. This file is copied into user repos alongside its
// lib/ siblings, so it (and they) must stay dependency-free (plain Node ESM, node:path/posix
// only).

import { basename, extname } from 'node:path/posix'
import { parseYamlGovernanceBlock } from './lib/yamlSubset.mjs'
import { NAMED_COLORS } from './lib/namedColors.mjs'

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
]

const DEFAULT_COMPONENTS_MATCH = '**/[A-Z]*.tsx'
const DEFAULT_COMPONENTS_EXCLUDE = ['**/*.stories.tsx', '**/*.test.tsx', '**/_*']
// manifest.md's example shows a single `**/*.module.css` pattern but notes "also .module.scss" —
// ambiguous whether .scss should count by default. Chosen reading: include it, since scanning
// more files is the stricter option.
const DEFAULT_STYLESHEETS_MATCH = ['**/*.module.css', '**/*.module.scss']
const DEFAULT_STYLESHEETS_IMPORTERS_EXEMPT = ['**/*.stories.*', '**/*.test.*', '**/_*']
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

const COLOR_PROP_NAMES = new Set([
    'color', 'background', 'background-color', 'border', 'border-color', 'outline',
    'outline-color', 'fill', 'stroke', 'box-shadow', 'text-shadow',
    'text-decoration-color', 'caret-color', 'accent-color',
])
function isColorProp(name) {
    return COLOR_PROP_NAMES.has(name) || /^border-(top|right|bottom|left)-color$/.test(name)
}

// CSS-wide keywords that defer to the cascade rather than hardcoding anything. None of these
// are a "literal" in any property, so they're exempt from every hardcoded-* check.
function isCascadeKeyword(value) {
    const s = value.trim().toLowerCase()
    return s === 'inherit' || s === 'initial' || s === 'unset' || s === 'revert'
}

function hasHardcodedColor(value, tokensUse) {
    if (value.includes(tokensUse) || isCascadeKeyword(value)) return false
    const v = value.trim().toLowerCase()
    if (v === 'transparent' || v === 'currentcolor' || v === 'none') return false
    if (/url\(/i.test(value)) return false // avoid flagging color-ish words inside asset filenames
    if (/#[0-9a-f]{3,8}\b/i.test(value)) return true
    if (/\b(rgba?|hsla?|oklch|oklab|lab|lch|color)\(/i.test(value)) return true
    const words = value.toLowerCase().match(/[a-z]+/g) || []
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
const DECL_RE = /(?<![\w$@-])([a-zA-Z-]+)\s*:\s*([^;{}]+);?/g

// Blank out /* ... */ comments (replace non-newline chars with spaces) so DECL_RE can never
// match prose inside a comment — a real stylesheet in the wild had a comment quoting
// `border-radius: 11px` in backticks, which DECL_RE happily "read" as a live declaration.
// Preserves length and line breaks so line numbers computed against the original content stay
// correct.
function blankCssComments(content) {
    return content.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
}

function scanCssLiterals(checkName, g, files, isStylesheetFile, isGlobal, isTokenFile, propTest, valueTest) {
    const findings = []
    for (const f of files) {
        if (!isStylesheetFile(f.path) || isGlobal(f.path) || isTokenFile(f.path)) continue
        const find = makeLineFinder(f.content)
        const clean = blankCssComments(f.content)
        DECL_RE.lastIndex = 0
        let m
        while ((m = DECL_RE.exec(clean))) {
            const prop = m[1].trim().toLowerCase()
            if (!propTest(prop)) continue
            const value = m[2].trim()
            if (!valueTest(value, g.tokens.use)) continue
            findings.push({
                check: checkName, path: f.path, line: find(m.index),
                message: `${prop}: ${value} is a hardcoded literal, not a token`,
                suggestion: `reference a ${g.tokens.use}…) token${g.tokens.files.length ? ' from ' + g.tokens.files.join(', ') : ''}`,
            })
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
        const clean = blankJsComments(f.content)
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

    const findings = []
    if (g.checks.storyCoverage) findings.push(...checkStoryCoverage(g, files, fileSet, isComponentFile, isStoryExempt))
    if (g.checks.oneImporter) findings.push(...checkOneImporter(g, files, isStylesheetFile, isGlobal, isImporterExempt))
    if (g.checks.hardcodedColor) findings.push(...scanCssLiterals('hardcodedColor', g, files, isStylesheetFile, isGlobal, isTokenFile, isColorProp, hasHardcodedColor))
    if (g.checks.hardcodedFont) findings.push(...scanCssLiterals('hardcodedFont', g, files, isStylesheetFile, isGlobal, isTokenFile, p => p === 'font-family', hasHardcodedFont))
    if (g.checks.hardcodedFontSize) findings.push(...scanCssLiterals('hardcodedFontSize', g, files, isStylesheetFile, isGlobal, isTokenFile, p => p === 'font-size', hasHardcodedFontSize))
    if (g.checks.hardcodedRadius) findings.push(...scanCssLiterals('hardcodedRadius', g, files, isStylesheetFile, isGlobal, isTokenFile, p => p === 'border-radius', hasHardcodedRadius))
    if (g.checks.bareElement) findings.push(...checkBareElement(g, files, isComponentFile, isInPrimitivesDir))
    if (g.checks.propsDestructure) findings.push(...checkPropsDestructure(g, files, isComponentFile))

    findings.sort((a, b) => a.check.localeCompare(b.check) || a.path.localeCompare(b.path) || a.line - b.line)
    return findings
}
