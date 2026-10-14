import { describe, expect, it } from 'bun:test'

const run = (...flags: string[]) =>
    Bun.spawnSync(['bun', 'run', `${import.meta.dir}/paneLoad.ts`, ...flags], { stderr: 'pipe', stdout: 'pipe' })

describe('paneLoad flags', () => {
    it('exits non-zero naming the missing --base and --api rather than defaulting to :6006', () => {
        const r = run('--pdf', 'x.pdf')
        expect(r.exitCode).not.toBe(0)
        const err = new TextDecoder().decode(r.stderr)
        expect(err).toContain('--base')
        expect(err).toContain('--api')
    })
})
