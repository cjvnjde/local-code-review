import { bmKey } from './bookmarks.ts';
import { expandStep } from './expand.ts';
import { autoHidden, isHidden } from './filters.ts';
import { gapOf, gapSize } from './gaps.ts';
import { codeHtml, langOf } from './highlight.ts';
import { applyFileNote, applyNotesIn, charMarks } from './notes.ts';
import { save } from './persistence.ts';
import { paintSel } from './selection.ts';
import { SVG, el, esc, idxOf, rowKey, state } from './state.ts';
import { followDiff, renderTree } from './tree.ts';
import { updateCount } from './footer.ts';
import { wordDiff } from './word-diff.ts';

/* ---------- diff: rows live in lazily mounted blocks so huge diffs stay cheap ---------- */
// ROW_H is the height an unmounted row is assumed to have; keep it equal to --row in styles.css.
const BLOCK=150, ROW_H=24;
const blockCount=f=>Math.max(1,Math.ceil(f.rows.length/BLOCK));
const blockEnd=(f,b)=>Math.min(f.rows.length,b*BLOCK+BLOCK);
function blockH(f,b){
  const m=state.h.get(f.path+'|'+b);
  return m!=null?m:(blockEnd(f,b)-b*BLOCK)*ROW_H;
}
const phHtml=h=>'<tr class="ph"><td colspan="4" style="height:'+h+'px"></td></tr>';

export function renderDiff(){
  const sec=el('diff');
  obsMount.disconnect(); obsDrop.disconnect();
  if(!state.files.length){ sec.innerHTML='<div class="empty">No changes in this diff. Nothing to review.</div>'; return; }
  const shown=state.files.map((f,i)=>i).filter(i=>!isHidden(state.files[i].path));
  if(!shown.length){
    sec.innerHTML='<div class="empty">Every file is hidden. Use the eye icons in the tree, '+
      'or clear the hide patterns in settings, to bring them back.</div>';
    return;
  }
  sec.innerHTML=shown.map(i=>fileHtml(state.files[i],i)).join('');
  shown.forEach(i=>applyFileNote(state.files[i],i));
  sec.querySelectorAll('tbody.blk').forEach(observeBlock);
  sec.querySelectorAll('.file').forEach(n=>obsPass.observe(n));
  followDiff(); // the cards moved, so which of them the pane is showing may have changed
}

function fileHtml(f,fi){
  const folded=state.folded.has(f.path), seen=state.viewed.has(f.path);
  const cls='file'+(folded?' fold':'')+(seen?' seen':'');
  const head='<div class="fh">'+
    '<button class="fchev" data-fold="'+esc(f.path)+'" title="'+(folded?'Expand file':'Collapse file')+'">'+
      (folded?SVG.chevR:SVG.chevD)+'</button>'+
    '<span class="p">'+esc(f.path)+'</span>'+
    '<span class="s">'+f.status+'</span>'+
    '<span class="plus">+'+f.added+'</span><span class="minus">-'+f.removed+'</span>'+
    (state.stale&&state.stale.has(f.path)?'<span class="stale">changed since viewed</span>':'')+
    '<span class="spacer"></span>'+
    '<button class="cf" data-cf="'+esc(f.path)+'" title="Comment on this file as a whole">'+
      SVG.plus+' comment</button>'+
    '<button class="vw'+(seen?' on':'')+'" data-vw="'+esc(f.path)+'" title="'+
      (seen?'Mark as not reviewed':'Mark reviewed — collapses until the file changes')+'">'+
      (seen?SVG.boxOn:SVG.box)+' viewed</button>'+
    '<button class="eye" data-hf="'+esc(f.path)+'" title="Hide from diff">'+SVG.eye+' hide</button></div>'+
    // Whole-file notes hang off the header, so a binary or folded file can still carry one.
    '<div class="fnotes" id="fn'+fi+'"></div>';
  if(f.binary) return '<div class="'+cls+'" id="f'+fi+'" data-path="'+esc(f.path)+'">'+head+
    '<div class="empty">Binary file — not shown.</div></div>';
  return '<div class="'+cls+'" id="f'+fi+'" data-path="'+esc(f.path)+'">'+head+
    '<table>'+tableHtml(f,fi)+'</table></div>';
}
function tableHtml(f,fi){
  const blocks=[];
  for(let b=0;b<blockCount(f);b++){
    blocks.push('<tbody class="blk" id="b'+fi+'-'+b+'" data-fi="'+fi+'" data-b="'+b+'">'+phHtml(blockH(f,b))+'</tbody>');
  }
  // The action column holds two hover controls, the comment button and the bookmark flag.
  return '<colgroup><col style="width:48px"><col style="width:50px"><col style="width:50px"><col></colgroup>'+
    blocks.join('');
}
/**
 * Rebuilds one file's rows after lines were revealed into it. Every row id below the insertion point
 * moved, so the table is rendered again; blocks above it kept their rows and therefore their cached
 * heights, which is what stops the page from jumping while it happens.
 */
