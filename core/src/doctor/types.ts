// Shared types for `bismuth doctor` — the engine (run.ts), the sections (sections/*) and every
// surface (CLI, MCP bridge, core routes, launch toast) speak these shapes.
import type { ActivityEvent } from '../daemonActivity'
import type { Exec } from '../serviceUnit'

export type Severity = 'ok' | 'info' | 'warn' | 'error'
export type RepairRisk = 'safe' | 'destructive'
interface RepairBase {
    description: string
    apply(): Promise<string[]>
}
/** A destructive repair names every path it deletes or rewrites in `touches`, and the engine
 *  commits them to the doctor's backup repo before `apply` runs. A safe repair may omit it. */
export type Repair =
    | (RepairBase & { risk: 'safe'; touches?: string[] })
    | (RepairBase & { risk: 'destructive'; touches: string[] })
/** Where a destructive repair's files went before it ran: one commit in the backup repo, holding
 *  `file` (a tar.gz of the touched paths, relative to `/`). */
export interface RepairBackup {
    repo: string
    commit: string
    file: string
}
export interface Finding {
    id: string
    severity: Severity
    title: string
    detail?: string
    repair?: Repair
}
export interface DoctorContext {
    home: string
    bismuthHome: string // <home>/.bismuth
    claudeDir: string // <home>/.claude
    tmpDir: string // os.tmpdir()
    platform: NodeJS.Platform
    linkDirs: string[] // candidate CLI link dirs (bismuthInstall's LINK_DIRS)
    vault?: string
    installSrc?: string // BISMUTH_INSTALL_SRC
    daemonBundle?: string // BISMUTH_DAEMON_BUNDLE
    now: number // Date.now() at start
    exec: Exec
    which(bin: string): string | null
    pidAlive(pid: number): boolean
    /** Commit `paths` to the backup repo before a destructive repair. Null when none of them exist
     *  any more; throws when the backup cannot be made, and the repair is then not applied. */
    backup(id: string, description: string, paths: string[]): Promise<RepairBackup | null>
    /** Append one event to the daemon activity log of every vault this run reports to. Never throws. */
    logActivity(event: ActivityEvent): void
}
export interface DoctorSection {
    id: string // 'install' | 'legacy' | 'daemon' | 'runtime' | 'vault' | 'backends'
    title: string
    needsVault?: boolean
    check(ctx: DoctorContext): Promise<Finding[]>
}
export interface DoctorOptions {
    fix?: boolean
    only?: string[]
    risks?: RepairRisk[] // which risks --fix applies; undefined = both
    sections?: string[] // section ids; undefined = all
}
export type RepairStatus = 'applied' | 'failed' | 'skipped'
export interface FindingReport {
    id: string
    section: string
    severity: Severity
    title: string
    detail?: string
    repair?: {
        risk: RepairRisk
        description: string
        status?: RepairStatus
        warnings?: string[]
        backup?: RepairBackup
    }
}
export interface DoctorReport {
    ok: boolean // no error/warn finding left without an applied repair
    vault: string | null
    findings: FindingReport[] // sorted: destructive-repair first, then error > warn > info > ok, then id
    fixed: number
    failed: number
    pending: { safe: number; destructive: number } // repairs present but not applied
    unknownIds: string[] // --only ids that matched no finding
}
