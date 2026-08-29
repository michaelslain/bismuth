// app/src/icons/specimen/IconSetSpecimen.tsx
//
// The page component behind icons/specimen/IconSetSpecimen.stories.tsx — the specimen that
// recorded the icon-set decision in .claude/plans/2026-08-27-visual-unification-audit.md §10.
// Compares the incumbent Nerd Font glyph system against three SVG candidates (Radix, Phosphor,
// Iconoir) over the app's real 140 canonical icon names (see iconSetData.ts), at the app's real
// --icon size (14px), inside real UI context — not a bare grid.
import type { Component } from 'solid-js'
import { For } from 'solid-js'
import Heading from '../../ui/Heading'
import Text from '../../ui/Text'
import Badge from '../../ui/Badge'
import SvgIcon from './SvgIcon'
import {
    CANONICAL_NAMES,
    ICON_SETS,
    getIconBody,
    allCoverage,
    type IconSetId,
} from './iconSetData'
import styles from './IconSetSpecimen.module.css'

const COLUMN_ORDER: IconSetId[] = [
    'nerd',
    'radix',
    'phosphorThin',
    'phosphorRegular',
    'iconoir',
]

/** A handful of names picked to exercise real UI context blocks below — deliberately including
 *  awkward/technical ones (BrainCircuit, Regex) alongside everyday ones (Folder, Search), since
 *  that mix is exactly what a file tree / toolbar / popover shows in practice. */
const FILE_TREE_NAMES = [
    'Folder',
    'FolderOpen',
    'FileText',
    'Image',
    'Database',
]
const TOOLBAR_NAMES = ['Plus', 'Search', 'Settings', 'Trash2', 'RefreshCw']
const POPOVER_NAMES = ['Copy', 'Pencil', 'Share', 'BrainCircuit', 'Regex']

