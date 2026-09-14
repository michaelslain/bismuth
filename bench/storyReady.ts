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
