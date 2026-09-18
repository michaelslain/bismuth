// design-system gate — installed by ~/.claude/skills/design-system (install-gate)
// Fails when a component stylesheet uses a literal instead of a token, a stylesheet has more
// than one importer, a component has no story, or (solid) props are destructured. Accepted
// debt lives in design-system.baseline.json; exemptions live in DESIGN.md's governance block.
import { describe, it, expect } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

// this file lives at scripts/designSystem.test.ts, so one '..' from its own dir is the repo root
const root = join(import.meta.dir, '..')
const gate = join(root, 'scripts', 'designSystem', 'gate.mjs')
const baseline = join(root, 'design-system.baseline.json')

describe('design system', () => {
    it('has no findings outside the baseline', () => {
        const args = [gate, '--root', root]
        if (existsSync(baseline)) args.push('--baseline', baseline)
        const r = spawnSync('node', args, { encoding: 'utf8' })
        if (r.status !== 0) console.log(r.stdout + r.stderr)
        expect(r.status).toBe(0)
    })
})