export function refreshRows(fi: number,from: number){
  const f=state.files[fi], node=el('f'+fi);
  if(!f||!node) return;
  const table=node.querySelector('table'); if(!table) return;
  if(state.sel&&state.sel.fi===fi) state.sel=null; // it pointed at rows that have moved
  const first=Math.floor(from/BLOCK), prefix=f.path+'|';
  [...state.h.keys()].forEach(k=>{
    const cut=k.lastIndexOf('|');
    if(k.slice(0,cut+1)===prefix&&Number(k.slice(cut+1))>=first) state.h.delete(k);
  });
  node.querySelectorAll('tbody.blk').forEach(tb=>{ obsMount.unobserve(tb); obsDrop.unobserve(tb); });
  table.innerHTML=tableHtml(f,fi);
  table.querySelectorAll('tbody.blk').forEach(observeBlock);
  // Show the revealed lines now rather than a frame later, once the mount observer catches up.
  for(let b=first;b<=first+1;b++){ const tb=el('b'+fi+'-'+b); if(tb) mountBlock(tb); }
}

/**
 * Mount ahead of the viewport, drop far behind it. The gap between the two margins
 * is the hysteresis that stops blocks thrashing while scrolling.
 */
const obsMount=new IntersectionObserver(
  es=>es.forEach(e=>{ if(e.isIntersecting) mountBlock(e.target); }),
  {root:el('diff'),rootMargin:'1200px 0px'},
);
const obsDrop=new IntersectionObserver(
  es=>es.forEach(e=>{ if(!e.isIntersecting) unmountBlock(e.target); }),
  {root:el('diff'),rootMargin:'3000px 0px'},
);
function observeBlock(tb){ obsMount.observe(tb); obsDrop.observe(tb); }
function unobserveIn(node){
  node.querySelectorAll('tbody.blk').forEach(tb=>{ obsMount.unobserve(tb); obsDrop.unobserve(tb); });
  obsPass.unobserve(node);
}

