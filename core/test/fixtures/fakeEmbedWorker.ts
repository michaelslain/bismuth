// A stand-in embedding child for memoryEmbed.test.ts: the real protocol (runEmbedWorker), a fake
// model. FAKE_MODE=hang makes every request never answer; FAKE_MODE=crash exits on the first
// request; FAKE_MODE=loadfail fails the load.
import { runEmbedWorker } from '../../src/embedWorker'

const mode = process.env.FAKE_MODE ?? ''
void runEmbedWorker(async () => {
    if (mode === 'loadfail') throw new Error('no model here')
    return {
        async run(texts) {
            if (mode === 'hang') await new Promise(() => {})
            if (mode === 'crash') process.exit(3)
            const data = Float32Array.from(texts.flatMap(t => (t.includes('beta') ? [0, 1] : [1, 0])))
            return { data, dims: [texts.length, 2] }
        },
        dispose() {},
    }
})
