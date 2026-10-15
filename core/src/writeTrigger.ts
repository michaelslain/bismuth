import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'

/** Drop a trigger file the daemon polls (`<dir>/.triggers/<base>`). This is the daemon's
 *  general file-based control port — for crons it means "run now", for processes "reconcile
 *  runtime to disk `enabled`", for daemon pages (daemonPages.ts) "run this approved action".
 *  Best-effort: only the running, owner daemon consumes it. Its own module so daemonPages.ts —
 *  which the daemon binary imports for the email bridge — stays free of daemon.ts's settings chain. */
export function writeTrigger(dir: string, base: string): void {
    const triggerDir = join(dir, '.triggers')
    mkdirSync(triggerDir, { recursive: true })
    writeFileSync(join(triggerDir, base), new Date().toISOString())
}