const IconSetSpecimen: Component = () => {
    const coverage = allCoverage()

    return (
        <div class={styles.page}>
            <Heading level={1}>Icon set specimen</Heading>
            <Text tone="muted">
                All 140 of the app's real canonical icon names
                (app/src/icons/nerdGlyphs.ts), five columns wide, at the app's
                real 14px --icon size. Phosphor Regular is the chosen set — see
                the highlighted column and
                .claude/plans/2026-08-27-visual-unification-audit.md §10 for the
                decision record this page exists to support.
            </Text>

            {/* --- 1. coverage summary, prominent, at the top --- */}
            <section>
                <Heading level={2}>Coverage</Heading>
                <div class={styles.coverageRow}>
                    <For each={ICON_SETS}>
                        {set => {
                            const cov = coverage.find(c => c.id === set.id)!
                            return (
                                <div
                                    class={[
                                        styles.coverageCard,
                                        set.chosen ? styles.chosen : '',
                                    ]
                                        .filter(Boolean)
                                        .join(' ')}
                                >
                                    <Text weight="medium">
                                        {set.label}{' '}
                                        {set.chosen ? (
                                            <Badge tone="muted">chosen</Badge>
                                        ) : null}
                                    </Text>
                                    <Text size="micro" tone="muted">
                                        {cov.resolved}/{cov.total} (
                                        {Math.round(cov.ratio * 100)}%)
                                    </Text>
                                    <div class={styles.coverageBar}>
                                        <div
                                            class={styles.coverageBarFill}
                                            style={{
                                                width: `${cov.ratio * 100}%`,
                                            }}
                                        />
                                    </div>
                                </div>
                            )
                        }}
                    </For>
                </div>
            </section>

            {/* --- 2. size ladder, 14px dominant --- */}
            <section>
                <Heading level={2}>
                    Size ladder (14px is the app's real --icon token)
                </Heading>
                <div class={styles.sizeLadder}>
                    <For each={[12, 14, 16]}>
                        {size => (
                            <div class={styles.sizeLadderItem}>
                                <SvgIcon
                                    body={getIconBody(
                                        'phosphorRegular',
                                        'Star',
                                    )}
                                    size={size}
                                />
                                <Text size="micro" tone="muted">
                                    {size}px
                                </Text>
                            </div>
                        )}
                    </For>
                </div>
            </section>

            {/* --- 3. the five-column grid over all 140 names --- */}
            <section>
                <Heading level={2}>All 140 names, five columns</Heading>
                <div class={styles.gridScroll}>
                    <div class={styles.grid}>
                        <div class={styles.headerCell}>
                            <Text size="micro" weight="medium" tone="muted">
                                name
                            </Text>
                        </div>
                        <For each={COLUMN_ORDER}>
                            {id => {
                                const set = ICON_SETS.find(s => s.id === id)!
                                return (
                                    <div
                                        class={[
                                            styles.headerCell,
                                            set.chosen ? styles.chosenCol : '',
                                        ]
                                            .filter(Boolean)
                                            .join(' ')}
                                    >
                                        <Text size="micro" weight="medium">
                                            {set.label}
                                        </Text>
                                    </div>
                                )
                            }}
                        </For>

                        <For each={CANONICAL_NAMES}>
                            {name => (
                                <>
                                    <div class={styles.nameCell}>
                                        <Text size="micro">{name}</Text>
                                    </div>
                                    <For each={COLUMN_ORDER}>
                                        {id => {
                                            const set = ICON_SETS.find(
                                                s => s.id === id,
                                            )!
                                            return (
                                                <div
                                                    class={[
                                                        styles.cell,
                                                        set.chosen
                                                            ? styles.chosenCol
                                                            : '',
                                                    ]
                                                        .filter(Boolean)
                                                        .join(' ')}
                                                >
                                                    <SvgIcon
                                                        body={getIconBody(
                                                            id,
                                                            name,
                                                        )}
                                                        size={14}
                                                        title={name}
                                                    />
                                                </div>
                                            )
                                        }}
                                    </For>
                                </>
                            )}
                        </For>
                    </div>
                </div>
            </section>

            {/* --- 4. real context blocks, phosphorRegular only --- */}
            <section>
                <Heading level={2}>In real context (Phosphor Regular)</Heading>
                <div class={styles.contexts}>
                    {/* Geometry copied from app/src/FileTree.tsx + FileTree.module.css's .ft-row
                        (--row-h 18px, gap 6px, padding 0 8px, --fs-ui text). */}
                    <div class={styles.contextBlock}>
                        <Text size="micro" tone="muted" eyebrow>
                            file tree rows
                        </Text>
                        <For each={FILE_TREE_NAMES}>
                            {name => (
                                <div class={styles.ftRow}>
                                    <SvgIcon
                                        body={getIconBody(
                                            'phosphorRegular',
                                            name,
                                        )}
                                        size={14}
                                    />
                                    <Text size="ui">{name}.md</Text>
                                </div>
                            )}
                        </For>
                    </div>

                    {/* Geometry copied from app/src/ui/IconButton.tsx's "icon" kind Button
                        (22px hit target, 12px icon inside). */}
                    <div class={styles.contextBlock}>
                        <Text size="micro" tone="muted" eyebrow>
                            icon-button toolbar
                        </Text>
                        <div class={styles.toolbarRow}>
                            <For each={TOOLBAR_NAMES}>
                                {name => (
                                    <span
                                        class={styles.toolbarBtn}
                                        title={name}
                                    >
                                        <SvgIcon
                                            body={getIconBody(
                                                'phosphorRegular',
                                                name,
                                            )}
                                            size={12}
                                        />
                                    </span>
                                )}
                            </For>
                        </div>
                    </div>

                    {/* Class names + geometry copied from app/src/ui/popover/popover.css's
                        .bismuth-popover-row / -icon / -label. */}
                    <div class={styles.contextBlock}>
                        <Text size="micro" tone="muted" eyebrow>
                            popover menu
                        </Text>
                        <For each={POPOVER_NAMES}>
                            {name => (
                                <div class={styles.popoverRow}>
                                    <span class={styles.popoverIcon}>
                                        <SvgIcon
                                            body={getIconBody(
                                                'phosphorRegular',
                                                name,
                                            )}
                                            size={14}
                                        />
                                    </span>
                                    <span class={styles.popoverLabel}>
                                        <Text size="ui">{name}</Text>
                                    </span>
                                </div>
                            )}
                        </For>
                    </div>
                </div>
            </section>

            {/* --- 5. facts panel --- */}
            <section>
                <Heading level={2}>Facts</Heading>
                <div class={styles.factsScroll}>
                    <table class={styles.factsTable}>
                        <thead>
                            <tr>
                                <th>set</th>
                                <th>coverage</th>
                                <th>source grid</th>
                                <th>stroke behaviour at 14px</th>
                                <th>licence</th>
                            </tr>
                        </thead>
                        <tbody>
                            <For each={ICON_SETS}>
                                {set => {
                                    const cov = coverage.find(
                                        c => c.id === set.id,
                                    )!
                                    return (
                                        <tr>
                                            <td
                                                class={
                                                    set.chosen
                                                        ? styles.chosenColHeader
                                                        : undefined
                                                }
                                            >
                                                {set.label}
                                                {set.chosen ? ' (chosen)' : ''}
                                            </td>
                                            <td>
                                                {cov.resolved}/{cov.total}
                                            </td>
                                            <td>{set.sourceGrid}</td>
                                            <td>{set.strokeNote}</td>
                                            <td>{set.licence}</td>
                                        </tr>
                                    )
                                }}
                            </For>
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    )
}

export default IconSetSpecimen
