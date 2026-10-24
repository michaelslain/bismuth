import { describe, test, expect } from 'bun:test'
import {
    ALL_TOOLS,
    vaultMapCliArgs,
    doctorCliArgs,
    ocrCliArgs,
    pdfToMarkdownCliArgs,
    type ToolDef,
} from '../../mcp/src/server'
import { CLI_TWINS, ARG_EXCEPTIONS } from '../../mcp/src/cliTwins'
import { daemonCliArgs, isDaemonTool } from '../../mcp/src/daemon'
import { registry } from '../src/registry'
import type { FlagDecl } from '../src/types'
import { scanRun } from './commandArgScan'

// MCP <=> CLI parity at the ARGUMENT level, both ways. mcpParity.test.ts pairs tools with commands
// by name; this pairs each input parameter of a tool with a flag or positional of its twin, and each
// flag or positional of the twin with a parameter. One-sided arguments are listed in ARG_EXCEPTIONS
// (mcp/src/cliTwins.ts) with a reason, and an exception that matches nothing fails here too.
//
// A command's arguments are DECLARED on the command (`args`, cli/src/types.ts) and the declaration
// is checked against the body of `run` by a static scan (commandArgScan.ts), so the declaration this
// test pairs against is what the command really reads.

type Param = { name: string; type: string; enum?: readonly string[]; items?: { type?: string }; required: boolean }
type CliArg = { side: 'positional' | 'flag'; name: string; param: string; bool: boolean }

const twins = Object.entries(CLI_TWINS).filter((e): e is [string, string] => e[1] !== null)
const toolDef = (tool: string): ToolDef => ALL_TOOLS.find(t => t.name === tool)!
const norm = (s: string) => s.replace(/[-_]/g, '').toLowerCase()

function paramsOf(tool: string): Param[] {
    const { properties, required = [] } = toolDef(tool).inputSchema
    return Object.entries(properties).map(([name, p]) => ({
        name,
        type: p.type ?? 'string',
        enum: p.enum,
        items: p.items,
        required: required.includes(name),
    }))
}

const flagKind = (d: FlagDecl) => (typeof d === 'string' ? d : d.kind)
const flagParam = (name: string, d: FlagDecl) => (typeof d === 'string' ? name : d.param)

function cliArgsOf(phrase: string): CliArg[] {
    const spec = registry[phrase].args ?? {}
    return [
        ...(spec.positionals ?? []).map(name => ({ side: 'positional' as const, name, param: name, bool: false })),
        ...Object.entries(spec.flags ?? {}).map(([name, d]) => ({
            side: 'flag' as const,
            name,
            param: flagParam(name, d),
            bool: flagKind(d) === 'bool',
        })),
    ]
}

/** Pair a tool's params with its twin's arguments by normalised name. */
function pair(tool: string, phrase: string) {
    const cli = cliArgsOf(phrase)
    const params = paramsOf(tool)
    const pairs: { param: Param; arg: CliArg }[] = []
    const unpairedParams: Param[] = []
    for (const param of params) {
        const arg = cli.find(a => norm(a.param) === norm(param.name))
        if (arg) pairs.push({ param, arg })
        else unpairedParams.push(param)
    }
    const unpairedCli = cli.filter(a => !pairs.some(p => p.arg === a))
    return { pairs, unpairedParams, unpairedCli, cli }
}

type Key = `${string}|${'param' | 'flag' | 'positional'}|${string}`
const exceptionKeys: { key: Key; reason: string }[] = ARG_EXCEPTIONS.flatMap(e =>
    [e.tool].flat().map(tool => {
        const side = 'param' in e ? 'param' : 'flag' in e ? 'flag' : 'positional'
        const name = 'param' in e ? e.param : 'flag' in e ? e.flag : e.positional
        return { key: `${tool}|${side}|${name}` as Key, reason: e.reason }
    }),
)
const excepted = new Set(exceptionKeys.map(e => e.key))

