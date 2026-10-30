import { SVG } from './state.ts';

/** Familiar actions share icons and accessible names, including controls created by live repaints. */
const ACTIONS:[string,keyof typeof SVG,string][]=[
  ['button.edit,button.rewrite','edit','Edit'],
  ['button.history,#showHistory','history','History'],
  ['button.del,button.drop,#deleteReviews,#clearAll,#bmClear','trash','Delete'],
  ['button.cancel,#rdrClose,#historyClose,#searchClose','x','Close'],
  ['#historyExport','download','Export history'],
  ['#historyCopy,#copySkillCommand','copy','Copy'],
];
export function decorateAction(button:HTMLButtonElement){
  const action=ACTIONS.find(([selector])=>button.matches(selector));
  if(!action) return;
  // Text written by an existing action (e.g. clipboard feedback or a changing count) updates its label.
  const text=button.textContent?.trim();
  const label=button.title||text||button.getAttribute('aria-label')||action[2];
  if(button.dataset.iconAction===action[1]&&button.firstElementChild?.tagName.toLowerCase()==='svg'&&!text) return;
  button.dataset.iconAction=action[1];
  button.setAttribute('aria-label',label); button.dataset.tooltip=label;
  button.removeAttribute('title');
  button.innerHTML=SVG[action[1]];
}
export function watchActions(){
  document.querySelectorAll<HTMLButtonElement>('button').forEach(decorateAction);
  new MutationObserver(entries=>{
    const buttons=new Set<HTMLButtonElement>();
    for(const entry of entries){
      const parent=entry.target instanceof Element?entry.target:(entry.target as Node).parentElement;
      const button=parent?.closest('button'); if(button) buttons.add(button);
      entry.addedNodes.forEach(node=>{
        if(!(node instanceof Element)) return;
        if(node.matches('button')) buttons.add(node as HTMLButtonElement);
        node.querySelectorAll<HTMLButtonElement>('button').forEach(b=>buttons.add(b));
      });
    }
    buttons.forEach(decorateAction);
  }).observe(document.body,{childList:true,subtree:true});
}
