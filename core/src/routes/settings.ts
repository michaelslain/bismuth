import { themesFeed } from '../theme/themeFiles'
import {
    setSettingInFile,
    getVaultSchema,
    serializeSettingsForFrontend,
    SETTINGS_FILE,
} from '../settings'
import { evaluateStatusBar, countTree } from '../statusBarEval'
import {
    hasHiddenChars,
    isCommandTrusted,
    trustCommand,
} from '../statusBarTrust'
import { ok, error, type Handler, type RouteContext } from './context'

export default function settingsRoutes(
    ctx: RouteContext,
): Record<string, Handler> {
    const {
        bootReconcile,
        requestChannel,
        rowsCache,
        statusItems,
        statusRunner,
        tasksCache,
        treeCache,
        cfg,
    } = ctx
    return {
        'GET /config': async (_, __) => {
            // Read-only view of how core was launched — surfaced in the settings page.
            return ok({ vault: cfg.vault, memory: cfg.memory ?? null })
        },

        // Every custom theme in <vault>/.themes (valid + invalid with diagnostics). Uncached: the
        // folder is tiny and the app refetches on a `.themes/*.yaml` SSE path.
        'GET /themes': async (_, __) => ok(await themesFeed(cfg.vault)),

        'GET /settings': async (_, __) => {
            // Parsed app settings (file merged over defaults) for frontend hydration.
            await bootReconcile
            return ok(await serializeSettingsForFrontend(cfg.vault))
        },

        // Owner-only: a `run:` segment's output is arbitrary shell output and a query segment's count
        // is derived from the whole vault (hidden notes included), neither filterable per path.
        'GET /status-bar': async req => {
            if (requestChannel(req) !== 'owner') return error('forbidden', 403)
            const segments = await evaluateStatusBar(await statusItems(), {
                root: cfg.vault,
                vaultRows: () => rowsCache.get(),
                vaultTasks: () => tasksCache.get(),
                countFiles: async () => countTree(await treeCache.get()),
                run: statusRunner,
                isTrusted: command => isCommandTrusted(cfg.vault, command),
            })
            return ok({ segments })
        },

        // Owner-only approval of a `run:` command. The command must equal a `run` in the vault's
        // CURRENT statusBar, so an owner click can only ever approve what .settings actually holds.
        'POST /status-bar/trust': async req => {
            if (requestChannel(req) !== 'owner') return error('forbidden', 403)
            const body = (await req.json().catch(() => ({}))) as {
                command?: unknown
            }
            const command = body.command
            if (typeof command !== 'string' || !command)
                return error('missing command', 400)
            if (!(await statusItems()).some(i => i.run === command))
                return error('command is not in the vault statusBar', 400)
            if (hasHiddenChars(command))
                return error(
                    'command contains newlines or bidi control characters and cannot be approved',
                    400,
                )
            trustCommand(cfg.vault, command)
            return ok({ ok: true })
        },

        'GET /schema': async (_, __) => {
            // Property registry (from settings.yaml `properties:`) for note validation + autocomplete.
            return ok(await getVaultSchema(cfg.vault))
        },
    }
}

export function settingsMutatingRoutes(
    ctx: RouteContext,
): Record<string, Handler> {
    const { mutatingHandler, cfg } = ctx
    return {
        'POST /set-setting': mutatingHandler(
            async req => {
                // The single backend write path for settings.yaml: merge one value at `path`
                // in place (preserving comments + the properties registry + unknown keys).
                // Frontend toggles call this instead of rewriting the whole file.
                const body = (await req.json()) as {
                    path?: unknown
                    value?: unknown
                }
                if (
                    !Array.isArray(body.path) ||
                    !body.path.every(s => typeof s === 'string')
                ) {
                    return error('bad path', 400)
                }
                await setSettingInFile(
                    cfg.vault,
                    body.path as string[],
                    body.value,
                )
                return ok({ ok: true })
            },
            () => SETTINGS_FILE, // invalidate settings.yaml so subscribers re-hydrate
        ),
    }
}
