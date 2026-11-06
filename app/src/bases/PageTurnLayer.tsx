import { createEffect, onCleanup, onMount, type Component } from 'solid-js'
import styles from './PageTurnLayer.module.css'
import { axisDistance, curlAt, curlFromPointer, deform, settle, type CurlState, turnEase } from './pageCurl'

export type PageFace = CanvasImageSource | null
export type SpreadFaces = { left: PageFace; right: PageFace }

export type PageTurnLayerProps = {
    /** The whole spread box in CSS px (single layout: one page wide). */
    width: number
    height: number
    layout: 'spread' | 'single'
    from: SpreadFaces
    to: SpreadFaces
    direction: 'forward' | 'back'
    /** Pointer in layer px while dragging; null = the turn animates on its own. */
    drag: { x: number; y: number } | null
    durationMs?: number
    onSettled: (committed: boolean) => void
    className?: string
}

type TurnState = 'idle' | 'turning' | 'settled'

const GRID_X = 72
const GRID_Y = 36

const PAGE_VS = `#version 300 es
in vec2 a_pos;
in vec2 a_uv;
uniform vec2 u_size;
out vec2 v_uv;
out vec2 v_px;
void main() {
    v_uv = a_uv;
    v_px = a_pos;
    vec2 c = a_pos / u_size * 2.0 - 1.0;
    gl_Position = vec4(c.x, -c.y, 0.95, 1.0);
}`

