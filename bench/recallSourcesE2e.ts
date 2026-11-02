// End-to-end check of recall sources against the REAL embedder, reranker and Claude Haiku.
//   bun bench/recallSourcesE2e.ts [--vault <tmp>] [--keep]
// Builds a temp vault (note, two-page PDF, PNG with text), a fixture chat log under a temp
// CLAUDE_CONFIG_DIR and a temp BISMUTH_HOME (models symlinked from the real one, so nothing is
// downloaded twice and no cache lands in ~/.bismuth), then prints one PASS/FAIL line per criterion
// and exits non-zero on any FAIL. A SKIP or a missing model is a FAIL. The one image criterion makes
// a real `claude-haiku-4-5` call through the user's own claude login. Every external step runs under
// `perl -e 'alarm shift; exec @ARGV' <secs> ...`.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { encodeProjectDir } from '../memory/src/sessionHistory'

const ROOT = resolve(import.meta.dir, '..')
const argv = process.argv.slice(2)
const keep = argv.includes('--keep')
const vaultFlag = argv.indexOf('--vault')

const results: { name: string; ok: boolean; detail: string }[] = []
const record = (name: string, ok: boolean, detail: string) => {
    results.push({ name, ok, detail })
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  --  ${detail}` : ''}`)
}
const clip = (s: string, n = 900) => (s.length > n ? `${s.slice(0, n)}...` : s)

const run = async (secs: number, cmd: string[], cwd = ROOT, env: Record<string, string | undefined> = process.env) => {
    const p = Bun.spawn(['perl', '-e', 'alarm shift; exec @ARGV', String(secs), ...cmd], {
        cwd,
        env,
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const [stdout, stderr] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()])
    return { code: await p.exited, stdout, stderr }
}
const bismuth = (secs: number, args: string[], env?: Record<string, string | undefined>) =>
    run(secs, ['bun', join(ROOT, 'cli/src/index.ts'), ...args], ROOT, env)

const makePdf = (pages: string[]): string => {
    const esc = (t: string) => t.replace(/[\\()]/g, m => `\\${m}`)
    const objs: string[] = []
    objs.push('<< /Type /Catalog /Pages 2 0 R >>')
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

const put = (path: string, body: string | Uint8Array) => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, body)
}

const PAGE2 = 'Lighthouse keepers record barometric pressure every dawn and hoist the storm cone when it drops below nine hundred ninety millibars.'
const IMAGE_TEXT = 'QUARTERLY HARBOR BUDGET'
const CHAT_ID = '5f3b8a52-91c4-4d2e-8a77-0c1d2e3f4a5b'
const CHAT_DATE = '2026-10-20'

const tmpRoot = mkdtempSync(join(tmpdir(), 'recall-sources-e2e-'))
const vault = vaultFlag >= 0 ? resolve(argv[vaultFlag + 1]) : join(tmpRoot, 'vault')
const home = join(tmpRoot, 'home')
const claudeDir = join(tmpRoot, 'claude')
const realModels = join(homedir(), '.bismuth', 'models')
const realConfigDir = process.env.CLAUDE_CONFIG_DIR

