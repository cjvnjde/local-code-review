import { filteredCount, filteredOut, isHidden, matchesHide } from './filters.ts';
import { cardAt, revealShift } from './follow.ts';
import { SVG, el, esc, idxOf, state } from './state.ts';

/* ---------- file tree ---------- */
export function dirTree(){
  if(!state.tree) state.tree=buildTree(state.files);
  return state.tree;
}
export function buildTree(files: any[]){
  const root={dir:true,name:'',path:'',children:new Map()};
  files.forEach(f=>{
    const parts=f.path.split('/');
    let node=root;
    parts.forEach((p,pi)=>{
      if(pi===parts.length-1){ node.children.set(p,{dir:false,name:p,path:f.path,file:f,idx:idxOf(f.path)}); return; }
      if(!node.children.has(p)) node.children.set(p,{dir:true,name:p,path:(node.path?node.path+'/':'')+p,children:new Map()});
      node=node.children.get(p);
    });
  });
  squash(root);
  return root;
}
function squash(node: any){
  node.children.forEach(c=>{
    if(!c.dir) return;
    while(c.children.size===1){
      const only=[...c.children.values()][0];
      if(!only.dir) break;
      c.name=c.name+'/'+only.name; c.path=only.path; c.children=only.children;
    }
    squash(c);
  });
}
export function filesUnder(node: any,out?: string[]){
  out=out||[];
  node.children.forEach(c=>c.dir?filesUnder(c,out):out.push(c.path));
  return out;
}
export function noteCount(p: string){ let n=0; state.notes.forEach(v=>{ if(v.file===p) n++; }); return n; }

export function renderTree(){
  const root=state.filter?buildTree(state.files.filter(f=>f.path.toLowerCase().includes(state.filter))):dirTree();
  const html=[];
  const walk=(node,depth)=>{
    [...node.children.values()]
      .sort((a,b)=>a.dir===b.dir?a.name.localeCompare(b.name):a.dir?-1:1)
      .forEach(c=>{
        const pad=10+depth*15;
        if(c.dir){
          const open=state.filter||!state.collapsed.has(c.path);
          const kids=filesUnder(c);
          const allHidden=kids.length>0&&kids.every(p=>isHidden(p));
          const notes=kids.reduce((s,p)=>s+noteCount(p),0);
          const seen=kids.filter(p=>state.viewed.has(p)).length;
          const allSeen=kids.length>0&&seen===kids.length;
          html.push('<div class="tw dir'+(allHidden?' hid':'')+(allSeen?' seen':'')+'" data-dir="'+esc(c.path)+'" style="padding-left:'+pad+'px">'+
            '<span class="chev">'+(open?SVG.chevD:SVG.chevR)+'</span>'+
            '<span class="nm">'+esc(c.name)+'</span>'+
            (notes?'<span class="ct">'+notes+'</span>':'')+
            '<button class="vd'+(allSeen?' on':seen?' part':'')+'" data-vd="'+esc(c.path)+'" title="'+
              (allSeen?'Mark these '+kids.length+' files not viewed':'Mark all '+kids.length+' files viewed')+
              (seen&&!allSeen?' ('+seen+'/'+kids.length+' viewed)':'')+'">'+(allSeen?SVG.boxOn:SVG.box)+'</button>'+
            '<button class="eye'+(allHidden?' on':'')+'" data-hd="'+esc(c.path)+'" title="'+
              (allHidden?'Show these files in the diff':'Hide these files from the diff')+'">'+
              (allHidden?SVG.eyeOff:SVG.eye)+'</button></div>');
          if(open) walk(c,depth+1);
        }else{
          const f=c.file, flt=filteredOut(c.path), hid=state.hidden.has(c.path)||flt;
          const why=flt?(matchesHide(c.path)?' — hidden by a filter pattern':' — hidden as a deleted file'):'';
          const notes=noteCount(c.path), seen=state.viewed.has(c.path);
          html.push('<div class="tw file'+(hid?' hid':'')+(flt?' flt':'')+(seen?' seen':'')+'" data-file="'+esc(c.path)+'" data-idx="'+c.idx+'" '+
            'title="'+esc(c.path)+' (+'+f.added+' -'+f.removed+')'+why+'" style="padding-left:'+pad+'px">'+
            '<span class="st '+f.status+'">'+f.status[0].toUpperCase()+'</span>'+
            '<span class="nm">'+esc(c.name)+'</span>'+
            (notes?'<span class="ct">'+notes+'</span>':'')+
            '<button class="vf'+(seen?' on':'')+'" data-vf="'+esc(c.path)+'" title="'+
              (seen?'Mark not viewed':'Mark viewed')+'">'+(seen?SVG.boxOn:SVG.box)+'</button>'+
            '<button class="eye'+(hid?' on':'')+'" data-hf="'+esc(c.path)+'" title="'+
              (hid?(flt?'Show in diff despite the filter':'Show in diff'):'Hide from diff')+'">'+
              (hid?SVG.eyeOff:SVG.eye)+'</button></div>');
        }
      });
  };
  walk(root,0);
  el('tree').innerHTML=html.join('')||'<div class="empty">No files match.</div>';
  paintFilterStatus();
  followDiff(); // the rows were rebuilt, so the highlight has to be put back on the current file
}

