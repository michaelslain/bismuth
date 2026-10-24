// A static scan of a command's `run` source for the flags and positionals it reads, so a command's
// declared `args` (cli/src/types.ts) cannot drift from its body. Used by mcpArgParity.test.ts.
//
// `Function.prototype.toString` gives the transpiled body: comments gone, strings double-quoted.
// The scan is closed-world on purpose. `args` may only reach `flag`/`bool`/`parseJsonFlag`/
// `positionals` or a helper registered in ARG_HELPERS; anything else is reported, because a helper
// that reads flags on its own is exactly how a flag escapes the declaration.

export type FlagRead = 'value' | 'bool'

/** Shared helpers that read flags out of `args` on a command's behalf, with the flags they read.
 *  Register a new one here; the scan fails on a call it does not know. */
export const ARG_HELPERS: Record<string, Record<string, FlagRead>> = {
    requireVault: { vault: 'value' },
    optionalVault: { vault: 'value' },
    memoryDir: { memory: 'value' },
    out: { pretty: 'bool' },
    // cli/src/semantic.ts: coreFor() reads --api and the vault
    semanticQuery: { api: 'value', vault: 'value' },
    // cli/src/commands/memory.ts: unconfinedMemoryDir() and confineAgentToVaultMemory()
    resolveMemory: { memory: 'value', vault: 'value' },
}

const DIRECT_KIND: Record<string, FlagRead | undefined> = {
    flag: 'value',
    parseJsonFlag: 'value',
    bool: 'bool',
}

export type Scan = {
    /** Every flag the body reads, with how. */
    flags: Map<string, FlagRead>
    /** True when the body calls `positionals(args…)`. */
    readsPositionals: boolean
    /** Reads the scan cannot attribute to a name: dynamic flag names, ad hoc `args` access, unknown helpers. */
    problems: string[]
}

/** Blank string and template contents so parentheses inside messages cannot unbalance the walk. */
function blankStrings(src: string): string {
    return src.replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""')
}

/** The identifier of the call whose argument list holds the token at `at`, or null. */
function enclosingCallee(code: string, at: number): string | null {
    let depth = 0
    for (let i = at - 1; i >= 0; i--) {
        const ch = code[i]
        if (ch === ')' || ch === ']' || ch === '}') depth++
        else if (ch === '(' || ch === '[' || ch === '{') {
            if (depth > 0) depth--
            else if (ch !== '(') return null
            else return /([A-Za-z_$][\w$]*)\s*$/.exec(code.slice(0, i))?.[1] ?? null
        }
    }
    return null
}

export function scanRun(src: string): Scan {
    const flags = new Map<string, FlagRead>()
    const problems: string[] = []
    const note = (name: string, kind: FlagRead) => {
        const prior = flags.get(name)
        if (prior && prior !== kind) problems.push(`--${name} is read as both a value and a boolean`)
        flags.set(name, prior ?? kind)
    }

    for (const m of src.matchAll(/\b(flag|bool|parseJsonFlag)\(\s*args\s*,\s*(?:(["'])([\w-]+)\2)?/g)) {
        if (m[3] === undefined) problems.push(`${m[1]}(args, …) reads a flag whose name is not a string literal`)
        else note(m[3], DIRECT_KIND[m[1]]!)
    }
    // An `--x` literal is a hand-rolled read (args.includes('--x')); one that is not also a flag()/bool() read is unseen.
    for (const m of src.matchAll(/(["'])--([a-z][\w-]*)\1/g))
        if (!flags.has(m[2])) problems.push(`--${m[2]} appears as a string literal but is not read with flag()/bool()`)

    const code = blankStrings(src)
    const head = /^\s*(?:async\s*)?\(?\s*args\s*\)?\s*=>/.exec(code)
    for (const m of code.matchAll(/\bargs\b/g)) {
        const at = m.index!
        if (head && at < head[0].length) continue
        if (/^\s*[.[]/.test(code.slice(at + 4))) {
            problems.push('args is read directly (args.x or args[i]); use flag(), bool() or positionals()')
            continue
        }
        const callee = enclosingCallee(code, at)
        if (callee && (Object.hasOwn(DIRECT_KIND, callee) || callee === 'positionals')) continue
        const helper = callee && Object.hasOwn(ARG_HELPERS, callee) ? ARG_HELPERS[callee] : undefined
        if (helper) for (const [name, kind] of Object.entries(helper)) note(name, kind)
        else problems.push(`args is passed to ${callee ?? 'an expression'}(…), which is not in ARG_HELPERS`)
    }

    return { flags, readsPositionals: /\bpositionals\(\s*args/.test(code), problems: [...new Set(problems)] }
}
