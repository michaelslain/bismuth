// Shared types for `bismuth doctor` — the engine (run.ts), the sections (sections/*) and every
// surface (CLI, MCP bridge, core routes, launch toast) speak these shapes.
import type { Exec } from '../serviceUnit'

export type Severity = 'ok' | 'info' | 'warn' | 'error'
export type RepairRisk = 'safe' | 'destructive'
export interface Repair {
    risk: RepairRisk
    description: string
    apply(): Promise<string[]>
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