describe('mcp <=> cli argument parity', () => {
    test('every twinned command declares its arguments', () => {
        for (const [tool, phrase] of twins) {
            expect({ tool, phrase, declared: registry[phrase].args !== undefined }).toEqual({ tool, phrase, declared: true })
        }
    })

    test('a command declares exactly the flags and positionals its body reads', () => {
        for (const [, phrase] of twins) {
            const spec = registry[phrase].args ?? {}
            const scan = scanRun(registry[phrase].run.toString())
            const declared = new Map(Object.entries(spec.flags ?? {}).map(([n, d]) => [n, flagKind(d)] as const))
            const problems = [
                ...scan.problems,
                ...[...scan.flags].filter(([n]) => !declared.has(n)).map(([n]) => `reads --${n} but does not declare it`),
                ...[...declared].filter(([n]) => !scan.flags.has(n)).map(([n]) => `declares --${n} but never reads it`),
                ...[...declared]
                    .filter(([n, k]) => scan.flags.has(n) && scan.flags.get(n) !== k)
                    .map(([n, k]) => `declares --${n} as ${k} but reads it as ${scan.flags.get(n)}`),
                ...((spec.positionals?.length ?? 0) > 0 && !scan.readsPositionals
                    ? ['declares positionals but never calls positionals()']
                    : []),
            ]
            expect({ phrase, problems }).toEqual({ phrase, problems: [] })
        }
    })

    test('every mcp param has a cli flag or positional, or is a listed exception', () => {
        for (const [tool, phrase] of twins) {
            const missing = pair(tool, phrase)
                .unpairedParams.filter(p => !excepted.has(`${tool}|param|${p.name}`))
                .map(p => p.name)
            expect({ tool, phrase, paramsWithoutCliArg: missing }).toEqual({ tool, phrase, paramsWithoutCliArg: [] })
        }
    })

    test('every cli flag and positional has an mcp param, or is a listed exception', () => {
        for (const [tool, phrase] of twins) {
            const missing = pair(tool, phrase)
                .unpairedCli.filter(a => !excepted.has(`${tool}|${a.side}|${a.name}`))
                .map(a => (a.side === 'flag' ? `--${a.name}` : `<${a.name}>`))
            expect({ tool, phrase, cliArgsWithoutParam: missing }).toEqual({ tool, phrase, cliArgsWithoutParam: [] })
        }
    })

    test('a paired param and cli argument agree on boolean versus value', () => {
        for (const [tool, phrase] of twins) {
            const wrong = pair(tool, phrase)
                .pairs.filter(({ param, arg }) => (param.type === 'boolean') !== arg.bool)
                .map(({ param, arg }) => `${param.name} is ${param.type} but ${arg.name} is ${arg.bool ? 'bool' : 'value'}`)
            expect({ tool, wrong }).toEqual({ tool, wrong: [] })
        }
    })

    test('no cli command declares two arguments for one param', () => {
        for (const [, phrase] of twins) {
            const keys = cliArgsOf(phrase).map(a => norm(a.param))
            expect({ phrase, dupes: keys.filter((k, i) => keys.indexOf(k) !== i) }).toEqual({ phrase, dupes: [] })
        }
    })

    test('every exception has a reason and names a real one-sided argument', () => {
        const live = new Set<Key>()
        for (const [tool, phrase] of twins) {
            const { unpairedParams, unpairedCli } = pair(tool, phrase)
            for (const p of unpairedParams) live.add(`${tool}|param|${p.name}`)
            for (const a of unpairedCli) live.add(`${tool}|${a.side}|${a.name}`)
        }
        const problems = [
            ...exceptionKeys.filter(e => e.reason.trim().length < 20).map(e => `${e.key}: reason is missing or too short`),
            ...exceptionKeys.filter(e => !live.has(e.key)).map(e => `${e.key}: matches no one-sided argument (stale, or the other side now has it)`),
            ...exceptionKeys.map(e => e.key).filter((k, i, all) => all.indexOf(k) !== i).map(k => `${k}: listed twice`),
        ]
        expect(problems).toEqual([])
    })

    // The audits above compare declarations. This one runs the mcp side's argv builder, so a param
    // the schema offers but the builder drops (or a flag it invents) fails too.
    const MAPPERS: Record<string, (a: Record<string, unknown>) => string[]> = {
        vault_map: vaultMapCliArgs,
        bismuth_doctor: doctorCliArgs,
        ocr: a => ocrCliArgs(a, '/v'),
        pdf_to_markdown: a => pdfToMarkdownCliArgs(a, '/v'),
    }
    for (const [tool] of twins) if (isDaemonTool(tool)) MAPPERS[tool] = a => daemonCliArgs(tool, a, '/v')
    /** Tools that call the same function as their CLI twin instead of spawning it; there is no argv to check. */
    const IN_PROCESS = ['bismuth_docs_list', 'bismuth_docs_search', 'bismuth_docs_read', 'brain', 'remember', 'recall', 'forget']

    const sample = (p: Param, i = 0): unknown => {
        if (p.enum) return p.enum[0]
        if (p.type === 'number') return 7
        if (p.type === 'boolean') return i === 0
        if (p.type === 'array') return p.items?.type === 'string' ? ['a', 'b'] : [{ id: 'x' }]
        return `sample-${p.name}`
    }

    test('every twin is built by an argv mapper or is called in process', () => {
        const unaccounted = twins.map(([t]) => t).filter(t => !MAPPERS[t] && !IN_PROCESS.includes(t))
        expect(unaccounted).toEqual([])
    })

    test('an argv mapper passes every paired param to its flag or positional and only declared flags', () => {
        for (const [tool, phrase] of twins) {
            const map = MAPPERS[tool]
            if (!map) continue
            const { pairs, cli } = pair(tool, phrase)
            const required = Object.fromEntries(paramsOf(tool).filter(p => p.required).map(p => [p.name, sample(p)]))
            const base = map(required)
            const emitted = new Set(base.filter(t => t.startsWith('--')))
            const problems: string[] = []
            for (const { param, arg } of pairs) {
                const tries = param.type === 'boolean' ? [0, 1] : [0]
                const passed = tries.some(i => {
                    const v = sample(param, i)
                    const argv = map({ ...required, [param.name]: v })
                    argv.filter(t => t.startsWith('--')).forEach(t => emitted.add(t))
                    if (arg.side === 'positional') return argv.includes(String(v))
                    const at = argv.indexOf(`--${arg.name}`)
                    if (at < 0) return false
                    if (arg.bool) return argv.join(' ') !== base.join(' ') || param.required
                    return typeof v === 'string' || typeof v === 'number' ? argv[at + 1] === String(v) : true
                })
                if (!passed) problems.push(`${param.name} is not passed as ${arg.side === 'flag' ? `--${arg.name}` : `<${arg.name}>`}`)
            }
            const declared = new Set(cli.filter(a => a.side === 'flag').map(a => `--${a.name}`))
            for (const t of emitted) if (!declared.has(t)) problems.push(`the mapper emits ${t}, which ${phrase} does not declare`)
            expect({ tool, problems }).toEqual({ tool, problems: [] })
        }
    })
})

