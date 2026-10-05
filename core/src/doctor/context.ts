// The real DoctorContext: this machine's home, PATH and process table. Pure wiring — exercised by
// the CLI; every test builds its own context under a temp dir (core/test/doctor/fakeCtx.ts).
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { LINK_DIRS } from '../bismuthInstall'
import { whichBinary } from '../claudeWhich'
import { defaultExec } from '../serviceUnit'
import type { DoctorContext } from './types'

export function defaultContext(opts: { vault?: string } = {}): DoctorContext {
    const home = homedir()
    return {
        home,
        bismuthHome: join(home, '.bismuth'),
        claudeDir: join(home, '.claude'),
        tmpDir: tmpdir(),
        platform: process.platform,
        linkDirs: LINK_DIRS,
        vault: opts.vault,
        installSrc: process.env.BISMUTH_INSTALL_SRC,
        daemonBundle: process.env.BISMUTH_DAEMON_BUNDLE,
        now: Date.now(),
        exec: defaultExec,
        which: whichBinary,
        pidAlive: pid => {
            try {
                process.kill(pid, 0)
                return true
            } catch (e) {
                return (e as NodeJS.ErrnoException).code === 'EPERM'
            }
        },
    }
}
