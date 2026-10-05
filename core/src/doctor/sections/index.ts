// The default section order. legacy first so leftovers are reported before the install checks that
// would otherwise trip over them.
import type { DoctorSection } from '../types'
import { legacySection } from './legacy'
import { installSection } from './install'
import { daemonSection } from './daemon'
import { runtimeSection } from './runtime'
import { vaultSection } from './vault'
import { backendsSection } from './backends'

export const DEFAULT_SECTIONS: DoctorSection[] = [
    legacySection,
    installSection,
    daemonSection,
    runtimeSection,
    vaultSection,
    backendsSection,
]
