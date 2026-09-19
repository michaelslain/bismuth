// YAML-subset parser for the `governance:` block of DESIGN.md's frontmatter.
// Handles: maps, nested maps, lists (`- a` and `[a, b]` forms), quoted/unquoted
// scalar strings, booleans, `#` comments. Anything else throws a clear error.
// Copied alongside checks.mjs — keep this file dependency-free too.

export function parseYamlGovernanceBlock(designMdText) {
    const fm = extractFrontmatter(designMdText)
    if (fm === null) return null
    const lines = tokenizeLines(fm)
    let govIdx = -1
    let inlineValue = ''
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].indent !== 0) continue
        const c = findColon(lines[i].text)
        if (c === -1) continue
        if (lines[i].text.slice(0, c).trim() !== 'governance') continue
        govIdx = i
        inlineValue = lines[i].text.slice(c + 1).trim()
        break
    }
    if (govIdx === -1) return null
    if (inlineValue === '{}') return {}
    if (inlineValue !== '') {
        throw new Error(`governance: must be a nested block, not an inline value ("${inlineValue}")`)
    }
    if (govIdx + 1 >= lines.length || lines[govIdx + 1].indent === 0) return {}
    const childIndent = lines[govIdx + 1].indent
    const [obj] = parseBlock(lines, govIdx + 1, childIndent)
    return obj
}

function extractFrontmatter(text) {
    const m = text.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/)
    return m ? m[1] : null
}

function tokenizeLines(fm) {
    const raw = fm.split('\n')
    const lines = []
    for (let i = 0; i < raw.length; i++) {
        const lineNo = i + 1
        if (raw[i].includes('\t')) {
            throw new Error(`tab character not supported in governance YAML at line ${lineNo}`)
        }
        const stripped = stripComment(raw[i]).replace(/\s+$/, '')
        if (stripped.trim() === '') continue
        lines.push({ indent: stripped.match(/^ */)[0].length, text: stripped.trim(), lineNo })
    }
    return lines
}

function stripComment(line) {
    let inS = false
    let inD = false
    for (let i = 0; i < line.length; i++) {
        const c = line[i]
        if (c === "'" && !inD) inS = !inS
        else if (c === '"' && !inS) inD = !inD
        else if (c === '#' && !inS && !inD && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i)
    }
    return line
}

function findColon(text) {
    let inS = false
    let inD = false
    for (let i = 0; i < text.length; i++) {
        const c = text[i]
        if (c === "'" && !inD) inS = !inS
        else if (c === '"' && !inS) inD = !inD
        else if (c === ':' && !inS && !inD && (i + 1 === text.length || text[i + 1] === ' ')) return i
    }
    return -1
}

function parseBlock(lines, startIdx, indent) {
    const obj = {}
    let i = startIdx
    while (i < lines.length && lines[i].indent >= indent) {
        if (lines[i].indent > indent) {
            throw new Error(`unexpected indent at line ${lines[i].lineNo}: "${lines[i].text}"`)
        }
        const line = lines[i].text
        if (line.startsWith('- ') || line === '-') {
            throw new Error(`unexpected list item outside a list at line ${lines[i].lineNo}: "${line}"`)
        }
        const c = findColon(line)
        if (c === -1) throw new Error(`expected "key: value" at line ${lines[i].lineNo}: "${line}"`)
        const key = line.slice(0, c).trim()
        const rest = line.slice(c + 1).trim()
        i++
        if (rest === '') {
            const next = lines[i]
            if (next && next.indent > indent && (next.text.startsWith('- ') || next.text === '-')) {
                const [list, ni] = parseBlockList(lines, i, next.indent)
                obj[key] = list
                i = ni
            } else if (next && next.indent > indent) {
                const [child, ni] = parseBlock(lines, i, next.indent)
                obj[key] = child
                i = ni
            } else {
                obj[key] = null
            }
        } else if (rest.startsWith('[')) {
            if (!rest.endsWith(']')) throw new Error(`unterminated flow list at line ${lines[i - 1].lineNo}: "${rest}"`)
            obj[key] = parseFlowList(rest)
        } else if (rest === '{}') {
            obj[key] = {}
        } else if (rest.startsWith('{') || rest.startsWith('|') || rest.startsWith('>') || rest.startsWith('&') || rest.startsWith('*')) {
            throw new Error(`unsupported YAML form at line ${lines[i - 1].lineNo}: "${rest}"`)
        } else {
            obj[key] = parseScalar(rest)
        }
    }
    return [obj, i]
}

function parseBlockList(lines, startIdx, indent) {
    const list = []
    let i = startIdx
    while (i < lines.length && lines[i].indent === indent && (lines[i].text.startsWith('- ') || lines[i].text === '-')) {
        const val = lines[i].text === '-' ? '' : lines[i].text.slice(2).trim()
        list.push(parseScalar(val))
        i++
    }
    return [list, i]
}

function parseFlowList(raw) {
    const inner = raw.trim().slice(1, -1)
    if (inner.trim() === '') return []
    const items = []
    let cur = ''
    let inS = false
    let inD = false
    for (const c of inner) {
        if (c === "'" && !inD) { inS = !inS; cur += c }
        else if (c === '"' && !inS) { inD = !inD; cur += c }
        else if (c === ',' && !inS && !inD) { items.push(cur); cur = '' }
        else cur += c
    }
    if (cur.trim() !== '') items.push(cur)
    return items.map(parseScalar)
}

function parseScalar(raw) {
    const s = raw.trim()
    if (s === '') return ''
    if ((s.startsWith('"') && s.endsWith('"') && s.length >= 2) || (s.startsWith("'") && s.endsWith("'") && s.length >= 2)) {
        return s.slice(1, -1)
    }
    if (s === 'true') return true
    if (s === 'false') return false
    return s
}
