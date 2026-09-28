// Visual spec for <CardsView> — the book-cover grid renderer (`cardContent: properties`, the
// default). Exercises `sampleViewResult` end to end: real rows, run through the real query
// engine (core/src/bases/query.ts `runView`), rendered by the real CardsView component.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, within } from 'storybook/test'
import type { Row, BaseConfig } from '../../../core/src/bases/types'
import { syntheticBaseFile } from '../../../core/src/bases/types'
import { runView } from '../../../core/src/bases/query'
import { CardsView } from './CardsView'
import { sampleBaseConfig, sampleViewResult } from '../ui/_baseFixtures'

const meta = {
    title: 'Bases/CardsView',
    component: CardsView,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof CardsView>

export default meta
type Story = StoryObj<typeof meta>

/** Properties mode (default): generated text covers (gradient + spine), status word + tags
 *  in the meta row. */
export const Default: Story = {
    render: () => (
        <CardsView result={sampleViewResult()} config={sampleBaseConfig()} />
    ),
}

// A row STORED in a base's own body (see TableView.stories.tsx's STORED_CONFIG for the shape).
const STORED_CARDS_CONFIG: BaseConfig = {
    declaredProperties: ['description', 'status'],
    views: [{ type: 'cards', name: 'Cards' }],
}
const STORED_CARDS_ROWS: Row[] = [
    {
        file: syntheticBaseFile('boards/stored-cards.md'),
        note: { description: 'ship the parser', status: 'Todo' },
        formula: {},
        index: 0,
    },
]

/** With `basePath` set (openRowEditor.tsx wired), an owned row's card opens the row editor on
 *  click — it has no note of its own to open. Right-click opens the same editor (no separate
 *  edit icon anywhere). */
export const EditableOwnedRow: Story = {
    render: () => (
        <CardsView
            result={runView(STORED_CARDS_CONFIG, STORED_CARDS_ROWS, 0)}
            config={STORED_CARDS_CONFIG}
            basePath="boards/stored-cards.md"
        />
    ),
    play: async ({ canvasElement }) => {
        const card = canvasElement.querySelector('[role="button"]')
        expect(card).toBeTruthy()

        card!.dispatchEvent(
            new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
        )
        await within(document.body).findByRole('dialog', { name: 'edit row' })
    },
}

/** With `basePath` set, left-click on a note card now opens the editor too (not the note) —
 *  every editable row, note-backed or not, opens the same editor on click; right-click does
 *  the same. */
export const EditableNoteRow: Story = {
    render: () => (
        <CardsView
            result={sampleViewResult()}
            config={sampleBaseConfig()}
            basePath="projects/tasks.md"
        />
    ),
    play: async ({ canvasElement }) => {
        const card = canvasElement.querySelector('[role="button"]')
        expect(card).toBeTruthy()

        card!.dispatchEvent(
            new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
        )
        await within(document.body).findByRole('dialog', { name: 'edit row' })
    },
}

// A tiny inline placeholder "cover" — a flat rect, not a design token — so the image-cover
// path (`image:`) has a real, self-contained src to load with no network dependency.
const COVER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="360"><rect width="100%" height="100%" fill="#5b7c99"/></svg>`
const PLACEHOLDER_COVER = `data:image/svg+xml,${encodeURIComponent(COVER_SVG)}`

/** Build a full-shaped `Partial<Row>` for a "book" — the fixture's own row rows don't carry
 *  cover art, so this story mints its own small dataset (real FileMeta shape) rather than
 *  reaching into `_baseFixtures`' unexported row builder. */
function bookRow(name: string, note: Record<string, unknown>): Partial<Row> {
    return {
        file: {
            name,
            basename: name,
            path: `reading/${name}.md`,
            folder: 'reading',
            ext: 'md',
            size: 512,
            ctime: 0,
            mtime: 0,
            tags: [],
            links: [],
        },
        note,
    }
}

/** `image:` configured — real cover art replaces the generated text cover; title/author move
 *  into the body row below (per cards.md: an image cover means title/author aren't overlaid).
 *  One row has no `cover` value, so it falls back to the generated text cover — both paths
 *  visible at once. */
export const WithCoverImages: Story = {
    render: () => {
        const views = [
            {
                type: 'cards' as const,
                name: 'Reading List',
                image: 'cover',
                order: [
                    'file.name',
                    'note.author',
                    'note.status',
                    'note.rating',
                ],
            },
        ]
        const rows: Partial<Row>[] = [
            bookRow('The Fifth Season', {
                author: 'N. K. Jemisin',
                status: 'Doing',
                rating: 5,
                cover: PLACEHOLDER_COVER,
            }),
            bookRow('Piranesi', {
                author: 'Susanna Clarke',
                status: 'Todo',
                rating: 4,
                cover: PLACEHOLDER_COVER,
            }),
            bookRow('A Fire Upon the Deep', {
                author: 'Vernor Vinge',
                status: 'Done',
                rating: 4,
            }), // no cover -> text fallback
        ]
        return (
            <CardsView
                result={sampleViewResult(rows, { views })}
                config={sampleBaseConfig({ views })}
            />
        )
    },
}
