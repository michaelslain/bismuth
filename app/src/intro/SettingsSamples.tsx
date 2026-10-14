// The intro's "Settings are a file" art: two short files side by side, the vault's `.settings`
// and a note's frontmatter, each its file name over a syntax-highlighted CodeBlock. They are
// examples, not live data; their keys are real (`appearance.theme`, `layout.sidebarSide`, `tags`).
import { For, type Component } from 'solid-js'
import CodeBlock from '../ui/CodeBlock'
import type { CodeLanguage } from '../ui/codeTokens'
import Text from '../ui/Text'
import styles from './SettingsSamples.module.css'

export type SettingsSample = {
    name: string
    text: string
    language: CodeLanguage
}

export const SETTINGS_SAMPLES: SettingsSample[] = [
    {
        name: '.settings',
        text: 'appearance:\n  theme: paper\n  editorFontSize: 15\nlayout:\n  sidebarSide: right',
        language: 'yaml',
    },
    {
        name: 'a note',
        text: '---\ntags: [book, fiction]\nstatus: reading\n---\n# Gamma',
        language: 'markdown',
    },
]

export type SettingsSamplesProps = {
    /** Default SETTINGS_SAMPLES. */
    samples?: SettingsSample[]
    class?: string
}

const SettingsSamples: Component<SettingsSamplesProps> = props => (
    <div class={[styles.list, props.class ?? ''].filter(Boolean).join(' ')}>
        <For each={props.samples ?? SETTINGS_SAMPLES}>
            {s => (
                <div class={styles.sample}>
                    <Text size="ui" tone="muted">
                        {s.name}
                    </Text>
                    <CodeBlock language={s.language} class={styles.code}>
                        {s.text}
                    </CodeBlock>
                </div>
            )}
        </For>
    </div>
)

export default SettingsSamples
