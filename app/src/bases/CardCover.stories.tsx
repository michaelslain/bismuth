import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { For } from 'solid-js'
import CardCover, { type CardCoverProps } from './CardCover'
import CardFrame from './CardFrame'
import { autoGroupColor } from './groupHue'

const meta = {
    title: 'Bases/CardCover',
    component: CardCover,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof CardCover>

export default meta
type Story = StoryObj<typeof meta>

/** A row of covers inside the real card frame, at the cards grid's default min column width. */
const Grid = (props: { covers: CardCoverProps[] }) => (
    <div
        style={{
            display: 'grid',
            'grid-template-columns': 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: '12px',
            'max-width': '960px',
        }}
    >
        <For each={props.covers}>
            {c => (
                <CardFrame interactive>
                    <CardCover {...c} />
                </CardFrame>
            )}
        </For>
    </div>
)

export const TitleAndAuthor: Story = {
    args: {
        path: 'reading/Dune.md',
        title: 'Dune',
        author: 'Frank Herbert',
    },
}

export const TitleOnly: Story = {
    args: { path: 'notes/Standup 2026-09-14.md', title: 'Standup 2026-09-14' },
}

export const LongTitle: Story = {
    args: {
        path: 'reading/The Hitchhikers Guide.md',
        title: "The Hitchhiker's Guide to the Galaxy: The Complete Trilogy in Five Parts",
        author: 'Douglas Adams',
    },
}

/** Ungrouped: every cover neutral, every note its own fingerprint — and stable, because the
 *  pattern is seeded by the path, not the card's place in the grid. */
export const UngroupedFingerprints: Story = {
    args: { path: '', title: '' },
    render: () => (
        <Grid
            covers={[
                { path: 'reading/Dune.md', title: 'Dune', author: 'Frank Herbert' },
                { path: 'reading/Piranesi.md', title: 'Piranesi', author: 'Susanna Clarke' },
                { path: 'reading/Gödel, Escher, Bach.md', title: 'Gödel, Escher, Bach', author: 'Douglas Hofstadter' },
                { path: 'projects/bismuth.md', title: 'bismuth' },
                { path: 'reading/The Dispossessed.md', title: 'The Dispossessed', author: 'Ursula K. Le Guin' },
                { path: 'reading/Solaris.md', title: 'Solaris', author: 'Stanisław Lem' },
                { path: 'journal/2026-09-28.md', title: '2026-09-28' },
                { path: 'reading/Blindsight.md', title: 'Blindsight', author: 'Peter Watts' },
                { path: 'reading/Hitchhikers.md', title: "The Hitchhiker's Guide to the Galaxy", author: 'Douglas Adams' },
            ]}
        />
    ),
}

/** Grouped: a cover takes its GROUP's hue — status keys their status colour, any other key a
 *  slot of the graph ramp hashed from the key (the kanban column rule). */
export const Grouped: Story = {
    args: { path: '', title: '' },
    render: () => {
        const books: [string, string, string][] = [
            ['Reading', 'Dune', 'Frank Herbert'],
            ['Reading', 'Piranesi', 'Susanna Clarke'],
            ['To Read', 'Solaris', 'Stanisław Lem'],
            ['Finished', 'Blindsight', 'Peter Watts'],
            ['Abandoned', 'Ulysses', 'James Joyce'],
            ['sci-fi', 'The Dispossessed', 'Ursula K. Le Guin'],
            ['essays', 'Gödel, Escher, Bach', 'Douglas Hofstadter'],
            ['poetry', 'Ariel', 'Sylvia Plath'],
        ]
        return (
            <Grid
                covers={books.map(([group, title, author]) => ({
                    path: `reading/${title}.md`,
                    title,
                    author,
                    hue: autoGroupColor(group),
                }))}
            />
        )
    },
}
