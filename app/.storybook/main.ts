import type { StorybookConfig } from 'storybook-solidjs-vite'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Storybook for the Bismuth `app/src/ui/` Solid.js component library.
 *
 * Framework: `storybook-solidjs-vite` (community Solid renderer + Storybook's Vite
 * builder). NOTE: this package has NO Storybook-8 build — it starts at 9.0.0 — so we
 * run Storybook 9. `@storybook/addon-essentials` does not exist for SB9 either (its
 * features — controls / actions / viewport / backgrounds / docs — are baked into core),
 * so no addons are needed for the catalog. See `.storybook/README.md`.
 */

/** Walk up from `start` to the nearest `package.json` carrying a `workspaces` field — the same
 *  marker Vite's own `server.fs.allow` auto-detection looks for, just anchored at a REAL path
 *  instead of a possibly-symlinked one (see `viteFinal` below for why that distinction matters). */
function findWorkspaceRoot(start: string): string {
    let dir = start
    for (;;) {
        const pkgPath = join(dir, 'package.json')
        if (existsSync(pkgPath)) {
            try {
                if (JSON.parse(readFileSync(pkgPath, 'utf8')).workspaces) return dir
            } catch {}
        }
        const parent = dirname(dir)
        if (parent === dir) return start
        dir = parent
    }
}

const config: StorybookConfig = {
    framework: 'storybook-solidjs-vite',
    // Stories are colocated next to the components they document. Widened past src/ui so
    // feature surfaces (bases/, calendar/, graph/, ...) can carry their own stories too.
    stories: ['../src/**/*.stories.@(ts|tsx)'],
    addons: [],
    // WORKTREE FIX (found while deriving --prose-scale for task 1, two-fonts plan): a git
    // worktree carries its OWN copy of bun.lock at its root (worktree-hygiene practice), which
    // makes Vite's `server.fs.allow` auto-detection (`searchForWorkspaceRoot`) stop AT the
    // worktree root instead of continuing up to the real repo root — even though `node_modules`
    // is a SYMLINK into that real repo root (every worktree shares one `node_modules` store).
    // Consequence: every @font-face `url()` whose real, symlink-resolved path lands outside the
    // worktree 403s as "outside of Vite serving allow list", and the browser silently falls back
    // to a system font — measured directly: @fontsource-variable/lora and the PRE-EXISTING
    // @fontsource/monaspace-xenon both 403 identically in a worktree-run Storybook. A worktree
    // Storybook can therefore LOOK like it verified a font (renders, no console error visible to
    // a casual look) while never having loaded it — exactly the silent-fallback failure this
    // whole plan exists to fix, just one layer down in the tooling instead of in tokens.css.
    // Fix: widen fs.allow to the REAL workspace root, found by resolving node_modules' symlink
    // and walking up from there (mirrors Vite's own root-finding, just anchored correctly).
    async viteFinal(viteConfig) {
        const realRoot = findWorkspaceRoot(
            dirname(realpathSync(join(__dirname, '..', 'node_modules'))),
        )
        viteConfig.server = viteConfig.server ?? {}
        viteConfig.server.fs = viteConfig.server.fs ?? {}
        viteConfig.server.fs.allow = [
            ...(viteConfig.server.fs.allow ?? []),
            realRoot,
        ]
        return viteConfig
    },
}

export default config
