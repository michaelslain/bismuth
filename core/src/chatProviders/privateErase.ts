// core/src/chatProviders/privateErase.ts
// Erasers for PRIVATE conversations: a chat whose private toggle is on when the conversation ends
// (each driver's setPrivate). Every agent writes its conversation to disk while it runs, so the chat
// keeps its native continuity; the driver runs its backend's eraser once the agent's process has
// exited, so nothing can be written after the erase. opencode erases through its own server instead
// (opencode.ts's erasePrivateSession).
//
// Every eraser is best-effort and silent, like the rest of teardown: a store that is absent or locked
// is left as it is rather than failing the close. SQLite deletes run with `secure_delete` on and a
// truncating WAL checkpoint after, so the freed pages and the write-ahead log do not keep the text.
//
// The paths come from each CLI's own source or docs; the comment on each eraser names what it
// removes. Paths resolve from the CLI's own home override when one is set (CODEX_HOME,
// GEMINI_CLI_HOME, CLINE_DATA_DIR, GOOSE_PATH_ROOT, OPENCLAW_STATE_DIR) and the real home otherwise.
import { Database } from 'bun:sqlite'
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { openclawSessionKey, type PrivateEraser } from './acp/agents'

/** Runs one CLI command to completion. Injected so tests never spawn a real agent. */
export type RunCli = (argv: string[], cwd: string) => Promise<void>

export const runCli: RunCli = async (argv, cwd) => {
    const proc = Bun.spawn(argv, { cwd, stdout: 'ignore', stderr: 'ignore', stdin: 'ignore' })
    await proc.exited
}

export type EraseContext = {
    /** The backend's own session or thread id. */
    sessionId: string
    /** The Bismuth chat id (openclaw keys its session on it). */
    chatId: string
    cwd: string
    /** ms epoch the chat's process started; files a CLI writes without a session id in the name are
     *  matched by being modified at or after it. */
    startedAt: number
    env: Record<string, string | undefined>
    run?: RunCli
    /** The CLI binary to run, when the eraser shells out. */
    bin?: string
}

const home = (env: EraseContext['env']) => env.HOME || homedir()

/** Every file path under `dir`, recursively; empty when `dir` is absent. */
function walk(dir: string): string[] {
    if (!existsSync(dir)) return []
    const out: string[] = []
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name)
        if (e.isDirectory()) out.push(...walk(p))
        else out.push(p)
    }
    return out
}

/** Direct children of `dir` (files and directories); empty when `dir` is absent. */
function children(dir: string): string[] {
    return existsSync(dir) ? readdirSync(dir).map(n => join(dir, n)) : []
}

function remove(path: string): void {
    try {
        rmSync(path, { recursive: true, force: true })
    } catch {
        /* best-effort */
    }
}

function modifiedSince(path: string, since: number): boolean {
    try {
        return statSync(path).mtimeMs >= since
    } catch {
        return false
    }
}

/** Drop every line of a JSON-lines file that mentions `needle`. */
function dropLines(path: string, needle: string): void {
    if (!existsSync(path)) return
    try {
        const lines = readFileSync(path, 'utf8').split('\n')
        const kept = lines.filter(l => !l.includes(needle))
        if (kept.length !== lines.length) writeFileSync(path, kept.join('\n'))
    } catch {
        /* best-effort */
    }
}

/** Run `deletes` against an SQLite file with secure_delete on, then truncate its WAL. Each statement
 *  names a table that may not exist in this CLI version; a missing table is skipped. */
