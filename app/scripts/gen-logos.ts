// app/scripts/gen-logos.ts
// Dev script (re-runnable, committed): writes each logo mark to app/public/logos/.
// Not part of the app build/runtime. Re-run after editing logoMarks.ts:
//   bun run app/scripts/gen-logos.ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MARK_NAMES, buildMark } from './logoMarks'

const here = import.meta.dir
const outDir = join(here, '..', 'public', 'logos')
mkdirSync(outDir, { recursive: true })

for (const name of MARK_NAMES) {
    const file = join(outDir, `${name}.svg`)
    writeFileSync(file, buildMark(name) + '\n')
    console.log(`wrote ${file}`)
}
console.log(`done: ${MARK_NAMES.length} marks`)
