// Visual spec for <CardsFields> — what a card shows, and how its cover image is framed (the fit
// + shape pickers appear only once an image column is bound).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import CardsFields, { type CardsLook } from './CardsFields'

const meta = {
    title: 'Bases/CardsFields',
    component: CardsFields,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof CardsFields>

export default meta
type Story = StoryObj<typeof meta>

function Harness(p: { initial: CardsLook; hasImage: boolean }) {
    const [v, setV] = createSignal(p.initial)
    return (
        <div style={{ width: '460px' }}>
            <CardsFields value={v()} onChange={setV} hasImage={p.hasImage} />
        </div>
    )
}

export const TextCover: Story = {
    render: () => (
        <Harness
            initial={{ cardContent: '', imageFit: '', aspect: '' }}
            hasImage={false}
        />
    ),
}

export const ImageCover: Story = {
    render: () => (
        <Harness
            initial={{ cardContent: '', imageFit: 'contain', aspect: '1' }}
            hasImage
        />
    ),
}

export const BodyCards: Story = {
    render: () => (
        <Harness
            initial={{ cardContent: 'body', imageFit: '', aspect: '' }}
            hasImage={false}
        />
    ),
}

/** `cardContent: tasks` — the checklist-only card. */
export const TasksCards: Story = {
    render: () => (
        <Harness
            initial={{ cardContent: 'tasks', imageFit: '', aspect: '' }}
            hasImage={false}
        />
    ),
}

/** A ratio outside the preset list is kept and offered as its own option. */
export const CustomAspect: Story = {
    render: () => (
        <Harness
            initial={{ cardContent: '', imageFit: 'contain', aspect: '2.2' }}
            hasImage
        />
    ),
}