/* ---------- the tree follows the diff: the file under the top of the pane stays highlighted ---------- */
/** The row standing for a path: its own, or the deepest folder shown when the file is folded away. */
function activeRow(){
  const path=state.active;
  if(!path) return null;
  const rows=el('tree').children;
  let dir=null, len=-1;
  for(let i=0;i<rows.length;i++){
    const row=rows[i], file=row.dataset.file;
    if(file!=null){ if(file===path) return row; continue; }
    const d=row.dataset.dir;
    if(d!=null&&d.length>len&&path.startsWith(d+'/')){ dir=row; len=d.length; }
  }
  return dir;
}
function reveal(row: any){
  const pane=el('tree');
  const p=pane.getBoundingClientRect(), r=row.getBoundingClientRect();
  pane.scrollTop+=revealShift(p.top,p.bottom,r.top,r.bottom);
}
/**
 * Puts the highlight on `state.active`. Rendering the tree drops it, so every render calls this.
 * The tree is only scrolled when the row it points at changes, or expanding a folder would drag the
 * pane back to the file being read every time.
 */
let shown='';
export function paintActive(){
  const was=el('tree').querySelector('.tw.sel');
  if(was&&was.dataset.file===state.active) return; // already on it, and the common case while scrolling
  const row=activeRow();
  if(was!==row){
    if(was) was.classList.remove('sel');
    if(row) row.classList.add('sel');
  }
  const at=row?row.dataset.file||row.dataset.dir:'';
  if(row&&at!==shown) reveal(row);
  shown=at;
}
/** Brings the highlighted row back into view without moving it, for a pane that was just reopened. */
export function revealActive(){
  const row=activeRow();
  if(row) reveal(row);
}
/** Reads which file the diff pane is showing and marks it in the tree. */
export function followDiff(){
  const cards=el('diff').children;
  const at=cardAt(cards.length,i=>cards[i].getBoundingClientRect().top,el('diff').getBoundingClientRect().top+1);
  // A pane showing a placeholder instead of cards has no file to point at, so the last one stands.
  if(at>=0&&cards[at].dataset.path) state.active=cards[at].dataset.path;
  paintActive();
}
/** One reading per frame: scrolling fires far more often than the tree can usefully change. */
let queued=false;
el('diff').addEventListener('scroll',()=>{
  if(queued) return;
  queued=true;
  requestAnimationFrame(()=>{ queued=false; followDiff(); });
},{passive:true});

/** The pattern list lives in settings, so the tree carries the reminder that it is doing something. */
function paintFilterStatus(){
  const box=el('fstat'); if(!box) return;
  const n=filteredCount();
  box.hidden=!n;
  box.textContent=n+(n===1?' file':' files')+' hidden by filter';
}