describe('the run scan', () => {
    const scan = (src: string) => scanRun(src)
    test('sees direct flag and bool reads and helper reads', () => {
        const s = scan(`async (args) => { const [a] = positionals(args); const v = requireVault(args); if (bool(args, "off")) out(flag(args, 'limit'), args) }`)
        expect([...s.flags]).toEqual([['off', 'bool'], ['limit', 'value'], ['vault', 'value'], ['pretty', 'bool']])
        expect(s.readsPositionals).toBe(true)
        expect(s.problems).toEqual([])
    })
    test('reports a dynamic flag name, an unknown helper, ad hoc access and a hand-rolled literal', () => {
        expect(scan(`args => { flag(args, name) }`).problems).toHaveLength(1)
        expect(scan(`args => { sneaky(args) }`).problems).toEqual(['args is passed to sneaky(…), which is not in ARG_HELPERS'])
        expect(scan(`args => { args.includes("x") }`).problems).toHaveLength(1)
        expect(scan(`args => { args.includes("--x") }`).problems.length).toBeGreaterThan(0)
        expect(scan(`args => { flag(args, "x"); bool(args, "x") }`).problems).toEqual(['--x is read as both a value and a boolean'])
    })
    test('ignores parentheses and --words inside messages', () => {
        const s = scan(`args => { fail("usage: x (--vault <dir>) [--pretty]"); out(flag(args, "a"), args) }`)
        expect(s.problems).toEqual([])
        expect([...s.flags.keys()]).toEqual(['a', 'pretty'])
    })
})
