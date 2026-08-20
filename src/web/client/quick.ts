import { renderDiff } from './diff-view.ts';
import { persistCfg } from './persistence.ts';
import { SVG, el, state } from './state.ts';

/* ---------- settings the header keeps within reach ---------- */
/**
 * A setting answered while reading is not the same thing as a setting answered while configuring.
 * Two clicks down a panel that has to be opened, read past and dismissed again is far enough that
 * nobody flips it in the middle of a file, so the ones that belong to the reading itself sit in the
 * header as toggles. Nothing about them changes on the way up: they carry the panel's own wording,
 * they write the same `state.cfg`, and the panel keeps the prose that says what they do. A file
 * that has answered for itself still outranks the setting, so flipping one here moves the default
 * and leaves those files exactly where they stand.
 */
const QUICK=[
  {
    btn:'qFoldDel', cfg:'foldDel', label:'removed',
    on:'Show removed lines again in the files that have not answered for themselves',
    off:'Fold removed lines into blocks I can open',
    /** Folding changes how tall every block is, so no measured height survives the switch. */
    redraw:true,
  },
];
/** Paints every header toggle from the stored preferences. Called once the settings are loaded. */
export function applyQuick(){
  QUICK.forEach(q=>{
    const on=!!state.cfg[q.cfg], btn=el(q.btn);
    btn.classList.toggle('on',on);
    btn.title=on?q.on:q.off;
    btn.setAttribute('aria-pressed',String(on));
    btn.innerHTML=(on?SVG.chevR:SVG.chevD)+'<span>'+q.label+'</span>';
  });
}
QUICK.forEach(q=>{
  el(q.btn).onclick=()=>{
    state.cfg[q.cfg]=!state.cfg[q.cfg];
    persistCfg();
    applyQuick();
    if(q.redraw){ state.h.clear(); renderDiff(); }
  };
});
