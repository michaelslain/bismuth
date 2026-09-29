// Visual spec for <BaseSkeleton> — the shaped loading placeholder BaseView shows while a
// view's rows are still resolving (before any cached/fetched rows arrive). It paints the
// SILHOUETTE of the view kind rather than a generic spinner, so the pane already reads as
// "this view, loading" the instant it opens.
//
// Six silhouettes: table, cards, lines (list/bullets), columns (kanban), chart (bar/line/stat/
// heatmap) and a neutral block (map/calendar/flashcards). `skeletonShape` maps the twelve view
// kinds onto them, and the root carries `data-skeleton` so a play() can prove which one painted.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import { BaseSkeleton, skeletonShape, type SkeletonShape } from './BaseSkeleton'
import type { ViewType } from '../../../core/src/bases/types'

const meta = {
    title: 'Bases/BaseSkeleton',
    component: BaseSkeleton,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof BaseSkeleton>

export default meta
type Story = StoryObj<typeof meta>

const Frame = (props: { children: unknown }) => (
    <div
        style={{
            height: '360px',
            width: '520px',
            border: '1px solid var(--border-soft)',
            display: 'flex',
        }}
    >
        {props.children as never}
    </div>
)

function shape(type: ViewType, expected: SkeletonShape): Story {
    return {
        args: { type },
        render: a => (
            <Frame>
                <BaseSkeleton type={a.type} />
            </Frame>
        ),
        play: async ({ canvasElement }) => {
            const root = canvasElement.querySelector('[data-skeleton]')!
            expect(root.getAttribute('data-skeleton')).toBe(expected)
            expect(skeletonShape(type)).toBe(expected)
            // A silhouette is made of placeholder bars, never an empty box.
            expect(root.children.length).toBeGreaterThan(0)
        },
    }
}

/** The table silhouette — `table` itself, and the fallback for anything unmapped. */
export const Table = shape('table', 'table')
/** The cards silhouette — a grid of cover-bar + two-text-line outlines. */
export const Cards = shape('cards', 'cards')
/** List and bullets share the line silhouette (a mark, then a text bar). */
export const List = shape('list', 'lines')
export const Bullets = shape('bullets', 'lines')
/** Kanban: three columns of a head bar over card bars. */
export const Kanban = shape('kanban', 'columns')
/** The chart family: bars rising from a baseline. */
export const Bar = shape('bar', 'chart')
export const Line = shape('line', 'chart')
export const Stat = shape('stat', 'chart')
export const Heatmap = shape('heatmap', 'chart')
/** The kinds whose shape depends on data get one neutral panel. */
export const Map = shape('map', 'block')
export const Calendar = shape('calendar', 'block')
export const Flashcards = shape('flashcards', 'block')
