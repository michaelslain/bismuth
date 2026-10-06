// A representative panel for judging a custom theme: a title row, text tiers, surfaces, accent +
// status, the six category hues, the graph palette and the theme's non-colour overrides. Composed
// of ui/ primitives. The root carries the theme's own projected tokens inline, so everything
// inside resolves THIS theme whatever the app theme is.
import { For, Show, type Component, type JSX } from 'solid-js'
import { DEFAULTS } from '../settings'
import { settingsToCssVars } from '../settingsCssVars'
import { DESIGN_TOKENS, nonFieldTokens } from '../../../core/src/theme/designTokens'
import type { ThemesFeed } from '../../../core/src/theme/customTheme'
import Heading from './Heading'
import Text from './Text'
import Label from './Label'
import TextButton from './TextButton'
import IconTextButton from './IconTextButton'
import ChipToggle from './ChipToggle'
import Badge from './Badge'
import Swatch from './Swatch'
import Field from './Field'
import TextInput from './TextInput'
import styles from './CustomThemePanel.module.css'

export type CustomThemePanelProps = {
    theme: ThemesFeed['themes'][number]
    className?: string
}

const HUES = ['teal', 'blue', 'violet', 'green', 'gold', 'rose'] as const
const GRAPH_SLOTS = [0, 1, 2, 3, 4] as const
const ORDER = new Map(DESIGN_TOKENS.map((def, i) => [def.key, i]))

const Section: Component<{ title: string; children: JSX.Element }> = props => (
    <div class={styles.section}>
        <Label tone="muted">{props.title}</Label>
        {props.children}
    </div>
)

const CustomThemePanel: Component<CustomThemePanelProps> = props => {
    const vars = () =>
        settingsToCssVars({
            ...DEFAULTS,
            appearance: { ...DEFAULTS.appearance, theme: props.theme.name },
        })
    const overrides = () =>
        Object.entries(nonFieldTokens(props.theme.tokens)).sort(
            (a, b) => (ORDER.get(a[0]) ?? 1e9) - (ORDER.get(b[0]) ?? 1e9),
        )
    return (
        <div class={`${styles.panel} ${props.className ?? ''}`} style={vars()}>
            <Heading level={2}>{props.theme.label}</Heading>
            <Text size="micro" tone="faint">
                {`bg ${props.theme.colors.background} // fg ${props.theme.colors.foreground} // accent ${props.theme.colors.accent}`}
            </Text>
            <Field label="title">
                <TextInput value="Evening notes" onInput={() => {}} />
            </Field>

            <Section title="text // fg muted faint">
                <div class={styles.tiers}>
                    <Text as="span" size="ui">
                        fg
                    </Text>
                    <Text as="span" size="ui" tone="muted">
                        muted
                    </Text>
                    <Text as="span" size="ui" tone="faint">
                        faint
                    </Text>
                </div>
            </Section>

            <Section title="surfaces // 1 2 3">
                <div class={styles.surfaces}>
                    <div class={`${styles.surface} ${styles.surface1}`}>
                        <Text size="micro" tone="faint">
                            surface-1
                        </Text>
                    </div>
                    <div class={`${styles.surface} ${styles.surface2}`}>
                        <Text size="micro" tone="faint">
                            surface-2
                        </Text>
                    </div>
                    <div class={`${styles.surface} ${styles.surface3}`}>
                        <Text size="micro" tone="faint">
                            surface-3
                        </Text>
                    </div>
                    <div class={`${styles.surface} ${styles.hairline}`}>
                        <Text size="micro" tone="faint">
                            border-soft
                        </Text>
                    </div>
                </div>
            </Section>

            <Section title="accent + status // accent danger">
                <div class={styles.accentRow}>
                    <ChipToggle selected>accent</ChipToggle>
                    <ChipToggle>unselected</ChipToggle>
                    <TextButton danger>danger</TextButton>
                    <TextButton>apply</TextButton>
                    <IconTextButton icon="plus">add</IconTextButton>
                </div>
            </Section>

            <Section title="category hues // 6">
                <div class={styles.row}>
                    <For each={HUES}>
                        {hue => (
                            <Badge variant="solid" hue={hue}>
                                {hue}
                            </Badge>
                        )}
                    </For>
                </div>
            </Section>

            <Section title="graph palette // --graph-0..4">
                <div class={styles.graphRow}>
                    <For each={GRAPH_SLOTS}>
                        {i => (
                            <div class={styles.swatchCell}>
                                <Swatch
                                    static
                                    class={styles.swatch}
                                    color={`var(--graph-${i})`}
                                    label={`graph-${i}`}
                                />
                                <Label tone="muted">{`graph-${i}`}</Label>
                            </div>
                        )}
                    </For>
                </div>
            </Section>

            <Show when={overrides().length > 0}>
                <Section title={`overrides // ${overrides().length}`}>
                    <div class={styles.overrides}>
                        <For each={overrides()}>
                            {([key, value], i) => (
                                <>
                                    <Show when={i() > 0}>
                                        <Label tone="muted">//</Label>
                                    </Show>
                                    <div class={styles.override}>
                                        <Label tone="muted">{key}</Label>
                                        <Label tone="default">{value}</Label>
                                    </div>
                                </>
                            )}
                        </For>
                    </div>
                </Section>
            </Show>
        </div>
    )
}

export default CustomThemePanel
