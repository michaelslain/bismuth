// The real DoctorContext: this machine's home, PATH and process table. Pure wiring — exercised by
// the CLI; every test builds its own context under a temp dir (core/test/doctor/fakeCtx.ts).
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { LINK_DIRS } from '../bismuthInstall'
import { whichBinary } from '../claudeWhich'
import { registeredVaultRoots, vaultDaemonDir } from '../daemon'
import { appendActivity } from '../daemonActivity'
import { defaultExec } from '../serviceUnit'
import { gitBackup } from './gitBackup'
import type { DoctorContext } from './types'

/** The vaults whose daemon log a run reports to: the run's own vault, or every registered vault
 *  when it has none (a repair to the machine is news to each of them). */
export function activityVaults(
    vault: string | undefined,
    registered: () => string[] = registeredVaultRoots,
): string[] {
    return vault ? [resolve(vault)] : registered()
}

export function defaultContext(opts: { vault?: string } = {}): DoctorContext {
    const home = homedir()
    const bismuthHome = join(home, '.bismuth')
    return {
        home,
        bismuthHome,
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
        backup: (id, description, paths) =>
            gitBackup({ exec: defaultExec, bismuthHome }, id, description, paths),
        logActivity: event => {
            for (const v of activityVaults(opts.vault))
                appendActivity(vaultDaemonDir(v), event)
        },
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
