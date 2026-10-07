// app/src/preview/ImagePane.stories.tsx
// Visual + behavioural spec for <ImagePane> — an image preview's picture, in its two layouts: the
// plain CSS-centred `<img>` (scratch strip off, fit zoom) and the explicit host-px layout beside
// the scratch strip. The picture is ONE `<img>` written once and mounted by whichever layout is
// live, so both stories assert there is exactly one image. Mounted in a flex body of the
// preview's shape (the body is `display: flex; position: relative; overflow: auto`).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import ImagePane from './ImagePane'

const meta = {
    title: 'Preview/ImagePane',
    component: ImagePane,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ImagePane>

export default meta
type Story = StoryObj<typeof meta>

/** A 1600x900 gradient — a real decodable picture, deterministic, no network. */
const PICTURE = `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3b6ea5"/><stop offset="1" stop-color="#e0a458"/></linearGradient></defs><rect width="1600" height="900" fill="url(#g)"/><circle cx="1100" cy="450" r="260" fill="#fff" fill-opacity=".35"/></svg>`,
)}`

const noop = () => {}

function Body(props: { children: import('solid-js').JSX.Element }) {
    return (
        <div
            style={{
                position: 'relative',
                display: 'flex',
                width: '640px',
                height: '360px',
                overflow: 'auto',
                background: 'var(--editor)',
            }}
        >
            {props.children}
        </div>
    )
}

const base = {
    src: PICTURE,
    name: 'photo.png',
    hasPages: false,
    imgRef: noop,
    onLoad: noop,
    onError: noop,
}

/** Scratch off, fit zoom: the plain `<img>`, centred by CSS, no host wrapper, no inline size. */
export const Plain: Story = {
    args: { ...base, scratch: false },
    render: args => (
        <Body>
            <ImagePane {...args} />
        </Body>
    ),
    play: async ({ canvasElement }) => {
        const imgs = canvasElement.querySelectorAll('img')
        await expect(imgs.length).toBe(1)
        await expect(imgs[0].parentElement?.style.position).toBe('relative') // the body, not a host
        await expect(imgs[0].style.left).toBe('')
        await expect(canvasElement.querySelector('[data-pdf-margin]')).toBeNull()
    },
}

/** Scratch on: the same `<img>`, absolutely placed at its measured rect inside the stage host, with
 *  the strip beside it on the right. */
export const Scratch: Story = {
    args: {
        ...base,
        scratch: true,
        hasPages: true,
        page: {
            rendered: { left: 24, top: 20, w: 400, h: 225 },
            nat: { w: 1600, h: 900 },
            marginW: 140,
        },
        overlay: <span data-testid="overlay-slot" />,
    },
    render: args => (
        <Body>
            <ImagePane {...args} />
        </Body>
    ),
    play: async ({ canvasElement }) => {
        const imgs = canvasElement.querySelectorAll('img')
        await expect(imgs.length).toBe(1)
        const img = imgs[0]
        await expect(getComputedStyle(img).position).toBe('absolute')
        await expect(img.style.width).toBe('400px')
        await expect(img.style.left).toBe('24px')
        const strip = canvasElement.querySelector<HTMLElement>('[data-pdf-margin]')!
        await expect(strip.style.left).toBe('424px') // image left + image width
        await expect(strip.style.width).toBe('140px')
        await expect(canvasElement.querySelector('[data-testid="overlay-slot"]')).not.toBeNull()
    },
}

/** Scratch on but not yet measured: the picture is hidden, not painted at its natural size in the
 *  host's corner for a frame. */
export const ScratchBeforeMeasure: Story = {
    args: { ...base, scratch: true },
    render: args => (
        <Body>
            <ImagePane {...args} />
        </Body>
    ),
    play: async ({ canvasElement }) => {
        await expect(canvasElement.querySelector('img')!.style.visibility).toBe('hidden')
    },
}
