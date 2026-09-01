import { esc } from './state.ts';

/* ---------- paths that keep both ends in view ---------- */

const ELLIPSIS='…';

/** The shortest useful form of a path: its beginning and its complete file name. */
function shortestPath(path: string){
  const slash=path.lastIndexOf('/');
  if(slash<3) return path;
  return Array.from(path)[0]+ELLIPSIS+path.slice(slash);
}

/**
 * Removes one contiguous run from the middle of a path until it fits. The file name is outside the
 * removable run, so it never acquires an ellipsis of its own; the kept directory characters are
 * balanced between the beginning and end, like a native middle-truncated label.
 */
export function middleElidePath(path: string,fits: (text: string)=>boolean){
  const text=String(path), chars=Array.from(text), slash=text.lastIndexOf('/');
  if(fits(text)||slash<3) return text;

  const name=Array.from(text.slice(slash));
  const directory=chars.slice(0,chars.length-name.length);
  const candidate=(removed: number)=>{
    const kept=directory.length-removed;
    const left=Math.ceil(kept/2), right=Math.floor(kept/2);
    return directory.slice(0,left).join('')+ELLIPSIS+
      directory.slice(directory.length-right).join('')+name.join('');
  };

  let low=1, high=directory.length-1, answer=shortestPath(text);
  while(low<=high){
    const removed=Math.floor((low+high)/2), next=candidate(removed);
    if(fits(next)){ answer=next; high=removed-1; }
    else low=removed+1;
  }
  return answer;
}

type PathOptions={className?: 'from'|'to'|'was'; title?: string};

/** One measured label; `watchPaths` decides how much of its middle can be shown once it is mounted. */
export function pathHtml(path: unknown,options: PathOptions={}){
  const text=String(path), cls='pth'+(options.className?' '+options.className:'');
  return '<span class="'+cls+'"'+(options.title?' title="'+esc(options.title)+'"':'')+
    ' data-path="'+esc(text)+'"><span class="ptx">'+esc(text)+'</span></span>';
}

/** A rename names both sides of the move, while every other file keeps its ordinary path. */
export const filePathHtml=(file: {path: string,from?: string})=>file.from&&file.from!==file.path
  ?pathHtml(file.from,{className:'from'})+'<span class="arrow">→</span>'+pathHtml(file.path,{className:'to'})
  :pathHtml(file.path);
export const filePathTitle=(file: {path: string,from?: string})=>file.from&&file.from!==file.path
  ?file.from+' → '+file.path
  :file.path;

/** Measures with the rendered font instead of guessing from character counts. */
function measure(label: HTMLElement,text: string){
  label.textContent=text;
  const range=document.createRange();
  range.selectNodeContents(label);
  return range.getBoundingClientRect().width;
}

/** The outer rename label is another flex item, so it reserves the minimums of both path sides. */
function reserveFileNames(container: HTMLElement){
  const group=container.parentElement;
  if(!group||!group.classList.contains('file-path')) return;
  const required=[...group.children].reduce((width,child)=>{
    if(!(child instanceof HTMLElement)) return width;
    return width+(child.classList.contains('pth')?parseFloat(child.style.minWidth)||0:child.getBoundingClientRect().width);
  },0);
  const minWidth=Math.ceil(required)+'px';
  if(group.style.minWidth!==minWidth) group.style.minWidth=minWidth;
}

function fitPath(container: HTMLElement){
  const label=container.querySelector<HTMLElement>('.ptx');
  if(!label) return;
  const path=container.dataset.path||'';
  const required=Math.ceil(measure(label,shortestPath(path)));
  const minWidth=required+'px';
  if(container.style.minWidth!==minWidth) container.style.minWidth=minWidth;
  reserveFileNames(container);
  const available=container.getBoundingClientRect().width+.5;
  label.textContent=middleElidePath(path,text=>measure(label,text)<=available);
}

/**
 * Paths are created by several independent renders. One observer adopts each label as it appears,
 * and the resize observer re-fits it when a pane or window changes width.
 */
export function watchPaths(){
  const resize=new ResizeObserver(entries=>entries.forEach(entry=>fitPath(entry.target as HTMLElement)));
  const visit=(node: Node,observe: boolean)=>{
    if(!(node instanceof Element)) return;
    const paths=[...(node.matches('.pth[data-path]')?[node]:[]),...node.querySelectorAll('.pth[data-path]')];
    paths.forEach(path=>observe?resize.observe(path):resize.unobserve(path));
  };
  document.querySelectorAll('.pth[data-path]').forEach(path=>resize.observe(path));
  new MutationObserver(entries=>entries.forEach(entry=>{
    entry.addedNodes.forEach(node=>visit(node,true));
    entry.removedNodes.forEach(node=>visit(node,false));
  })).observe(document.body,{childList:true,subtree:true});
}
