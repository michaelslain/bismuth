// bench/storyReady.ts — the one page-side expression that answers "has this story painted anything
// yet?", shared by every sweep that has to wait before it measures.
//
// WHY A SHARED FILE INSTEAD OF TWO COPIES. bench/invariants.ts carried this expression inline first
// and got it right; bench/storyAudit.ts's own settle-and-converge loop had no readiness precondition
// at all, so a pre-mount page (a perfectly stable empty state) could satisfy its "two identical
// probes" convergence test and get flagged empty-render under pool contention — see the header of
// storyAudit.ts for the concrete story that reproduced it. Rather than pasting a second copy in, this
// pulls the one invariants.ts already had into a shared constant so both sweeps poll the identical
// definition of "ready" and a future fix to it only has to happen once.
//
// WHY A COUNT, NOT A BOOLEAN. Callers only care whether it went from 0 to something, but returning
// the count costs nothing and is occasionally useful to log.
//
// WHY #storybook-root PLUS non-chrome document.body children, not document.body wholesale. Every
// modal in this app (ui-modal, the five app modals, FolderPrompt) and the symbol gallery renders
// through a Solid <Portal> into document.body, outside #storybook-root — scoping to the root alone
// would report "still empty" forever for any story that opens one. Storybook's own dormant chrome
// (.sb-preparing-story, .sb-preparing-docs, .sb-nopreview, .sb-errordisplay, .sb-wrapper, and the
// docs/highlights roots) sits in document.body permanently and is excluded by id/class so it never
// counts as "painted".
//
// Copied verbatim from the expression bench/invariants.ts carried inline before this file existed
// (invariants.ts:298-304 as of e5655fd4), including its isChrome regex — do not "improve" one copy
// without checking whether the other sweep's expectations still hold.
export const STORY_READY_EXPRESSION = `(()=>{
  const SB=['storybook-root','storybook-docs','storybook-highlights-root'];
  const isChrome=el=>el.tagName==='SCRIPT'||el.tagName==='STYLE'||(el.id&&SB.indexOf(el.id)>=0)||/\\bsb-(preparing-story|preparing-docs|nopreview|errordisplay|wrapper)\\b/.test(el.getAttribute('class')||'');
  const r=document.querySelector('#storybook-root'); if(!r) return 0;
  let n=r.querySelectorAll('*').length;
  for(const el of Array.prototype.slice.call(document.body.children)) if(el!==r&&!isChrome(el)) n+=el.querySelectorAll('*').length;
  return n})()`

// WHY A SECOND SIGNAL: STORYBOOK'S OWN LIFECYCLE. The expression above cannot tell "Storybook is
// still loading this story's module" from "the story mounted and drew nothing", and any deadline
// counted from navigation pays for that load. A cold heavy module (Editor.stories.tsx with its
// editor and query-block graph, about 4-6 s on an idle machine and more under load) used up the
// whole paint deadline, and the converge loop then shot a stable empty page as empty-render.
// Storybook announces the end of a story's render on its addons channel, the same channel
// bench/playCheck.ts grades play() from: `storyFinished` once render (and play, when there is one)
// is done, `storyThrewException` / `storyErrored` when it never mounts. Wait on that first, then on
// paint. Install with Page.addScriptToEvaluateOnNewDocument so it runs before the page's own
// scripts and again after any reload (a Vite dep re-optimise reloads the frame).
export const STORY_LIFECYCLE_INJECT = `(function () {
    window.__storyLife = { rendered: false, done: false, error: null };
    ;(function poll() {
        var ch = window.__STORYBOOK_ADDONS_CHANNEL__;
        if (!ch) return setTimeout(poll, 10);
        ch.on('storyRenderPhaseChanged', function (e) {
            if (/^(playing|played|afterEach|completed|finished)$/.test((e && e.newPhase) || '')) window.__storyLife.rendered = true;
        });
        ch.on('storyFinished', function () { window.__storyLife.rendered = true; window.__storyLife.done = true; });
        ['storyThrewException', 'storyErrored'].forEach(function (n) {
            ch.on(n, function (e) {
                e = e || {};
                window.__storyLife.error = n + ': ' + String(e.message || e.description || e.title || JSON.stringify(e)).slice(0, 200);
                window.__storyLife.rendered = true;
                window.__storyLife.done = true;
            });
        });
    })();
})();`

/** `{ rendered, done, error }` from STORY_LIFECYCLE_INJECT, as a JSON string; `null` before the
 *  hook exists. `rendered` turns true once the story has mounted (play() may still be running);
 *  `done` once render and play() are both over. A throw sets both, with `error`. */
export const STORY_LIFECYCLE_EXPRESSION = `JSON.stringify(window.__storyLife || null)`

/** Polls STORY_LIFECYCLE_EXPRESSION on a page that has STORY_LIFECYCLE_INJECT installed until the
 *  story reaches `until` or throws, or `timeoutMs` passes. storyAudit waits for `done` (it shoots
 *  the frame play() leaves); invariants waits for `rendered` (it measures the mounted story, as it
 *  did when it waited on paint alone). */
export const waitForStoryLifecycle = async (
    p: (method: string, params?: any) => Promise<any>,
    until: 'rendered' | 'done',
    timeoutMs: number,
): Promise<{ ms: number; timedOut: boolean; error: string | null }> => {
    const start = Date.now()
    for (;;) {
        const q = await p('Runtime.evaluate', { expression: STORY_LIFECYCLE_EXPRESSION, returnByValue: true })
        const life = q?.exceptionDetails ? null : JSON.parse(q?.result?.value ?? 'null')
        if (life?.error) return { ms: Date.now() - start, timedOut: false, error: life.error }
        if (life?.[until]) return { ms: Date.now() - start, timedOut: false, error: null }
        if (Date.now() - start > timeoutMs) return { ms: Date.now() - start, timedOut: true, error: null }
        await new Promise(r => setTimeout(r, 250))
    }
}
