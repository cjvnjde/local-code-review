import { renderDiff } from './diff-view.ts';
import { persistCfg } from './persistence.ts';
import { SVG, el, state } from './state.ts';

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
}
el('navToggle').onclick=()=>{
  state.cfg.navHidden=!state.cfg.navHidden;
  persistCfg();
  applyNav();
  // The diff pane just changed width, so wrapped rows change height: same staleness a resize causes.
  state.h.clear(); renderDiff();
};
