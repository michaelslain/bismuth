// Visual spec for <IntroWindow>: the framed window the intro slides sit in. The decorator stands in
// for VaultIntro's centring parent. `short-window` proves the footer stays on screen at 640px tall.
import type { JSX } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import Heading from '../ui/Heading'
import Text from '../ui/Text'
import IntroFooter from './IntroFooter'
import IntroWindow from './IntroWindow'

const meta = {
    title: 'Intro/IntroWindow',
    component: IntroWindow,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof IntroWindow>

export default meta
type Story = StoryObj<typeof meta>

const Stage = (height: string) => (Story: () => JSX.Element) => (
    <div
        style={{
            height,
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'center',
            background: 'var(--bg)',
            'box-sizing': 'border-box',
        }}
    >
        <Story />
    </div>
)

const args = {
    art: <Text size="ui">art box // fixed height, content centred</Text>,
    text: (
        <>
            <Heading level={1} size="hero" register="prose">
                Notes that think
            </Heading>
            <Text size="lead" register="prose" tone="muted">
                A vault of plain markdown, with an agent that reads it.
            </Text>
        </>
    ),
    footer: (
        <IntroFooter
            index={0}
            count={7}
            label="welcome"
            onPrev={() => {}}
            onNext={() => {}}
        />
    ),
    onClose: () => {},
}

export const Default: Story = { args, decorators: [Stage('100vh')] }

export const EmptyArt: Story = {
    args: { ...args, art: undefined },
    decorators: [Stage('100vh')],
}

export const ShortWindow: Story = { args, decorators: [Stage('640px')] }

/** The backdrop slot fills the whole body behind the art and the copy (the palette slide's graph). */
export const WithBackdrop: Story = {
    args: {
        ...args,
        backdrop: (
            <Text as="div" size="ui" tone="faint">
                {'. '.repeat(2000)}
            </Text>
        ),
    },
    decorators: [Stage('100vh')],
}
