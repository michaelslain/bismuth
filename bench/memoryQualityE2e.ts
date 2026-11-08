// End-to-end check of the memory-quality work against the REAL embedder, on a COPY of a fixture
// vault in a temp dir (never the user's vault).
//   bun bench/memoryQualityE2e.ts [--keep]
// Prints one PASS/FAIL line per criterion and exits non-zero on any FAIL. There is no SKIP: a model
// that cannot load is a FAIL with the reason. Every external step runs under
// `perl -e 'alarm shift; exec @ARGV' <secs> ...`; in-process calls run under a deadline.
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { addDaysISO, todayISO } from '../memory/src'
import { encodeProjectDir } from '../memory/src/sessionHistory'

const ROOT = resolve(import.meta.dir, '..')
const keep = process.argv.includes('--keep')

const results: { name: string; ok: boolean; detail: string }[] = []
const record = (name: string, ok: boolean, detail = '') => {
    results.push({ name, ok, detail })
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  --  ${detail}` : ''}`)
}
const clip = (s: string, n = 700) => (s.length > n ? `${s.slice(0, n)}...` : s)

const run = async (secs: number, cmd: string[], env: Record<string, string | undefined> = process.env) => {
    const p = Bun.spawn(['perl', '-e', 'alarm shift; exec @ARGV', String(secs), ...cmd], { cwd: ROOT, env, stdout: 'pipe', stderr: 'pipe' })
    const [stdout, stderr] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()])
    return { code: await p.exited, stdout, stderr }
}
const bismuth = (secs: number, args: string[]) => run(secs, ['bun', join(ROOT, 'cli/src/index.ts'), ...args])
const within = async <T,>(ms: number, name: string, p: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const late = new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error(`${name} gave no answer in ${ms / 1000} s`)), ms)
    })
    try {
        return await Promise.race([p, late])
    } finally {
        clearTimeout(timer)
    }
}
const put = (path: string, body: string | Uint8Array) => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, body)
}
const hitsOf = (stdout: string): any[] => {
    try {
        const j = JSON.parse(stdout)
        return Array.isArray(j) ? j : (j.hits ?? j.results ?? [])
    } catch {
        return []
    }
}
/** Run a check; a throw is that line's FAIL, not the script's crash. */
const line = async (name: string, f: () => Promise<{ ok: boolean; detail?: string }>) => {
    try {
        const r = await f()
        record(name, r.ok, r.detail ?? '')
    } catch (e) {
        record(name, false, `threw: ${(e as Error).message ?? e}`)
    }
}

