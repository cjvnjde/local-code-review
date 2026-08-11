import { renderDiff } from './diff-view.ts';
import { persistCfg } from './persistence.ts';
import { SVG, el, state } from './state.ts';
import { revealActive } from './tree.ts';

/* ---------- file tree pane ---------- */
/** Paints pane and toggle from the stored preference. Called once the settings are loaded. */
export function applyNav(){
  const hidden=!!state.cfg.navHidden;
  const btn=el('navToggle');
  document.body.classList.toggle('notree',hidden);
  btn.classList.toggle('on',hidden);
  btn.innerHTML=hidden?SVG.panelOff:SVG.panel;
  btn.title=hidden?'Show the file tree':'Hide the file tree';
  btn.setAttribute('aria-pressed',String(hidden));
  // A pane that was closed could not scroll itself, so the current file may be out of its view.
  if(!hidden) revealActive();
}
el('navToggle').onclick=()=>{
  state.cfg.navHidden=!state.cfg.navHidden;
  persistCfg();
  applyNav();
  // The diff pane just changed width, so wrapped rows change height: same staleness a resize causes.
  state.h.clear(); renderDiff();
};

/* ---------- the two lists under the tree ---------- */
/**
 * Notes and bookmarks fold away to their own headers. Either list can grow past what it is worth on
 * screen and leave the tree a strip to scroll, and folding one gives that room back without giving up
 * what the header carries: the count stays readable, and the stepping buttons keep working, so a
 * folded list is still a way around the review. Both folds are preferences like the tree's own, and
 * neither touches the diff pane's width, so nothing needs re-rendering.
 */
const SECTIONS=[
  {pane:'ntpane',btn:'ntFold',cfg:'ntFold',what:'note list'},
  {pane:'bmpane',btn:'bmFold',cfg:'bmFold',what:'bookmark list'},
];
/** Paints both lists from the stored preferences. Called once the settings are loaded. */
export function applySections(){
  SECTIONS.forEach(s=>{
    const folded=!!state.cfg[s.cfg], btn=el(s.btn);
    el(s.pane).classList.toggle('folded',folded);
    btn.setAttribute('aria-expanded',String(!folded));
    btn.title=(folded?'Show the ':'Collapse the ')+s.what;
    btn.querySelector('.chev').innerHTML=folded?SVG.chevR:SVG.chevD;
  });
}
SECTIONS.forEach(s=>{
  el(s.btn).onclick=()=>{
    state.cfg[s.cfg]=!state.cfg[s.cfg];
    persistCfg();
    applySections();
  };
});
