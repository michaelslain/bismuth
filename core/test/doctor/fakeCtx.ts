// A DoctorContext built entirely under a fresh temp home, for every doctor test. Nothing here
// touches the real home: exec succeeds silently, which() finds nothing, no pid is alive.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DoctorContext } from '../../src/doctor/types'

export function fakeCtx(overrides: Partial<DoctorContext> = {}): DoctorContext {
    const home = mkdtempSync(join(tmpdir(), 'doctor-'))
    return {
        home,
        bismuthHome: join(home, '.bismuth'),
        claudeDir: join(home, '.claude'),
        tmpDir: join(home, 'tmp'),
        platform: 'darwin',
        linkDirs: [join(home, 'usr-local-bin'), join(home, '.local', 'bin')],
        now: Date.now(),
        exec: async () => ({ code: 0, stdout: '', stderr: '' }),
        which: () => null,
        pidAlive: () => false,
        ...overrides,
    }
}