const makePdf = (pages: string[]): string => {
    const esc = (t: string) => t.replace(/[\\()]/g, m => `\\${m}`)
    const objs: string[] = ['<< /Type /Catalog /Pages 2 0 R >>']
    objs.push(`<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`)
    objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
    pages.forEach((t, i) => {
        const stream = `BT /F1 12 Tf 20 100 Td (${esc(t)}) Tj ET`
        objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 6000 200] /Contents ${5 + i * 2} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`)
        objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
    })
    let out = '%PDF-1.4\n'
    const offs: number[] = []
    objs.forEach((o, i) => {
        offs.push(out.length)
        out += `${i + 1} 0 obj\n${o}\nendobj\n`
    })
    const xref = out.length
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
    for (const o of offs) out += `${String(o).padStart(10, '0')} 00000 n \n`
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
    return out
}

const noteFile = (type: string, updated: string, description: string, body: string) =>
    `---\ntype: ${type}\nupdated: ${updated}\ncreated: ${updated}\ndescription: ${description}\n---\n${body}\n`

const tmpRoot = mkdtempSync(join(tmpdir(), 'memory-quality-e2e-'))
const vault = join(tmpRoot, 'vault')
const vaultOff = join(tmpRoot, 'vault-off')
const home = join(tmpRoot, 'home')
const claudeDir = join(tmpRoot, 'claude')
const realModels = join(homedir(), '.bismuth', 'models')
const CHAT_ID = '7a1c2e90-5b3d-4f6a-9c8e-1d2b3c4d5e6f'

const SETTINGS = (emb: boolean) =>
    `daemon:\n  enabled: true\n  recall:\n    enabled: true\nembeddings:\n  enabled: ${emb}\n`

let exitCode = 0
try {
    mkdirSync(home, { recursive: true })
    if (existsSync(realModels)) symlinkSync(realModels, join(home, 'models'))
    process.env.BISMUTH_HOME = home
    process.env.CLAUDE_CONFIG_DIR = claudeDir
    process.env.BISMUTH_DOCS_DIR = join(ROOT, 'docs')
    process.env.BROWSER = 'none'

    const today = todayISO()
    const yesterday = addDaysISO(today, -1)
    const mem = join(vault, '.daemon', 'memory')

    // ---- fixture vault (a copy, in the temp dir) -------------------------------------------------
    mkdirSync(mem, { recursive: true })
    cpSync(join(ROOT, 'memory/test/fixtures/recallGraph'), mem, { recursive: true })
    put(join(vault, '.settings'), SETTINGS(true))
    put(join(vault, 'Ops', 'Backups.md'), '# Backup schedule\n\nThe nightly backup cron runs at 02:00 and its timezone follows the vault timezone, so daylight saving shifts never move the backup an hour.\n')
    put(join(vault, 'papers', 'backups.pdf'), makePdf(['Backup operations handbook. Nightly backup cron jobs and retention windows.', 'Timezone handling for the backup cron: read the schedule in the vault timezone so daylight saving changes do not shift runs.']))
    const at = `${yesterday}T10:00:00`
    put(
        join(claudeDir, 'projects', encodeProjectDir(vault), `${CHAT_ID}.jsonl`),
        [
            { type: 'user', timestamp: at, message: { role: 'user', content: 'why does the nightly backup cron fire an hour late after the clocks change' } },
            { type: 'assistant', timestamp: at, message: { role: 'assistant', content: [{ type: 'text', text: 'the backup cron schedule was read in UTC; setting the timezone to the vault timezone fixed the daylight saving drift' }] } },
        ]
            .map(l => JSON.stringify(l))
            .join('\n') + '\n',
    )
    // digest + now notes for lines 3 and the recall line
    put(join(mem, `day-${yesterday}.md`), noteFile('daily', yesterday, 'fixed the backup cron timezone drift', `## Sessions\n\n- fixed the backup cron timezone drift (session 7a1c2e90)\n\n## Notes changed\n\n- [[Ops/Backups]]\n\n## Facts touched\n\n- [[hive-locations-and-codes]]`))
    put(join(mem, 'now.md'), noteFile('now', `${yesterday} 21:00`, 'what is live right now', `## Active\n\n- backup cron work\n\n## Due\n\n(none)\n\n## Open threads\n\n- none\n\n## Recent days\n\n- [[day-${yesterday}]] fixed the backup cron timezone drift`))
    cpSync(vault, vaultOff, { recursive: true })
    put(join(vaultOff, '.settings'), SETTINGS(false))

    const { recallServiceFor, createRecallService, readRecallSettingsSync, sourcesFor } = await import('../core/src/memoryRecall')
    const svc = recallServiceFor(vault)
    const ask = (prompt: string, sessionId: string, s: { recall: typeof svc.recall } = svc) =>
        within(120_000, `recall "${prompt.slice(0, 40)}"`, s.recall({ mode: 'prompt', sessionId, prompt, channel: 'chat' }))

    // ---- 1. blended search ----------------------------------------------------------------------
    await line('1a. search (no flag) blends >=2 source kinds, exit 0', async () => {
        // sources index in the background on first use: ask again until kinds from 2 sources show
        let r = await bismuth(300, ['search', 'backup cron timezone', '--json', '--vault', vault])
        let kinds = new Set(hitsOf(r.stdout).map(h => h.kind))
        for (let i = 0; i < 10 && kinds.size < 2; i++) {
            await Bun.sleep(5000)
            r = await bismuth(300, ['search', 'backup cron timezone', '--json', '--vault', vault])
            kinds = new Set(hitsOf(r.stdout).map(h => h.kind))
        }
        const ok = r.code === 0 && kinds.size >= 2
        return { ok, detail: ok ? `kinds=${[...kinds].join(',')}` : `exit=${r.code} kinds=${[...kinds]} stdout=${clip(r.stdout)} stderr=${clip(r.stderr, 400)}` }
    })
    await line('1b. search with embeddings off: keyword hits + stderr line, exit 0', async () => {
        const r = await bismuth(120, ['search', 'backup cron timezone', '--json', '--vault', vaultOff])
        const n = hitsOf(r.stdout).length
        const ok = r.code === 0 && n > 0 && r.stderr.includes('meaning search unavailable (') && r.stderr.includes('): keyword results only')
        return { ok, detail: ok ? `hits=${n}` : `exit=${r.code} hits=${n} stderr=${clip(r.stderr, 400)}` }
    })

    // ---- 2. docs search -------------------------------------------------------------------------
    await line('2. docs search "how do embeddings work": top 3 has a semantic-search or recall page', async () => {
        const r = await bismuth(300, ['docs', 'search', 'how do embeddings work', '--limit', '3', '--vault', vault])
        const top = hitsOf(r.stdout).slice(0, 3).map(h => String(h.path))
        const ok = r.code === 0 && top.some(p => /semantic-search|recall/.test(p))
        return { ok, detail: ok ? top.join(' | ') : `exit=${r.code} top=${top.join(' | ')} stdout=${clip(r.stdout, 300)} stderr=${clip(r.stderr, 400)}` }
    })

    // ---- 3. session start + time routing --------------------------------------------------------
    await line('3a. session start has "# Now (written" and no day- index line', async () => {
        const r = await within(120_000, 'session-start', svc.recall({ mode: 'session-start', sessionId: 'e2e-ss', channel: 'chat', source: 'startup' }))
        const ctx = r.context ?? ''
        const i = ctx.indexOf('# Now (written')
        // the Now section may name day notes under "Recent days"; the memory index must not list any
        const rest = i < 0 ? ctx : ctx.slice(0, i) + ctx.slice(i).replace(/^# Now[\s\S]*?(?=\n# |$)/, '')
        const dayLines = rest.split('\n').filter(l => /day-\d{4}-\d{2}-\d{2}/.test(l))
        const ok = i >= 0 && dayLines.length === 0
        return { ok, detail: ok ? '' : `now=${i >= 0} dayLines=${JSON.stringify(dayLines)} reason=${r.reason} ctx=${clip(ctx)}` }
    })
    await line('3b. "what did i do yesterday" recall has "# What happened yesterday"', async () => {
        const r = await ask('what did i do yesterday', 'e2e-time')
        const ctx = r.context ?? ''
        const ok = ctx.includes('# What happened yesterday') && ctx.includes(`fixed the backup cron timezone drift`)
        return { ok, detail: ok ? '' : `reason=${r.reason} ctx=${clip(ctx)}` }
    })

    // ---- 4. health rollup -----------------------------------------------------------------------
    await line('4. health: old day notes -> rollup naming the week note; current day notes -> no dated-name', async () => {
        const { brainHealth, loadAllNotes, digestName } = await import('../memory/src')
        const dir = join(tmpRoot, 'health-mem')
        const old = addDaysISO(today, -60)
        const old2 = addDaysISO(today, -59)
        const wk = digestName('week', old)
        const wk2 = digestName('week', old2)
        for (const d of [old, old2]) put(join(dir, `day-${d}.md`), noteFile('daily', d, `day ${d}`, `## Sessions\n\n- did things`))
        put(join(dir, `day-${today}.md`), noteFile('daily', today, 'today', `## Sessions\n\n- doing things`))
        put(join(dir, 'beekeeping-basics.md'), noteFile('fact', today, 'bees', 'bees make honey'))
        const h = brainHealth(await loadAllNotes(dir), { now: new Date() })
        const roll = h.items.filter(i => i.kind === 'rollup')
        const named = roll.some(i => i.notes.includes(`day-${old}`) && i.detail.includes(wk))
        const dated = h.items.filter(i => i.kind === 'dated-name' && i.notes.some(n => n === `day-${today}`))
        const stale = roll.some(i => i.notes.includes(`day-${today}`))
        const ok = named && dated.length === 0 && !stale && (wk === wk2 ? true : roll.some(i => i.detail.includes(wk2)))
        return { ok, detail: ok ? `rollup: ${roll.map(i => i.detail).join('; ')}` : `want ${wk} named=${named} dated=${JSON.stringify(dated)} rollup=${JSON.stringify(roll)}` }
    })

    // ---- 5. dream prompt ------------------------------------------------------------------------
    await line('5. dream prompt carries {{nowFacts}} and the cron substitution fills it', async () => {
        const { DEFAULT_CRONS } = await import('../daemon/src/daemon/defaultCrons')
        const { substituteNowFacts } = await import('../daemon/src/daemon/cron')
        const dream = DEFAULT_CRONS.find(c => c.name === 'dream')?.content ?? ''
        const has = dream.includes('{{nowFacts}}')
        const filled = await substituteNowFacts(dream, { root: vault, memoryDir: mem } as any)
        const ok = has && !filled.includes('{{nowFacts}}') && !filled.includes('facts unavailable') && filled.includes('fixed the backup cron timezone drift')
        return { ok, detail: ok ? '' : `stock has placeholder=${has} stillLiteral=${filled.includes('{{nowFacts}}')}` }
    })

    // ---- 6. corrupt gate model ------------------------------------------------------------------
    await line('6. corrupt sourceGateModel injects no # Vault files / # Past chats but still injects memory', async () => {
        const { loadGateModel } = await import('../core/src/sourceGate')
        const { sharedSemanticChannel } = await import('../core/src/memoryEmbed')
        const { sharedReranker } = await import('../core/src/memoryRerank')
        const wire = (gateModel?: ReturnType<typeof loadGateModel>) =>
            createRecallService({
                memoryDir: () => mem,
                settings: () => readRecallSettingsSync(vault),
                embedder: () => sharedSemanticChannel().embedder(),
                semanticScores: (e, q, n, d) => sharedSemanticChannel().semanticScores(e, q, n, d),
                reranker: () => sharedReranker(),
                sources: q => sourcesFor(vault, q),
                gateModel,
                vault,
            })
        const bad = loadGateModel({ version: 'x', weights: 'nope', bias: null })
        const prompt = 'what was the fix when the backup cron started running an hour late after daylight saving changed'
        // control: the same wiring with the committed model must inject a source section, or the
        // closed-gate result below proves nothing
        const open = wire()
        let control = await ask(prompt, 'e2e-open-0', open)
        for (let i = 1; i < 10 && !/# (Vault files|Past chats)/.test(control.context ?? ''); i++) {
            await Bun.sleep(5000)
            control = await ask(prompt, `e2e-open-${i}`, open)
        }
        const controlOk = /# (Vault files|Past chats)/.test(control.context ?? '')
        const r = await ask(prompt, 'e2e-closed', wire(bad))
        const ctx = r.context ?? ''
        const leaked = ['# Vault files', '# Past chats'].filter(h => ctx.includes(h))
        const mr = await ask('help me with my biol 214 lab write-up', 'e2e-closed-mem', wire(bad))
        const memOk = (mr.injected ?? []).includes('biol-214-lab-policy') && !/# (Vault files|Past chats)/.test(mr.context ?? '')
        const ok = controlOk && leaked.length === 0 && memOk
        return { ok, detail: ok ? `control sources=${JSON.stringify(control.sources)}; closed leaks none; memory injected=${mr.injected.join(',')}` : `controlOk=${controlOk} leaked=${leaked} memOk=${memOk} reason=${r.reason} ctx=${clip(ctx, 400)}` }
    })
} catch (err) {
    record('script', false, `crashed: ${(err as Error).stack ?? err}`)
} finally {
    const failed = results.filter(r => !r.ok).length
    console.log(`\n${results.length - failed}/${results.length} criteria passed`)
    exitCode = failed ? 1 : 0
    if (keep) console.log(`kept: ${tmpRoot}`)
    else rmSync(tmpRoot, { recursive: true, force: true })
}
process.exit(exitCode)
