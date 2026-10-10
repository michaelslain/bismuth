// Runtime re-export of core's brain composer. A plain .js file with a hand-written .d.ts so the
// daemon's stricter tsc (noUncheckedIndexedAccess) does not type-check core's transitive imports.
export { composeBrain, invalidateBrain } from '../../../core/src/brain.ts'