/* ---------- automatic viewed: a file read at reading speed marks itself off ---------- */
let scrollSpeed=0, scrollDir=0;
(function trackScroll(){
  const sec=el('diff');
  let lastY=sec.scrollTop, lastT=performance.now();
  sec.addEventListener('scroll',()=>{
    const t=performance.now(), y=sec.scrollTop, dt=t-lastT;
    if(dt>=8){
      scrollSpeed=scrollSpeed*0.55+(Math.abs(y-lastY)/dt*1000)*0.45;
      if(y!==lastY) scrollDir=y>lastY?1:-1;
      lastY=y; lastT=t;
    }
    state.scrolled=true;
    if(scrollDir===-1) undoPass();
  },{passive:true});
})();
/** Root shrunk to a zero-height line at the top of the pane: entries fire as a card crosses it. */
const obsPass=new IntersectionObserver(es=>es.forEach(passedTop),{root:el('diff'),rootMargin:'0px 0px -100% 0px'});
function tooFast(){ return state.cfg.limit>0&&scrollSpeed>state.cfg.limit; }
function passedTop(e){
  if(!state.cfg.auto||!state.scrolled) return;
  if(performance.now()<state.jumpUntil||tooFast()) return;
  const p=e.target.dataset.path;
  if(!p) return;
  const line=e.rootBounds?e.rootBounds.top:0;
  const box=e.boundingClientRect;
  if(scrollDir===1&&!e.isIntersecting&&box.bottom<=line+1){
    if(state.viewed.has(p)||state.folded.has(p)) return; // collapsed means its lines were never on screen
    if(setViewed([p],true,true).length){ state.autoNow.add(p); toast(p,true); }
    return;
  }
  if(scrollDir===-1) undoPass();
}
/** Files this session auto-marked that are back on screen, nearest the top line first. */
function undoEligible(){
  const sec=el('diff');
  const line=sec.getBoundingClientRect().top, pane=sec.clientHeight, out=[];
  state.autoNow.forEach(p=>{
    const node=el('f'+idxOf(p));
    if(!node) return;
    const gap=node.getBoundingClientRect().top-line;
    if(gap>=-1&&gap<pane) out.push({p,gap});
  });
  return out.sort((a,b)=>a.gap-b.gap);
}
/** One file per tick, so a re-expansion cascade cannot unwind a whole run at once. */
let undoT=null;
function scheduleUndo(){
  if(undoT) return;
  undoT=setTimeout(()=>{ undoT=null; undoPass(); },260);
}
function undoPass(){
  if(!state.cfg.auto||!state.cfg.back||!state.scrolled) return;
  if(scrollDir!==-1||tooFast()||performance.now()<state.jumpUntil) return;
  const now=performance.now();
  if(now-state.lastUndo<250){ scheduleUndo(); return; }
  const list=undoEligible();
  if(!list.length) return;
  state.lastUndo=now;
  const p=list[0].p;
  state.autoNow.delete(p);
  if(setViewed([p],false).length) toast(p,false);
  if(undoEligible().length) scheduleUndo();
}
function toast(p,on){
  if(!state.cfg.toast) return;
  const host=el('toasts');
  const t=document.createElement('div');
  t.className='toast'+(on?'':' off');
  t.innerHTML='<span class="ic">'+(on?SVG.boxOn:SVG.box)+'</span>'+
    '<span class="tx" title="'+esc(p)+'">'+esc(p.split('/').pop())+'</span>'+
    '<span class="lbl">'+(on?'viewed':'unviewed')+'</span><button class="undo">undo</button>';
  t.querySelector('.undo').onclick=()=>{ setViewed([p],!on); t.remove(); };
  host.append(t);
  while(host.children.length>3) host.firstElementChild.remove();
  setTimeout(()=>{ t.classList.add('out'); setTimeout(()=>t.remove(),200); },2600);
}

/** True when the element starts above the fold, so resizing it would shove the visible content. */
function anchored(node){
  return node.getBoundingClientRect().top<el('diff').getBoundingClientRect().top;
}
function mountBlock(tb){
  if(tb.dataset.on||!tb.offsetParent) return;
  const fi=Number(tb.dataset.fi), b=Number(tb.dataset.b), f=state.files[fi];
  if(!f) return;
  const from=b*BLOCK, to=blockEnd(f,b);
  const above=anchored(tb);
  const before=tb.offsetHeight;
  const lang=langOf(f.path), wd=wordDiff(f), html=[];
  for(let k=from;k<to;k++) html.push(rowHtml(f,fi,k,lang,wd.get(k)));
  tb.innerHTML=html.join('');
  tb.dataset.on='1';
  applyNotesIn(f,fi,from,to);
  const after=tb.offsetHeight;
  state.h.set(f.path+'|'+b,after);
  if(above&&after!==before) el('diff').scrollTop+=after-before;
  if(state.sel&&state.sel.fi===fi) paintSel();
}
/**
 * Mounts the block one row lives in and hands the row back, so a jump can land on a line the pane
 * has never scrolled to. Blocks around it stay placeholders of their estimated height, which is
 * enough to put the row on screen; they correct themselves as they mount.
 */
