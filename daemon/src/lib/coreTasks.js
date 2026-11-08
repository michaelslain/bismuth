// Runtime re-export of core's due-task query. A plain .js file with a hand-written .d.ts so the
// daemon's stricter tsc (noUncheckedIndexedAccess) does not type-check core's transitive imports.
export { dueTasks, isDeniedPath } from '../../../core/src/dueTasks.ts'
