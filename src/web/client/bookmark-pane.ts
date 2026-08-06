import { bmKey, bookmarkOf, orderBookmarks, stepAt } from './bookmarks.ts';
import { mountRowAt, setFolded, setHidden } from './diff-view.ts';
import { isHidden } from './filters.ts';
import { save } from './persistence.ts';
import { SVG, clip, el, esc, idxOf, keyIndex, rowKey, state } from './state.ts';
import { paintActive } from './tree.ts';

/* ---------- bookmark list: the places this read is jumping between ---------- */
/** Every bookmark placed in the rendered diff, in the order the diff shows them. */
function ordered(){
  return orderBookmarks([...state.bookmarks.values()],(b: any)=>{
    const fi=idxOf(b.file), f=fi>=0?state.files[fi]:null;
    const ki=f?keyIndex(f):null;
    return {fi,i:ki&&ki.has(b.a)?ki.get(b.a):-1};
  });
}
/** The pane only exists while there is somewhere to jump to, so an empty list takes no room. */
export function renderBookmarks(){
  const list=ordered();
  el('bmpane').hidden=!list.length;
  el('bmct').textContent=String(list.length);
  el('bmlist').innerHTML=list.map(e=>{
    const b=e.b;
    return '<div class="bw'+(e.gone?' gone':'')+(b.key===state.bmCur?' cur':'')+
      '" data-bm-go="'+esc(b.key)+'" title="'+esc(b.file+':'+b.line)+
      (e.gone?' — not in this diff any more':'')+'">'+
      '<span class="bi"><span class="loc">'+esc(b.file.split('/').pop()+':'+b.line)+'</span>'+
      '<span class="tx">'+esc(clip(b.text,64))+'</span></span>'+
      '<button class="rm" data-bm-rm="'+esc(b.key)+'" title="Remove this bookmark" '+
        'aria-label="Remove this bookmark">'+SVG.x+'</button></div>';
  }).join('');
}
/** The flag in one row's action cell: the mark stays lit without a hover once the row is bookmarked. */
function paintRow(fi: number,idx: number){
  const tr=el('r'+fi+'-'+idx); if(!tr) return;
  const f=state.files[fi], row=f&&f.rows[idx];
  if(!row||row.t==='hunk') return;
  const btn=tr.querySelector('[data-bm]'); if(!btn) return;
  const on=state.bookmarks.has(bmKey(f.path,rowKey(row)));
  btn.classList.toggle('on',on);
  btn.innerHTML=on?SVG.bmOn:SVG.bm;
  btn.title=on?'Remove this bookmark':'Bookmark this line';
}
/** Repaints the row a bookmark sat on, when the diff on screen still holds it. */
function repaintAnchor(b: any){
  const fi=idxOf(b.file); if(fi<0) return;
  const ki=keyIndex(state.files[fi]);
  if(ki.has(b.a)) paintRow(fi,ki.get(b.a));
}
/** Bookmarking one row, or dropping the bookmark that is already on it. */
export function toggleBookmark(fi: number,idx: number){
  const f=state.files[fi]; if(!f) return;
  const row=f.rows[idx];
  if(!row||row.t==='hunk') return;
  const b=bookmarkOf(f.path,row);
  if(state.bookmarks.has(b.key)){
    state.bookmarks.delete(b.key);
    if(state.bmCur===b.key) state.bmCur='';
  }else{
    state.bookmarks.set(b.key,b);
    state.bmCur=b.key; // stepping on from the one just made is the move that follows
  }
  save(); paintRow(fi,idx); renderBookmarks();
}
function removeBookmark(key: string){
  const b=state.bookmarks.get(key); if(!b) return;
  state.bookmarks.delete(key);
  if(state.bmCur===key) state.bmCur='';
  save(); repaintAnchor(b); renderBookmarks();
}
/** Marks the row a jump landed on for a moment, so the eye finds it without hunting the pane.
 *  The pending timer is dropped with the mark it was set for, or landing on the same row twice in
 *  quick succession would have the first jump's timer clear the second jump's mark. */
let lit: any=null, litT: any=null;
function flash(row: any){
  if(lit) lit.classList.remove('bmhit');
  clearTimeout(litT);
  lit=row; row.classList.add('bmhit');
  litT=setTimeout(()=>{ if(lit) lit.classList.remove('bmhit'); lit=null; },1400);
}
/**
 * Goes to one bookmark. A hidden file is brought back and a collapsed one opened, since the point of
 * the jump is to read the line; a bookmark the diff can no longer place settles for its file.
 */
function goTo(e: any){
  const b=e.b;
  state.bmCur=b.key;
  renderBookmarks();
  const fi=idxOf(b.file);
  if(fi<0) return; // the file left the diff; the entry stays listed as gone
  if(isHidden(b.file)) setHidden([b.file],false);
  if(state.folded.has(b.file)) setFolded(b.file,false);
  state.jumpUntil=performance.now()+500; // landing on a file is not reading past it
  const row=e.gone?null:mountRowAt(fi,e.i);
  const target=row||el('f'+fi);
  if(target) target.scrollIntoView({block:row?'center':'start'});
  // A jump that lands where the pane already was fires no scroll, so claim the file here.
  state.active=b.file; paintActive();
  if(row) flash(row);
}
/** Walks the list from wherever it was left, wrapping at both ends. */
export function stepBookmark(dir: number){
  const list=ordered();
  if(!list.length) return;
  const cur=list.findIndex(e=>e.b.key===state.bmCur);
  goTo(list[stepAt(list.length,cur,dir)]);
}

el('bmPrev').innerHTML=SVG.expUp;
el('bmNext').innerHTML=SVG.expDown;
el('bmPrev').onclick=()=>stepBookmark(-1);
el('bmNext').onclick=()=>stepBookmark(1);
el('bmClear').onclick=()=>{
  const all=[...state.bookmarks.values()];
  if(!all.length) return;
  if(!confirm('Remove '+all.length+' bookmark'+(all.length===1?'':'s')+'?')) return;
  state.bookmarks.clear(); state.bmCur='';
  save();
  all.forEach(repaintAnchor);
  renderBookmarks();
};
el('bmlist').addEventListener('click',e=>{
  const rm=e.target.closest('[data-bm-rm]');
  if(rm){ removeBookmark(rm.dataset.bmRm); return; }
  const go=e.target.closest('[data-bm-go]');
  if(!go) return;
  const hit=ordered().find(x=>x.b.key===go.dataset.bmGo);
  if(hit) goTo(hit);
});
/** Stepping without the mouse. Alt keeps it clear of typing, and of the editor's own chords. */
document.addEventListener('keydown',e=>{
  if(!e.altKey||e.metaKey||e.ctrlKey) return;
  if(e.key!=='ArrowUp'&&e.key!=='ArrowDown') return;
  const t: any=e.target;
  if(t&&(t.tagName==='TEXTAREA'||t.tagName==='INPUT'||t.isContentEditable)) return;
  if(!state.bookmarks.size) return;
  e.preventDefault();
  stepBookmark(e.key==='ArrowDown'?1:-1);
});