export function sqliteErase(path: string, deletes: [table: string, where: string][], id: string): void {
    if (!existsSync(path)) return
    let db: Database | null = null
    try {
        db = new Database(path)
        db.exec('PRAGMA busy_timeout = 3000')
        db.exec('PRAGMA secure_delete = ON')
        const tables = new Set(
            (db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(
                r => r.name,
            ),
        )
        db.transaction(() => {
            for (const [table, where] of deletes) {
                if (!tables.has(table)) continue
                const n = (where.match(/\?/g) ?? []).length
                db!.query(`DELETE FROM "${table}" WHERE ${where}`).run(...Array(n).fill(id))
            }
        })()
        db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    } catch {
        /* best-effort: locked or a different schema */
    } finally {
        db?.close()
    }
}

/** codex (`codex exec`) and codex-acp: the thread's rollout transcript (live and archived), its
 *  shell snapshots, its line in session_index.jsonl, and its rows in state_5.sqlite and
 *  thread_history_1.sqlite. The thread id is the rollout file name's trailing UUID. */
export async function eraseCodexThread(ctx: EraseContext): Promise<void> {
    if (!ctx.sessionId) return
    const id = ctx.sessionId
    const root = ctx.env.CODEX_HOME || join(home(ctx.env), '.codex')
    for (const dir of ['sessions', 'archived_sessions'])
        for (const f of walk(join(root, dir))) if (f.endsWith(`-${id}.jsonl`)) remove(f)
    for (const f of children(join(root, 'shell_snapshots')))
        if (f.slice(f.lastIndexOf('/') + 1).startsWith(id)) remove(f)
    dropLines(join(root, 'session_index.jsonl'), id)
    sqliteErase(
        join(root, 'state_5.sqlite'),
        [
            ['thread_dynamic_tools', 'thread_id = ?'],
            ['thread_attachments', 'thread_id = ?'],
            ['thread_spawn_edges', 'parent_thread_id = ? OR child_thread_id = ?'],
            ['threads', 'id = ?'],
        ],
        id,
    )
    sqliteErase(
        join(root, 'thread_history_1.sqlite'),
        [
            ['thread_items', 'thread_id = ?'],
            ['thread_realtime_items', 'thread_id = ?'],
            ['thread_turns', 'thread_id = ?'],
            ['thread_history_projection_state', 'thread_id = ?'],
        ],
        id,
    )
}

/** claude (chat.ts) and claude-code-acp: the Claude Agent SDK writes
 *  `~/.claude/projects/<cwd slug>/<id>.jsonl` and a sibling `<id>/` directory for subagents. Every
 *  project directory is searched, so the slug's encoding does not matter. */
export async function eraseClaudeSession(ctx: EraseContext): Promise<void> {
    if (!ctx.sessionId) return
    const projects = join(ctx.env.CLAUDE_CONFIG_DIR || join(home(ctx.env), '.claude'), 'projects')
    for (const dir of children(projects)) {
        remove(join(dir, `${ctx.sessionId}.jsonl`))
        remove(join(dir, ctx.sessionId))
    }
}

/** gemini: under `~/.gemini/tmp/<project>/`, the transcript `chats/session-<ts>-<first 8 of id>.jsonl`,
 *  the log `logs/session-<id>.jsonl`, `tool-outputs/session-<id>/` and the `<id>/` directory. */
export async function eraseGeminiSession(ctx: EraseContext): Promise<void> {
    if (!ctx.sessionId) return
    const id = ctx.sessionId
    const short = id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 8)
    const tmp = join(ctx.env.GEMINI_CLI_HOME || home(ctx.env), '.gemini', 'tmp')
    for (const project of children(tmp)) {
        for (const f of children(join(project, 'chats')))
            if (short && /\/session-[^/]*\.jsonl$/.test(f) && f.endsWith(`-${short}.jsonl`)) remove(f)
        remove(join(project, 'chats', id))
        remove(join(project, 'logs', `session-${id}.jsonl`))
        remove(join(project, 'tool-outputs', `session-${id}`))
        remove(join(project, id))
    }
}

/** goose: the session's rows are removed over ACP (`session/delete`) before the process exits; this
 *  removes the full-request logs `<state>/logs/llm_request.<uuid>.jsonl`, which carry no session id,
 *  written while the chat ran. */
export async function eraseGooseLogs(ctx: EraseContext): Promise<void> {
    const state = ctx.env.GOOSE_PATH_ROOT
        ? join(ctx.env.GOOSE_PATH_ROOT, 'state')
        : join(ctx.env.XDG_STATE_HOME || join(home(ctx.env), '.local', 'state'), 'goose')
    for (const f of children(join(state, 'logs')))
        if (/\/llm_request\.[^/]+\.jsonl$/.test(f) && modifiedSince(f, ctx.startedAt)) remove(f)
}

/** cline: `cline history delete --session-id <id>` removes the sessions.db row; the transcript
 *  directory `<dataDir>/sessions/<id>/` is removed here too. */
export async function eraseClineSession(ctx: EraseContext): Promise<void> {
    if (!ctx.sessionId) return
    await (ctx.run ?? runCli)([ctx.bin ?? 'cline', 'history', 'delete', '--session-id', ctx.sessionId], ctx.cwd).catch(
        () => {},
    )
    const data = ctx.env.CLINE_DATA_DIR || join(home(ctx.env), '.cline', 'data')
    remove(join(data, 'sessions', ctx.sessionId))
}

/** openclaw: `openclaw sessions delete <key> --yes` removes the session, but keeps its transcript as a
 *  `<file>.jsonl.deleted.<timestamp>` archive; archives written from the moment of the delete on are
 *  removed. The key is the one agents.ts's sessionKeyArgs gives the chat. */
export async function eraseOpenclawSession(ctx: EraseContext): Promise<void> {
    const before = Date.now() - 1000
    await (ctx.run ?? runCli)(
        [ctx.bin ?? 'openclaw', 'sessions', 'delete', openclawSessionKey(ctx.chatId), '--yes'],
        ctx.cwd,
    ).catch(() => {})
    const state = ctx.env.OPENCLAW_STATE_DIR || join(home(ctx.env), '.openclaw')
    for (const agent of children(join(state, 'agents')))
        for (const f of walk(join(agent, 'sessions')))
            if (/\.jsonl\.deleted\.[^/]+$/.test(f) && modifiedSince(f, before)) remove(f)
}


/** hermes: `hermes sessions delete <id> --yes`, run after the agent process has exited (a still-open
 *  session is recreated on its next save). */
export async function eraseHermesSession(ctx: EraseContext): Promise<void> {
    if (!ctx.sessionId) return
    await (ctx.run ?? runCli)([ctx.bin ?? 'hermes', 'sessions', 'delete', ctx.sessionId, '--yes'], ctx.cwd).catch(
        () => {},
    )
}

/** The eraser each name in agents.ts's `privateErase` stands for. */
export const PRIVATE_ERASERS: Record<PrivateEraser, (ctx: EraseContext) => Promise<void>> = {
    codex: eraseCodexThread,
    claude: eraseClaudeSession,
    gemini: eraseGeminiSession,
    'goose-logs': eraseGooseLogs,
    cline: eraseClineSession,
    openclaw: eraseOpenclawSession,
    hermes: eraseHermesSession,
}