// Static pages carry the shadow the curl throws: on the uncovered page beyond the fold axis, and on
// the still page beyond the edge of the leaf once it has folded over onto it.
const PAGE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec2 v_px;
uniform sampler2D u_tex;
uniform vec4 u_curl;      // axisX, angle, radius, active
uniform vec4 u_frame;     // spineX, sign, pageH, pageW
out vec4 o;
void main() {
    vec4 c = texture(u_tex, v_uv);
    float s = 0.0;
    if (u_curl.w > 0.5) {
        float x = (v_px.x - u_frame.x) * u_frame.y;
        float ca = cos(u_curl.y);
        float sa = sin(u_curl.y);
        float r = u_curl.z;
        float d = (x - u_curl.x) * ca + (v_px.y - u_frame.z * 0.5) * sa;
        if (x >= 0.0 && d > 0.0) {
            s = 0.3 * exp(-d / (r * 3.4 + 8.0)) * smoothstep(0.0, r * 0.9 + 4.0, d + r * 0.9);
        }
        float edge = 2.0 * u_curl.x - u_frame.w + 3.14159265 * r;
        float de = (x - edge) * ca + (v_px.y - u_frame.z * 0.5) * sa;
        if (x < 0.0 && edge < 0.0 && de < 0.0) {
            s = max(s, 0.24 * exp(de / (r * 2.4 + 6.0)));
        }
    }
    o = vec4(c.rgb * (1.0 - s), 1.0);
}`

const LEAF_VS = `#version 300 es
in vec2 a_pos;     // deformed layer px
in vec3 a_uvd;     // u, v, signed distance from the fold axis
in float a_z;
uniform vec2 u_size;
uniform float u_zscale;
out vec3 v_uvd;
void main() {
    v_uvd = a_uvd;
    vec2 c = a_pos / u_size * 2.0 - 1.0;
    gl_Position = vec4(c.x, -c.y, -clamp(a_z / u_zscale, 0.0, 1.0) * 0.9, 1.0);
}`

const LEAF_FS = `#version 300 es
precision highp float;
in vec3 v_uvd;
uniform sampler2D u_front;
uniform sampler2D u_back;
uniform float u_radius;
uniform float u_mirror;   // 1 when the leaf runs right-to-left
out vec4 o;
void main() {
    float r = max(u_radius, 0.001);
    float d = v_uvd.z;
    float theta = clamp(d / r, 0.0, 3.14159265);
    bool back = d > r * 1.5707963;
    vec2 uv = vec2(u_mirror > 0.5 ? 1.0 - v_uvd.x : v_uvd.x, v_uvd.y);
    vec3 col;
    float shade;
    if (!back) {
        col = texture(u_front, uv).rgb;
        // lit across the bend: a bright band on the rising side, falling off as the paper turns away
        shade = d <= 0.0 ? 1.0 : 1.0 + 0.14 * sin(2.0 * theta) - 0.07 * smoothstep(0.0, 1.5707963, theta);
    } else {
        vec2 buv = vec2(1.0 - uv.x, uv.y);
        col = texture(u_back, buv).rgb;
        float laid = smoothstep(2.4, 3.14159265, theta);
        // the underside is in its own shadow near the crest, easing to even paper once flat
        shade = mix(0.8 + 0.16 * sin(2.0 * (3.14159265 - theta)), 0.94, laid);
    }
    o = vec4(col * shade, 1.0);
}`

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
    const sh = gl.createShader(type)!
    gl.shaderSource(sh, src)
    gl.compileShader(sh)
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader')
    return sh
}

function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
    const p = gl.createProgram()!
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs))
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs))
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link')
    return p
}

function prefersReducedMotion(): boolean {
    try {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    } catch {
        return false
    }
}

/** How long a full turn takes, in ms. */
export const TURN_MS = 220


/** Draws a page turn as bent paper: the leaf wraps a cylinder whose axis follows the pointer, the
 *  back face shows the next page, a shadow falls on the page it uncovers, and a lighting gradient
 *  runs across the bend. The caller owns pointer handling and feeds `drag`. */
const PageTurnLayer: Component<PageTurnLayerProps> = props => {
    let root!: HTMLDivElement
    let canvas!: HTMLCanvasElement
    let draw: (() => void) | undefined
    let uploadAll: (() => void) | undefined

    onMount(() => {
        const setTurn = (s: TurnState) => root.setAttribute('data-turn-state', s)
        setTurn('idle')

        if (prefersReducedMotion()) {
            const id = requestAnimationFrame(() => {
                setTurn('settled')
                props.onSettled(true)
            })
            onCleanup(() => cancelAnimationFrame(id))
            return
        }

        const gl = canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true })
        if (!gl) {
            requestAnimationFrame(() => {
                setTurn('settled')
                props.onSettled(true)
            })
            return
        }

        const pagePrg = program(gl, PAGE_VS, PAGE_FS)
        const leafPrg = program(gl, LEAF_VS, LEAF_FS)

        const paperRgb = (): [number, number, number, number] => {
            const css = getComputedStyle(root).getPropertyValue('--bg').trim() || '#15161A'
            const c = document.createElement('canvas')
            c.width = c.height = 1
            const cx = c.getContext('2d')!
            cx.fillStyle = css
            cx.fillRect(0, 0, 1, 1)
            const [r, g, b] = cx.getImageData(0, 0, 1, 1).data
            return [r, g, b, 255]
        }

        const makeTex = (): WebGLTexture => {
            const t = gl.createTexture()!
            gl.bindTexture(gl.TEXTURE_2D, t)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
            return t
        }
        const texFrom = { left: makeTex(), right: makeTex() }
        const texTo = { left: makeTex(), right: makeTex() }
        const upload = (t: WebGLTexture, face: PageFace, side: 'left' | 'right' = 'right') => {
            gl.bindTexture(gl.TEXTURE_2D, t)
            if (face) {
                // draw the face contained on a page-aspect canvas of paper, as the still page does
                const src = face as CanvasImageSource & {
                    naturalWidth?: number
                    naturalHeight?: number
                    width: number
                    height: number
                }
                const fw = Math.max(1, src.naturalWidth || src.width)
                const fh = Math.max(1, src.naturalHeight || src.height)
                const aspect = pageW() / props.height
                const sh = Math.max(1, Math.round(Math.max(fh, fw / aspect)))
                const sw = Math.max(1, Math.round(sh * aspect))
                const scratch = document.createElement('canvas')
                scratch.width = sw
                scratch.height = sh
                const sg = scratch.getContext('2d')!
                const [pr, pg, pb] = paperRgb()
                sg.fillStyle = `rgb(${pr}, ${pg}, ${pb})`
                sg.fillRect(0, 0, sw, sh)
                const k = Math.min(sw / fw, sh / fh)
                const dw = fw * k
                const dh = fh * k
                // against the spine in a spread, as the still page draws it
                const dx = props.layout === 'single' ? (sw - dw) / 2 : side === 'left' ? sw - dw : 0
                sg.drawImage(face, dx, (sh - dh) / 2, dw, dh)
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, scratch)
            } else {
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(paperRgb()))
            }
        }
        uploadAll = () => {
            upload(texFrom.left, props.from.left, 'left')
            upload(texFrom.right, props.from.right, 'right')
            upload(texTo.left, props.to.left, 'left')
            upload(texTo.right, props.to.right, 'right')
        }

        // static quads and the leaf mesh share one vertex layout per program
        const quadBuf = gl.createBuffer()!
        const quadVao = gl.createVertexArray()!
        const leafBuf = gl.createBuffer()!
        const leafVao = gl.createVertexArray()!
        const idxBuf = gl.createBuffer()!
        const verts = (GRID_X + 1) * (GRID_Y + 1)
        const leafData = new Float32Array(verts * 6)
        const idx = new Uint16Array(GRID_X * GRID_Y * 6)
        {
            let k = 0
            for (let j = 0; j < GRID_Y; j++) {
                for (let i = 0; i < GRID_X; i++) {
                    const a = j * (GRID_X + 1) + i
                    const b = a + 1
                    const c = a + GRID_X + 1
                    const dd = c + 1
                    idx.set([a, c, b, b, c, dd], k)
                    k += 6
                }
            }
        }
        gl.bindVertexArray(leafVao)
        gl.bindBuffer(gl.ARRAY_BUFFER, leafBuf)
        gl.bufferData(gl.ARRAY_BUFFER, leafData.byteLength, gl.DYNAMIC_DRAW)
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf)
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW)
        const lp = (n: string) => gl.getAttribLocation(leafPrg, n)
        gl.enableVertexAttribArray(lp('a_pos'))
        gl.vertexAttribPointer(lp('a_pos'), 2, gl.FLOAT, false, 24, 0)
        gl.enableVertexAttribArray(lp('a_uvd'))
        gl.vertexAttribPointer(lp('a_uvd'), 3, gl.FLOAT, false, 24, 8)
        gl.enableVertexAttribArray(lp('a_z'))
        gl.vertexAttribPointer(lp('a_z'), 1, gl.FLOAT, false, 24, 20)

        gl.bindVertexArray(quadVao)
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf)
        const pp = (n: string) => gl.getAttribLocation(pagePrg, n)
        gl.enableVertexAttribArray(pp('a_pos'))
        gl.vertexAttribPointer(pp('a_pos'), 2, gl.FLOAT, false, 16, 0)
        gl.enableVertexAttribArray(pp('a_uv'))
        gl.vertexAttribPointer(pp('a_uv'), 2, gl.FLOAT, false, 16, 8)

        const fwd = () => props.direction === 'forward'
        const pageW = () => (props.layout === 'spread' ? props.width / 2 : props.width)
        const spineX = () => (props.layout === 'spread' ? props.width / 2 : fwd() ? 0 : props.width)
        const sign = () => (fwd() ? 1 : -1)

        const resize = () => {
            const dpr = Math.min(window.devicePixelRatio || 1, 2)
            const w = Math.max(1, Math.round(props.width * dpr))
            const h = Math.max(1, Math.round(props.height * dpr))
            if (canvas.width !== w || canvas.height !== h) {
                canvas.width = w
                canvas.height = h
            }
        }

        const drawQuad = (x0: number, x1: number, tex: WebGLTexture, curl: CurlState | null) => {
            const h = props.height
            gl.useProgram(pagePrg)
            gl.bindVertexArray(quadVao)
            gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf)
            gl.bufferData(
                gl.ARRAY_BUFFER,
                new Float32Array([x0, 0, 0, 0, x1, 0, 1, 0, x0, h, 0, 1, x1, 0, 1, 0, x1, h, 1, 1, x0, h, 0, 1]),
                gl.STREAM_DRAW,
            )
            gl.activeTexture(gl.TEXTURE0)
            gl.bindTexture(gl.TEXTURE_2D, tex)
            gl.uniform1i(gl.getUniformLocation(pagePrg, 'u_tex'), 0)
            gl.uniform2f(gl.getUniformLocation(pagePrg, 'u_size'), props.width, h)
            gl.uniform4f(
                gl.getUniformLocation(pagePrg, 'u_curl'),
                curl ? curl.axisX : 0,
                curl ? curl.angle : 0,
                curl ? curl.radius : 1,
                curl ? 1 : 0,
            )
            gl.uniform4f(gl.getUniformLocation(pagePrg, 'u_frame'), spineX(), sign(), h, pageW())
            gl.drawArrays(gl.TRIANGLES, 0, 6)
        }

        const render = (curl: CurlState | null) => {
            resize()
            const pw = pageW()
            const w = props.width
            const h = props.height
            gl.viewport(0, 0, canvas.width, canvas.height)
            const bg = paperRgb()
            gl.clearColor(bg[0] / 255, bg[1] / 255, bg[2] / 255, 1)
            gl.clearDepth(1)
            gl.enable(gl.DEPTH_TEST)
            gl.depthFunc(gl.LEQUAL)
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

            // no curl: draw the spread the timeline rests on, never the one it is about to reveal
            if (!curl) {
                const f = progress >= 1 ? texTo : texFrom
                if (props.layout === 'spread') {
                    drawQuad(0, pw, f.left, null)
                    drawQuad(pw, w, f.right, null)
                } else {
                    drawQuad(0, w, f.right, null)
                }
                return
            }

            // static pages
            if (props.layout === 'spread') {
                drawQuad(0, pw, fwd() ? texFrom.left : texTo.left, curl)
                drawQuad(pw, w, fwd() ? texTo.right : texFrom.right, curl)
            } else {
                drawQuad(0, w, texTo.right, curl)
            }
            // the leaf
            const sgn = sign()
            const sx = spineX()
            const page = { w: pw, h }
            let k = 0
            for (let j = 0; j <= GRID_Y; j++) {
                for (let i = 0; i <= GRID_X; i++) {
                    const x = (i / GRID_X) * pw
                    const y = (j / GRID_Y) * h
                    const q = deformPoint(x, y, curl, page)
                    leafData[k++] = sx + sgn * q.x
                    leafData[k++] = q.y
                    leafData[k++] = i / GRID_X
                    leafData[k++] = j / GRID_Y
                    leafData[k++] = q.d
                    leafData[k++] = q.z
                }
            }
            const frontTex = props.layout === 'spread' ? (fwd() ? texFrom.right : texFrom.left) : texFrom.right
            const backTex = props.layout === 'spread' ? (fwd() ? texTo.left : texTo.right) : null
            gl.useProgram(leafPrg)
            gl.bindVertexArray(leafVao)
            gl.bindBuffer(gl.ARRAY_BUFFER, leafBuf)
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, leafData)
            gl.activeTexture(gl.TEXTURE0)
            gl.bindTexture(gl.TEXTURE_2D, frontTex)
            gl.uniform1i(gl.getUniformLocation(leafPrg, 'u_front'), 0)
            gl.activeTexture(gl.TEXTURE1)
            gl.bindTexture(gl.TEXTURE_2D, backTex ?? blank)
            gl.uniform1i(gl.getUniformLocation(leafPrg, 'u_back'), 1)
            gl.uniform2f(gl.getUniformLocation(leafPrg, 'u_size'), w, h)
            gl.uniform1f(gl.getUniformLocation(leafPrg, 'u_zscale'), Math.max(curl.radius * 2, 1))
            gl.uniform1f(gl.getUniformLocation(leafPrg, 'u_radius'), curl.radius)
            gl.uniform1f(gl.getUniformLocation(leafPrg, 'u_mirror'), fwd() ? 0 : 1)
            gl.disable(gl.CULL_FACE)
            gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0)
        }

        const blank = makeTex()
        upload(blank, null)

        // ---- timeline ----
        let progress = 0
        let raf = 0
        let live = false

        const stop = () => {
            if (raf) cancelAnimationFrame(raf)
            raf = 0
        }
        const pointerCurl = (d: { x: number; y: number }): CurlState => {
            const px = fwd() ? d.x - spineX() : d.x - (spineX() - pageW())
            return curlFromPointer({
                pointer: { x: px, y: d.y },
                page: { w: pageW(), h: props.height },
                direction: props.direction,
            })
        }
        const frame = (curl: CurlState | null) => render(curl && curl.progress > 0 ? curl : null)

        const animate = (to: 0 | 1, committed: boolean) => {
            stop()
            const from = progress
            const total = props.durationMs ?? TURN_MS
            const dur = Math.max(1, total * Math.abs(to - from))
            const t0 = performance.now()
            setTurn('turning')
            const step = (now: number) => {
                const t = Math.min(1, (now - t0) / dur)
                progress = from + (to - from) * turnEase(t)
                frame(curlAt(progress, { w: pageW(), h: props.height }, props.direction))
                if (t < 1) {
                    raf = requestAnimationFrame(step)
                    return
                }
                raf = 0
                progress = to
                frame(null)
                setTurn('settled')
                props.onSettled(committed)
            }
            raf = requestAnimationFrame(step)
        }

        draw = () => {
            const d = props.drag
            if (d) {
                stop()
                live = true
                const c = pointerCurl(d)
                progress = c.progress
                setTurn('turning')
                frame(c)
            } else if (live) {
                live = false
                const s = settle(progress)
                animate(s.target, s.commit)
            }
        }

        uploadAll()
        if (props.drag) draw?.()
        else {
            frame(null)
            animate(1, true)
        }
        onCleanup(() => {
            stop()
            draw = undefined
            uploadAll = undefined
            for (const t of [texFrom.left, texFrom.right, texTo.left, texTo.right, blank]) gl.deleteTexture(t)
            for (const b of [quadBuf, leafBuf, idxBuf]) gl.deleteBuffer(b)
            gl.deleteVertexArray(quadVao)
            gl.deleteVertexArray(leafVao)
            gl.deleteProgram(pagePrg)
            gl.deleteProgram(leafPrg)
            gl.getExtension('WEBGL_lose_context')?.loseContext()
        })
    })

    createEffect(() => {
        props.drag
        draw?.()
    })
    createEffect(() => {
        props.from
        props.to
        if (uploadAll) {
            uploadAll()
            draw?.()
        }
    })

    return (
        <div
            ref={root}
            class={`${styles.layer} ${props.className ?? ''}`}
            style={{ width: `${props.width}px`, height: `${props.height}px` }}
            data-turn-state="idle"
        >
            <canvas ref={canvas} class={styles.canvas} />
        </div>
    )
}

// leaf-frame vertex -> deformed vertex plus the axis distance the fragment shader needs
function deformPoint(x: number, y: number, s: CurlState, page: { w: number; h: number }) {
    const q = deform(x, y, s, page)
    return { x: q.x, y: q.y, z: q.z, d: axisDistance(x, y, s, page) }
}

export default PageTurnLayer