export function mountRowAt(fi: number,idx: number){
  const tb=el('b'+fi+'-'+Math.floor(idx/BLOCK));
  if(tb) mountBlock(tb);
  return el('r'+fi+'-'+idx);
}
function unmountBlock(tb){
  if(!tb.dataset.on||!tb.offsetParent) return; // hidden inside a collapsed file: measuring it would cache 0
  if(tb.querySelector('textarea')) return; // an open editor would lose its text
  const fi=Number(tb.dataset.fi), b=Number(tb.dataset.b), f=state.files[fi];
  if(!f) return;
  state.h.set(f.path+'|'+b,tb.offsetHeight);
  tb.innerHTML=phHtml(tb.offsetHeight);
  delete tb.dataset.on;
}

function insertCard(fi){
  const sec=el('diff');
  if(!sec.querySelector('.file')){ renderDiff(); return; }
  const tmp=document.createElement('div');
  tmp.innerHTML=fileHtml(state.files[fi],fi);
  const node=tmp.firstElementChild;
  let next=null;
  for(let k=fi+1;k<state.files.length&&!next;k++) next=el('f'+k);
  next?sec.insertBefore(node,next):sec.append(node);
  applyFileNote(state.files[fi],fi);
  node.querySelectorAll('tbody.blk').forEach(observeBlock);
  obsPass.observe(node);
}
function removeCard(fi){
  const node=el('f'+fi); if(!node) return;
  unobserveIn(node); node.remove();
  if(!el('diff').querySelector('.file')) renderDiff();
}
/** Manual viewed marks collapse files; automatic marks preserve their height while scrolling. */
export function setViewed(paths: string[],on: boolean,auto?: boolean){
  const list=[].concat(paths).filter(p=>idxOf(p)>=0&&on!==state.viewed.has(p));
  if(!list.length) return [];
  list.forEach(p=>{
    const fi=idxOf(p);
    if(on){
      state.viewed.set(p,{h:state.files[fi].hash,auto:!!auto});
      if(!auto) state.folded.add(p);
    }
    else { state.viewed.delete(p); state.folded.delete(p); }
    if(!auto) state.autoNow.delete(p); // a hand-set mark is no longer the scroll tracker's to undo
    if(state.stale) state.stale.delete(p);
  });
  save();
  if(list.length>20) renderDiff();
  else list.forEach(p=>paintCard(idxOf(p),on));
  renderTree(); updateCount();
  return list;
}
/**
 * Collapsing a card that starts above the fold would yank the page, so absorb the height change.
 * scrollTop is assigned rather than nudged: shrinking the document makes the browser clamp it first,
 * and a relative nudge would then apply the same shrink twice.
 */
function paintCard(fi,on){
  const node=el('f'+fi); if(!node) return;
  const folded=state.folded.has(state.files[fi].path);
  const sec=el('diff');
  const paneTop=sec.getBoundingClientRect().top;
  const r0=node.getBoundingClientRect();
  const inside=r0.top<paneTop&&r0.bottom>paneTop;
  const above=r0.bottom<=paneTop;
  const st0=sec.scrollTop;
  const h0=node.offsetHeight;
  node.classList.toggle('seen',on);
  node.classList.toggle('fold',folded);
  const chev=node.querySelector('[data-fold]');
  if(chev){ chev.innerHTML=folded?SVG.chevR:SVG.chevD; chev.title=folded?'Expand file':'Collapse file'; }
  const btn=node.querySelector('[data-vw]');
  if(btn){
    btn.classList.toggle('on',on);
    btn.innerHTML=(on?SVG.boxOn:SVG.box)+' viewed';
    btn.title=on?'Mark as not reviewed':'Mark reviewed — collapses until the file changes';
  }
  const stale=node.querySelector('.stale');
  if(stale) stale.remove();
  // Reading inside it: its sticky header is already at the top of the pane, so leave the header put.
  if(inside) sec.scrollTop=Math.max(0,st0+(r0.top-paneTop));
  else if(above) sec.scrollTop=Math.max(0,st0+(node.offsetHeight-h0));
}
/** Collapse state of one file card, repainted where it stands. A jump into a collapsed file opens it,
 *  exactly as the chevron does; the viewed mark that folded it is progress and stays. */
