// Visual spec for <CardsView> — the book-cover grid renderer (`cardContent: properties`, the
// default). Exercises `sampleViewResult` end to end: real rows, run through the real query
// engine (core/src/bases/query.ts `runView`), rendered by the real CardsView component.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
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
    view: { type: 'cards' },
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
            result={runView(STORED_CARDS_CONFIG, STORED_CARDS_ROWS)}
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
        const view = {
                type: 'cards' as const,
                image: 'cover',
                order: [
                    'file.name',
                    'note.author',
                    'note.status',
                    'note.rating',
                ],
            }
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
                result={sampleViewResult(rows, { view })}
                config={sampleBaseConfig({ view })}
            />
        )
    },
}

/** `cardContent: body` — masonry BodyCards over each note's live body. */
export const BodyContent: Story = {
    render: () => {
        const view = {
                type: 'cards' as const,
                cardContent: 'body' as const,
            }
        return (
            <CardsView
                result={sampleViewResult(undefined, { view })}
                config={sampleBaseConfig({ view })}
            />
        )
    },
    play: async ({ canvasElement }) => {
        await waitFor(() =>
            expect(canvasElement.querySelector('.cm-content')).toBeTruthy(),
        )
    },
}

/** `imageFit: contain` + a square `imageAspectRatio` — the frame's ratio and the img's fit come
 *  from the view config, not the defaults (cover, 0.667). */
export const ImageFitAndAspect: Story = {
    render: () => {
        const view = {
                type: 'cards' as const,
                image: 'cover',
                imageFit: 'contain' as const,
                imageAspectRatio: 1,
                order: ['file.name', 'note.author', 'note.status'],
            }
        const rows: Partial<Row>[] = [
            bookRow('Piranesi', {
                author: 'Susanna Clarke',
                status: 'Todo',
                cover: PLACEHOLDER_COVER,
            }),
        ]
        return (
            <CardsView
                result={sampleViewResult(rows, { view })}
                config={sampleBaseConfig({ view })}
            />
        )
    },
    play: async ({ canvasElement }) => {
        const img = canvasElement.querySelector('img')!
        expect(img.style.objectFit).toBe('contain')
        expect((img.parentElement as HTMLElement).style.aspectRatio).toContain(
            '1',
        )
    },
}

/** Grouped by `status`: every header reads `LABEL // N` through GroupHeader. */
export const Grouped: Story = {
    render: () => {
        const view = {
                type: 'cards' as const,
                groupBy: { property: 'status' },
            }
        return (
            <CardsView
                result={sampleViewResult(undefined, { view })}
                config={sampleBaseConfig({ view })}
            />
        )
    },
    play: async ({ canvasElement }) => {
        expect(canvasElement.textContent).toMatch(/\/\/ \d+/)
    },
}

/** A zero-row view shows the `no rows` empty state, never a blank pane. */
export const Empty: Story = {
    render: () => (
        <CardsView
            result={{ ...sampleViewResult(), groups: [] }}
            config={sampleBaseConfig()}
        />
    ),
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        expect(c.getByText('no rows')).toBeInTheDocument()
        expect(
            c.getByText('nothing in this view matches its filters'),
        ).toBeInTheDocument()
    },
}

/** Without a basePath a card is not a button: its cover title is a NoteLink that opens the note. */
export const ReadOnlyCardOpensNote: Story = {
    render: () => (
        <CardsView result={sampleViewResult()} config={sampleBaseConfig()} />
    ),
    play: async ({ canvasElement }) => {
        expect(canvasElement.querySelector('[role="button"]')).toBeNull()
        expect(canvasElement.querySelector('a')).toBeTruthy()
    },
}

/** Without a basePath a card click must not open the row editor (it could rename or trash the note). */
export const ReadOnlyClickOpensNothing: Story = {
    render: () => (
        <CardsView result={sampleViewResult()} config={sampleBaseConfig()} />
    ),
    play: async ({ canvasElement }) => {
        const card = canvasElement.querySelector<HTMLElement>('[class*="cardSlot"]')
        expect(card).toBeTruthy()
        await userEvent.click(card!)
        expect(document.querySelector('[role="dialog"]')).toBeNull()
    },
}

/** Enter on a focused link inside an editable card opens the note, not the row editor. */
export const LinkEnterInEditableCard: Story = {
    render: () => {
        const view = {
                type: 'cards' as const,
                order: ['file.name', 'note.author', 'note.related'],
            }
        const rows: Partial<Row>[] = [
            {
                ...bookRow('Piranesi', {
                    author: 'Susanna Clarke',
                    related: {
                        __link: true,
                        path: 'reading/Jonathan Strange.md',
                        display: 'Jonathan Strange',
                    },
                }),
                index: 0,
            },
        ]
        return (
            <CardsView
                result={sampleViewResult(rows, { view })}
                config={sampleBaseConfig({ view })}
                basePath="projects/tasks.md"
            />
        )
    },
    play: async ({ canvasElement }) => {
        let opened = 0
        const onOpen = () => {
            opened++
        }
        window.addEventListener('bismuth-open', onOpen)
        try {
            const link = canvasElement.querySelector<HTMLElement>(
                '[role="button"] a',
            )
            expect(link).toBeTruthy()
            link!.focus()
            await userEvent.keyboard('{Enter}')
            await waitFor(() => expect(opened).toBeGreaterThan(0))
            expect(document.querySelector('[role="dialog"]')).toBeNull()
        } finally {
            window.removeEventListener('bismuth-open', onOpen)
        }
    },
}

/** Clicking a note link inside an editable card follows the link — it does not open the row editor. */
export const LinkClickInEditableCard: Story = {
    render: () => {
        const view = {
                type: 'cards' as const,
                order: ['file.name', 'note.author', 'note.related'],
            }
        const rows: Partial<Row>[] = [
            {
                ...bookRow('Piranesi', {
                    author: 'Susanna Clarke',
                    related: {
                        __link: true,
                        path: 'reading/Jonathan Strange.md',
                        display: 'Jonathan Strange',
                    },
                }),
                index: 0,
            },
        ]
        return (
            <CardsView
                result={sampleViewResult(rows, { view })}
                config={sampleBaseConfig({ view })}
                basePath="projects/tasks.md"
            />
        )
    },
    play: async ({ canvasElement }) => {
        // The row editor mounts through a dynamic import — load it first, so a wrongly opened
        // dialog would already be one frame away and the "no dialog" check below can fail.
        await import('./openRowEditor')
        let opened = 0
        const onOpen = () => {
            opened++
        }
        window.addEventListener('bismuth-open', onOpen)
        try {
            const link = canvasElement.querySelector<HTMLElement>(
                '[role="button"] a',
            )
            expect(link).toBeTruthy()
            await userEvent.click(link!)
            await waitFor(() => expect(opened).toBeGreaterThan(0))
            await new Promise(requestAnimationFrame)
            expect(document.querySelector('[role="dialog"]')).toBeNull()
            // Positive control: a click on the card itself DOES open the editor, so the absence
            // above means something.
            await userEvent.click(
                canvasElement.querySelector<HTMLElement>('[role="button"]')!,
            )
            await waitFor(() =>
                expect(document.querySelector('[role="dialog"]')).not.toBeNull(),
            )
            await userEvent.keyboard('{Escape}')
        } finally {
            window.removeEventListener('bismuth-open', onOpen)
        }
    },
}
