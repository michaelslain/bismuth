// SAVE's I/O for BaseSettings: run one planned write. The plan itself is pure and lives in
// baseSettingsPlan.ts.

import { api } from '../api'
import type { WriteOp } from './baseSettingsPlan'

/** Run one planned write against the base file. */
export async function runOp(path: string, o: WriteOp): Promise<void> {
    if (o.op === 'set') await api.setProperty(path, o.key, o.value)
    else await api.deleteProperty(path, o.key)
}