export function setFolded(path: string,on: boolean){
  on?state.folded.add(path):state.folded.delete(path);
  save();
  const node=el('f'+idxOf(path)); if(!node) return;
  node.classList.toggle('fold',on);
  const chev=node.querySelector('[data-fold]');
  if(chev){ chev.innerHTML=on?SVG.chevR:SVG.chevD; chev.title=on?'Expand file':'Collapse file'; }
}
/**
 * Bulk toggles rebuild once; single files patch the DOM in place.
 * A file a pattern already covers is tracked as an exception to that pattern rather than
 * as a hide of its own, so dropping the pattern brings it back with everything else.
 */
export function setHidden(paths: string[],hide: boolean){
  const changed=paths.filter(p=>hide!==isHidden(p));
  if(!changed.length) return;
  changed.forEach(p=>{
    if(hide){ state.shown.delete(p); if(!autoHidden(p)) state.hidden.add(p); }
    else { state.hidden.delete(p); if(autoHidden(p)) state.shown.add(p); }
  });
  if(changed.length>20) renderDiff();
  else changed.forEach(p=>{ const fi=idxOf(p); if(fi>=0) hide?removeCard(fi):insertCard(fi); });
  save(); renderTree(); updateCount();
}

/**
 * Controls for the lines a boundary hides. A gap no larger than one step opens in a single click;
 * a longer one is walked from either end, downwards from the hunk above or upwards from the one below.
 */
function expanders(f,fi,idx){
  const g=gapOf(f,idx);
  if(!g) return '';
  const btn=(dir,icon,title)=>'<button class="xp" data-exp="'+dir+'" data-fi="'+fi+'" data-i="'+idx+
    '" title="'+esc(title)+'" aria-label="'+esc(title)+'">'+icon+'</button>';
  const step=expandStep(), size=gapSize(g);
  if(size!=null&&size<=step) return btn('all',SVG.expAll,'Show the '+size+' hidden line'+(size===1?'':'s'));
  const out=[];
  if(g.to!=null) out.push(btn('up',SVG.expUp,'Show '+step+' lines further up'));
  if(idx>0) out.push(btn('down',SVG.expDown,'Show '+step+' lines further down'));
  return out.join('');
}
function rowHtml(f,fi,idx,lang,wr){
  const r=f.rows[idx], id='r'+fi+'-'+idx;
  if(r.t==='hunk') return '<tr id="'+id+'" class="hunk'+(r.tail?' tail':'')+'">'+
    '<td class="exp" colspan="3">'+expanders(f,fi,idx)+'</td><td class="hx">'+esc(r.text)+'</td></tr>';
  const bm=state.bookmarks.has(bmKey(f.path,rowKey(r)));
  return '<tr id="'+id+'" class="r '+r.t+'" data-fi="'+fi+'" data-i="'+idx+'">'+
    '<td class="act"><button class="add" title="Comment on this line">'+SVG.plus+'</button>'+
      '<button class="bm'+(bm?' on':'')+'" data-bm="1" title="'+
        (bm?'Remove this bookmark':'Bookmark this line')+'">'+(bm?SVG.bmOn:SVG.bm)+'</button></td>'+
    '<td class="g go">'+(r.o!=null?r.o:'')+'</td>'+
    '<td class="g gn">'+(r.n!=null?r.n:'')+'</td>'+
    '<td class="c">'+codeHtml(r.text,lang,wr,charMarks(f,fi,idx))+'</td></tr>';
}
/** Character marks live inside the code cell, so a mark change re-renders only that cell. */
export function repaintRow(fi: number,idx: number){
  const tr=el('r'+fi+'-'+idx);
  if(!tr||!tr.classList.contains('r')) return;
  const f=state.files[fi]; if(!f||!f.rows[idx]) return;
  const td=tr.querySelector('td.c'); if(!td) return;
  td.innerHTML=codeHtml(f.rows[idx].text,langOf(f.path),wordDiff(f).get(idx),charMarks(f,fi,idx));
}
