import { idxOf, state } from './state.ts';

/* ---------- file filters: glob patterns that keep whole groups of files out of the review ---------- */
const cache=new Map<string,RegExp|null>();
/**
 * Glob subset: `*` stays inside one path segment, `**` crosses segments, `?` is one character.
 * A pattern without `/` matches the file name anywhere; a trailing `/` means everything below it.
 */
export function globRx(pattern: string){
  if(cache.has(pattern)) return cache.get(pattern);
  let p=pattern.trim();
  if(p.startsWith('./')) p=p.slice(2);
  if(!p||p.startsWith('#')){ cache.set(pattern,null); return null; }
  const anchored=p.includes('/')&&!p.endsWith('/');
  if(p.endsWith('/')) p+='**';
  let body='';
  for(let i=0;i<p.length;i++){
    const c=p[i];
    if(c==='*'){
      if(p[i+1]!=='*'){ body+='[^/]*'; continue; }
      i++;
      if(p[i+1]==='/'){ i++; body+='(?:[^/]+/)*'; } // `a/**/b` also matches `a/b`
      else body+='.*';
    }
    else if(c==='?') body+='[^/]';
    else body+=c.replace(/[.+^${}()|[\]\\]/g,'\\$&');
  }
  const rx=new RegExp('^'+(anchored?'':'(?:.*/)?')+body+'$');
  cache.set(pattern,rx);
  return rx;
}
export function compileHide(text: string){
  return String(text||'').split(/[\n,]/).map(globRx).filter(Boolean) as RegExp[];
}
export const matchesHide=(path: string)=>state.hideRx.some((rx: RegExp)=>rx.test(path));
/** A file the diff removed entirely: nothing of it is left to read, only the lines it took away. */
export function isDeleted(path: string){
  const i=idxOf(path);
  return i>=0&&state.files[i].status==='deleted';
}
/** Every hide the settings apply on their own, before any per-file eye click. */
export const autoHidden=(path: string)=>matchesHide(path)||(!!state.cfg.hideDeleted&&isDeleted(path));
/** An automatic hide is only a default: revealing one file by hand keeps it visible. */
export const filteredOut=(path: string)=>autoHidden(path)&&!state.shown.has(path);
export const isHidden=(path: string)=>state.hidden.has(path)||filteredOut(path);
export function hiddenCount(){
  let n=0;
  state.files.forEach((f: any)=>{ if(isHidden(f.path)) n++; });
  return n;
}
export function filteredCount(){
  let n=0;
  state.files.forEach((f: any)=>{ if(filteredOut(f.path)) n++; });
  return n;
}
