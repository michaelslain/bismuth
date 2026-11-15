// bench/backendBench/scenarios/parity.ts
// The `parity` suite: what a chat does on every backend, in the order a person meets it.
import controlScenarios from '../parity/control'
import sessionScenarios from '../parity/session'
import turnScenarios from '../parity/turn'
import type { Scenario } from '../types'

const scenarios: Scenario[] = [
    ...turnScenarios,
    ...controlScenarios,
    ...sessionScenarios,
]

export default scenarios
