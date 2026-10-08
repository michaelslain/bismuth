// Subprocess probe for registry.test.ts: prints the roots loadEnabledVaults() (default) or
// loadAllVaults() (argv `all`) returns.
import { loadAllVaults, loadEnabledVaults } from '../src/lib/registry.ts'

const roots =
    process.argv[2] === 'all'
        ? (await loadAllVaults()).map(v => v.ctx.root)
        : (await loadEnabledVaults()).map(c => c.root)
console.log(JSON.stringify(roots))
