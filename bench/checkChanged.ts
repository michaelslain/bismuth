/**
 * bench/checkChanged.ts — run the baseline-free invariant checks over ONLY the stories the current
 * diff can affect.
 *
 * This is the everyday visual check: seconds for a typical edit, nothing to re-record, and it stays
 * valid while the design changes. `bench/cssBaseline.ts` remains available for a deliberate
 * before/after on one component (`--story <prefix>`), but it is not what you run habitually — it
 * records absolute pixel values, so every intentional restyle makes it red until it is re-recorded.
 *
 *   bun bench/checkChanged.ts              # invariants over stories reachable from the diff
 *   bun bench/checkChanged.ts --base main  # diff against another ref
 *   bun bench/checkChanged.ts --all        # every story, ignoring the diff
 */
const ROOT = new URL('..', import.meta.url).pathname
const argv = process.argv.slice(2)
const passthrough = argv.filter(a => a !== '--all')

const run = async (args: string[]) => {
    const p = Bun.spawn(['bun', ...args], { cwd: ROOT, stdout: 'inherit', stderr: 'inherit' })
    return await p.exited
}

let prefixes: string[] = []
if (!argv.includes('--all')) {
    const p = Bun.spawn(['bun', 'bench/affected.ts', '--prefixes', ...passthrough], { cwd: ROOT })
    const out = await new Response(p.stdout).text()
    await p.exited
    prefixes = out.split('\n').map(s => s.trim()).filter(Boolean)
    // affected.ts prints NOTHING when a global file changed — that means "all stories", not "none".
    // Treating an empty list as "nothing to do" would turn the widest-reaching change in the repo
    // into the quietest check, which is the wrong way round.
    if (!prefixes.length) {
        console.error('→ no scoping possible (global file changed, or no mapped stories) — checking EVERY story')
        process.exit(await run(['bench/invariants.ts']))
    }
    console.error(`→ ${prefixes.length} affected story prefix(es): ${prefixes.join(', ')}`)
} else {
    process.exit(await run(['bench/invariants.ts']))
}

let worst = 0
for (const p of prefixes) {
    const code = await run(['bench/invariants.ts', '--story', p])
    if (code > worst) worst = code
}
process.exit(worst)
