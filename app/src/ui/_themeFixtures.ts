// Storybook fixtures for the custom-theme surface. The feed is built through the REAL parser, so a
// fixture that stops validating throws at import instead of silently drifting from the schema.
// EXAMPLE_THEME_YAML is the `dusk` worked example (v2: extends ink, every colour a token).
import { parseCustomTheme } from '../../../core/src/theme/customTheme'
import type { ThemesFeed } from '../../../core/src/theme/customTheme'

export const EXAMPLE_THEME_YAML = `label: 'Dusk'
extends: ink
tokens:
  color-scheme: 'dark'

  # core surfaces
  bg: '#16132B'
  fg: '#E6E1F5'
  text-muted: '#A39CC4'
  accent: '#C3A6FF'
  border: '#3D3762'
  surface-1: '#211D3B'
  surface-2: '#292448'
  graph-0: '#D98CB3'
  graph-1: '#B39DFF'
  graph-2: '#7FA2E8'
  graph-3: '#74C2C0'
  graph-4: '#9CCB8E'

  # structural surfaces
  rail: '#110F22'
  editor: '#1A1730'
  surface-3: '#332E56'
  border-soft: '#2B2650'
  faint: '#8D86AE'
  hover-bg: 'rgba(230,225,245,.06)'
  pop-bg: 'rgba(26,23,48,.9)'
  pop-bg-strong: 'rgba(26,23,48,.95)'
  scrim-bg: 'rgba(9,7,20,.62)'
  overlay-bg: 'rgba(9,7,20,.62)'
  label-halo: '#16132B'

  # graph
  graph-bg: '#120F24'
  graph-edge: '#3F3965'
  node-cold: '#4B4575'
  node-self: '#E6E1F5'
  vignette-edge: '#0C0A1A'

  # terminal
  term-bg: '#110F22'
  term-fg: '#CFC9E6'

  # glow + accent helpers
  glow-accent: '0 0 0 1px rgba(195,166,255,0.14)'
  glow-text: 'none'
  accent-soft: 'rgba(195,166,255,0.12)'
  on-accent: '#16132B'
  on-scrim: '#ffffff'

  # category hues
  teal: '#74C2C0'
  blue: '#7FA2E8'
  violet: '#B39DFF'
  green: '#9CCB8E'
  gold: '#D6B879'
  rose: '#D98CB3'

  # status
  danger: '#E07F8C'
  success: '#9CCB8E'
  warning: '#D6B879'
`


const parsed = parseCustomTheme('dusk', EXAMPLE_THEME_YAML)
if (!parsed.theme)
    throw new Error(
        `_themeFixtures: dusk example does not validate: ${parsed.diagnostics.map(d => `${d.field}: ${d.message}`).join('; ')}`,
    )

export const EXAMPLE_THEMES_FEED: ThemesFeed = {
    themes: [
        {
            name: 'dusk',
            label: parsed.theme.label,
            extends: parsed.theme.extends,
            isLight: parsed.theme.colors.isLight ?? false,
            tokens: parsed.theme.tokens,
            colors: parsed.theme.colors,
        },
    ],
    invalid: [],
}

/** A partial theme: extends paper, overrides one colour and two non-colour tokens. */
const PARTIAL_THEME_YAML = `label: 'Ember'
extends: paper
tokens:
  accent: '#C2410C'
  r-card: '4px'
  sp-3: '8px'
`

const partial = parseCustomTheme('ember', PARTIAL_THEME_YAML)
if (!partial.theme)
    throw new Error(
        `_themeFixtures: ember example does not validate: ${partial.diagnostics.map(d => `${d.field}: ${d.message}`).join('; ')}`,
    )

export const PARTIAL_FEED_ENTRY: ThemesFeed['themes'][number] = {
    name: 'ember',
    label: partial.theme.label,
    extends: partial.theme.extends,
    isLight: partial.theme.colors.isLight ?? false,
    tokens: partial.theme.tokens,
    colors: partial.theme.colors,
}