let exitCode = 0
try {
    // ---- environment ---------------------------------------------------------------------------
    mkdirSync(home, { recursive: true })
    if (existsSync(realModels)) symlinkSync(realModels, join(home, 'models'))
    process.env.BISMUTH_HOME = home
    process.env.CLAUDE_CONFIG_DIR = claudeDir
    process.env.BISMUTH_DOCS_DIR = join(ROOT, 'docs')
    process.env.BROWSER = 'none'

    // ---- fixture vault -------------------------------------------------------------------------
    // a realistic memory graph (unrelated notes) so recall runs its full pipeline, not the empty-memory exit
    mkdirSync(join(vault, '.daemon', 'memory'), { recursive: true })
    cpSync(join(ROOT, 'memory/test/fixtures/recallGraph'), join(vault, '.daemon', 'memory'), { recursive: true })
    put(
        join(vault, '.settings'),
        'daemon:\n  enabled: true\n  recall:\n    enabled: true\nembeddings:\n  enabled: true\n  describeImages: true\n',
    )
    put(join(vault, 'Projects', 'Launch.md'), '# Launch plan\n\nThe harbor dashboard launches on the first Monday of March. Freeze the schema, rehearse the rollback and brief the support rota.\n')
    put(join(vault, 'papers', 'lighthouse.pdf'), makePdf(['Coastal navigation overview. Charts, tides and buoys guide ships into harbour.', PAGE2]))
    const { createCanvas } = (await import(join(ROOT, 'core/node_modules/@napi-rs/canvas'))) as typeof import('@napi-rs/canvas')
    const canvas = createCanvas(1100, 260)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 1100, 260)
    ctx.fillStyle = '#000000'
    ctx.font = 'bold 72px sans-serif'
    ctx.fillText(IMAGE_TEXT, 30, 150)
    const png = join(vault, 'photos', 'board.png')
    put(png, canvas.toBuffer('image/png'))

    const at = `${CHAT_DATE}T10:00:00`
    put(
        join(claudeDir, 'projects', encodeProjectDir(vault), `${CHAT_ID}.jsonl`),
        [
            { type: 'user', timestamp: at, message: { role: 'user', content: 'why does the nightly backup cron fire an hour late after the clocks change' } },
            { type: 'assistant', timestamp: at, message: { role: 'assistant', content: [{ type: 'text', text: 'the cron expression was read in UTC; setting the timezone field to the vault timezone fixed the daylight saving drift' }] } },
        ]
            .map(l => JSON.stringify(l))
            .join('\n') + '\n',
    )

    const { recallServiceFor } = await import('../core/src/memoryRecall')
    const svc = recallServiceFor(vault)
    // In-process calls run under a deadline too: a hang is a FAIL line, not a stuck run.
    const within = async <T,>(ms: number, name: string, p: Promise<T>): Promise<T> => {
        let timer: ReturnType<typeof setTimeout> | undefined
        const late = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${name} gave no answer in ${ms / 1000} s`)), ms)
        })
        try {
            return await Promise.race([p, late])
        } catch (e) {
            record(`deadline: ${name}`, false, String((e as Error).message ?? e))
            throw e
        } finally {
            clearTimeout(timer)
        }
    }
    const ask = (prompt: string, sessionId: string) =>
        within(60_000, `recall "${prompt.slice(0, 40)}"`, svc.recall({ mode: 'prompt', sessionId, prompt, channel: 'chat' }))
    // A source index builds in the background on first use, so a cold first prompt can legitimately
    // find nothing. Ask again (fresh session each time, so the dedup ledger never hides a hit) until
    // the section shows or the budget runs out; the attempt count is part of the result line.
    const askWarm = async (prompt: string, id: string, want: string, tries = 12) => {
        let last = await ask(prompt, `${id}-0`)
        let n = 1
        while (!(last.context ?? '').includes(want) && n < tries) {
            await Bun.sleep(5000)
            last = await ask(prompt, `${id}-${n}`)
            n++
        }
        return { r: last, n }
    }
    const HEADS = ['# Vault files', '# Past chats', '# Bismuth docs']
    // Core starts the docs pass at boot (`syncDocsEmbeddings`); this process boots no core, so it runs
    // that warmup itself and waits for it, as a running core would have done before the first prompt.
    const docsT0 = Date.now()
    const docsReady = await within(300_000, 'docsIndexReady', (await import('../core/src/docsEmbed')).docsIndexReady()).catch(() => false)
    console.log(`  (docs index ready=${docsReady} in ${Math.round((Date.now() - docsT0) / 1000)} s)`)

    // ---- 1. docs --------------------------------------------------------------------------------
    {
        const { r, n } = await askWarm('how do I write a calendar view base', 'e2e-docs', '# Bismuth docs')
        console.log(`  (docs: ${n} attempt(s) until the section appeared)`)
        const ctxt = r.context ?? ''
        const idx = ctxt.indexOf('# Bismuth docs')
        const line = idx < 0 ? undefined : ctxt.slice(idx).split('\n').find(l => l.includes('bases/authoring/calendar'))
        const ok = !!line
        record('docs: calendar question injects # Bismuth docs naming bases/authoring/calendar', ok, ok ? line! : `reason=${r.reason} sources=${JSON.stringify(r.sources)} context=${clip(ctxt)}`)
    }

    // ---- 2. chats -------------------------------------------------------------------------------
    {
        const { r, n } = await askWarm('what was the fix when the backup cron started running an hour late after daylight saving changed', 'e2e-chat', '# Past chats')
        console.log(`  (chats: ${n} attempt(s) until the section appeared)`)
        const ctxt = r.context ?? ''
        const idx = ctxt.indexOf('# Past chats')
        const line = idx < 0 ? undefined : ctxt.slice(idx).split('\n').find(l => l.includes(CHAT_DATE))
        const ok = !!line && line.includes(`bismuth history show ${CHAT_ID}`)
        record('chats: paraphrase injects # Past chats line with date + history show <id>', ok, ok ? line! : `reason=${r.reason} sources=${JSON.stringify(r.sources)} context=${clip(ctxt)}`)
    }

    // ---- 3. pdf page 2 --------------------------------------------------------------------------
    {
        const q = 'storm cone hoisted when barometric pressure drops below nine hundred ninety millibars'
        const r = await bismuth(300, ['search', q, '--semantic', '--json', '--vault', vault])
        let hits: any[] = []
        try {
            const j = JSON.parse(r.stdout)
            hits = Array.isArray(j) ? j : (j.hits ?? j.results ?? [])
        } catch {}
        const hit = hits.find(h => h.kind === 'pdf' && h.page === 2)
        record('pdf: search --semantic returns kind pdf page 2', !!hit, hit ? JSON.stringify(hit).slice(0, 200) : `exit=${r.code} stdout=${clip(r.stdout)} stderr=${clip(r.stderr, 400)}`)
    }

    // ---- 4. image describe + search -------------------------------------------------------------
    {
        // the describe call is Claude Code through the user's own login, which lives in the REAL
        // config dir: give that one child back the CLAUDE_CONFIG_DIR the shell had (usually unset)
        const loginEnv: Record<string, string | undefined> = { ...process.env, CLAUDE_CONFIG_DIR: realConfigDir }
        if (realConfigDir === undefined) delete loginEnv.CLAUDE_CONFIG_DIR
        const d = await bismuth(300, ['image', 'describe', png, '--vault', vault], loginEnv)
        let desc = ''
        let skipped: string | undefined
        try {
            const j = JSON.parse(d.stdout)
            desc = String(j.description ?? '')
            skipped = j.skipped
        } catch {}
        const companion = `${png}.md`
        const comp = existsSync(companion) ? readFileSync(companion, 'utf8') : ''
        const mentions = /harbou?r/i.test(desc) && /budget/i.test(desc) && /description/.test(comp)
        record('image: describe writes a description mentioning the image text', mentions, mentions ? clip(desc, 200) : `exit=${d.code} skipped=${skipped} stdout=${clip(d.stdout)} stderr=${clip(d.stderr, 400)} companion=${clip(comp, 400)}`)
        const s = await bismuth(300, ['search', 'quarterly harbor budget', '--semantic', '--json', '--vault', vault])
        let hits: any[] = []
        try {
            const j = JSON.parse(s.stdout)
            hits = Array.isArray(j) ? j : (j.hits ?? j.results ?? [])
        } catch {}
        const hit = hits[0]?.kind === 'image' ? hits[0] : undefined
        record('image: search --semantic for its text returns kind image first', !!hit, hit ? JSON.stringify(hit).slice(0, 200) : `exit=${s.code} stdout=${clip(s.stdout)} stderr=${clip(s.stderr, 400)}`)
    }

    // ---- 4b. technical prompt with no docs answer -----------------------------------------------
    {
        const r = await ask('fix the failing typescript test in my react project', 'e2e-ts-test')
        const ctxt = r.context ?? ''
        const i = ctxt.indexOf('# Bismuth docs')
        record('negative: unrelated technical prompt injects no # Bismuth docs', i < 0, i < 0 ? '' : `sources=${JSON.stringify(r.sources)}\n${clip(ctxt.slice(i))}`)
    }

    // ---- 5. unrelated prompt --------------------------------------------------------------------
    {
        const r = await ask("what's a good pasta recipe", 'e2e-pasta')
        const ctxt = r.context ?? ''
        const found = HEADS.filter(h => ctxt.includes(h))
        record('negative: unrelated prompt injects no source section', found.length === 0 && !(r.sources?.length), found.length ? `sections=${found.join(', ')} sources=${JSON.stringify(r.sources)}\n${clip(ctxt)}` : '')
    }

    // ---- 6. recall eval -------------------------------------------------------------------------
    {
        const mem = join(ROOT, 'memory/test/fixtures/recallGraph')
        const evalRun = (cases: string, extra: string[]) =>
            run(840, ['bun', join(ROOT, 'bench/recallEval.ts'), '--dir', mem, '--service', '--embeddings', 'on', ...extra, '--cases', join(ROOT, cases), '--json'])
        const parse = (s: string): Record<string, any[]> | null => {
            try {
                return JSON.parse(s.slice(s.indexOf('{')))
            } catch {
                return null
            }
        }
        const on = await evalRun('memory/test/fixtures/recallSourceCases.json', ['--sources', 'on'])
        const j = parse(on.stdout)
        const rows = j ? Object.values(j).flat().filter((r: any) => r && r.sourceFalseInject !== undefined) : []
        const ours = rows.at(-1) as any
        const okSrc = on.code === 0 && !!ours && ours.sourceFalseInject === 0 && ours.sourceRecall5 === 1
        record('eval: --sources on has sourceFalseInject 0 and every source case found', okSrc, ours ? `sourceRecall5=${ours.sourceRecall5} sourceFalseInject=${ours.sourceFalseInject}` : `exit=${on.code} stdout=${clip(on.stdout)} stderr=${clip(on.stderr, 400)}`)

        const off = await evalRun('memory/test/fixtures/recallCases.json', ['--sources', 'off'])
        const abs = await evalRun('memory/test/fixtures/recallCases.json', [])
        const strip = (j: Record<string, any[]> | null) =>
            JSON.stringify(j, (k, v) => (k === 'p50ms' || k === 'p95ms' ? undefined : v))
        const jo = parse(off.stdout)
        const ja = parse(abs.stdout)
        const same = !!jo && !!ja && off.code === 0 && abs.code === 0 && strip(jo) === strip(ja)
        record('eval: recallCases.json with --sources off matches --sources absent', same, same ? '' : `off exit=${off.code} abs exit=${abs.code}\noff=${clip(strip(jo) ?? off.stdout + off.stderr, 500)}\nabs=${clip(strip(ja) ?? abs.stdout + abs.stderr, 500)}`)
    }
} catch (err) {
    record('script', false, `crashed: ${(err as Error).stack ?? err}`)
} finally {
    const failed = results.filter(r => !r.ok).length
    console.log(`\n${results.length - failed}/${results.length} criteria passed`)
    exitCode = failed ? 1 : 0
    if (keep) console.log(`kept: ${tmpRoot} (vault ${vault})`)
    else rmSync(tmpRoot, { recursive: true, force: true })
}
process.exit(exitCode)
