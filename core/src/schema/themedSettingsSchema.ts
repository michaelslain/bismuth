// core/src/schema/themedSettingsSchema.ts
// SETTINGS_SCHEMA with `appearance.theme` widened by a vault's valid custom theme names.
// Pure and bundle-safe — the app imports it for the editor's settings lint.

import { SETTINGS_SCHEMA } from './settingsSchema'
import type { Schema } from './types'
import { THEME_NAMES } from '../theme/tokens'

/** SETTINGS_SCHEMA with appearance.theme's enum extended by customNames (built-ins first). */
export function settingsSchemaFor(customNames: readonly string[]): Schema {
    if (customNames.length === 0) return SETTINGS_SCHEMA
    const appearance = SETTINGS_SCHEMA.appearance
    if (appearance.type === null || typeof appearance.type !== 'object' || appearance.type.kind !== 'object')
        return SETTINGS_SCHEMA
    const values: string[] = [...THEME_NAMES]
    for (const n of customNames) if (!values.includes(n)) values.push(n)
    const theme = appearance.type.fields.theme
    return {
        ...SETTINGS_SCHEMA,
        appearance: {
            ...appearance,
            type: {
                kind: 'object',
                fields: {
                    ...appearance.type.fields,
                    theme: { ...theme, type: { kind: 'enum', values } },
                },
            },
        },
    }
}
