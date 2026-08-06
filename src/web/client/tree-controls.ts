import { setHidden, setViewed } from './diff-view.ts';
import { isHidden } from './filters.ts';
import { save } from './persistence.ts';
import { el, idxOf, state } from './state.ts';
import { dirTree, filesUnder, paintActive, renderTree } from './tree.ts';

/* ---------- tree interactions ---------- */
function toggle(set,key){ set.has(key)?set.delete(key):set.add(key); }
el('tree').addEventListener('click',e=>{
  const vd=e.target.closest('[data-vd]');
  if(vd){
    const node=findDir(dirTree(),vd.dataset.vd);
    const kids=node?filesUnder(node):[];
    setViewed(kids,!(kids.length>0&&kids.every(p=>state.viewed.has(p))));
    return;
  }
  const vf=e.target.closest('[data-vf]');
  if(vf){ setViewed([vf.dataset.vf],!state.viewed.has(vf.dataset.vf)); return; }
  const hd=e.target.closest('[data-hd]');
  if(hd){
    const node=findDir(dirTree(),hd.dataset.hd);
    const kids=node?filesUnder(node):[];
    setHidden(kids,!(kids.length>0&&kids.every(p=>isHidden(p))));
    return;
  }
  const hf=e.target.closest('[data-hf]');
  if(hf){ setHidden([hf.dataset.hf],!isHidden(hf.dataset.hf)); return; }
  const dir=e.target.closest('[data-dir]');
  if(dir){ toggle(state.collapsed,dir.dataset.dir); save(); renderTree(); return; }
  const file=e.target.closest('[data-file]');
  if(file){
    const p=file.dataset.file;
    if(isHidden(p)) setHidden([p],false);
    const target=el('f'+file.dataset.idx);
    if(target){
      state.jumpUntil=performance.now()+500; // a jump is not "scrolling past" anything
      target.scrollIntoView({block:'start'});
    }
    // A jump that lands where the pane already was fires no scroll, so claim the row here.
    state.active=p; paintActive();
  }
});
function findDir(node,p){
  let found=null;
  const walk=n=>n.children.forEach(c=>{ if(!c.dir) return; if(c.path===p) found=c; else walk(c); });
  walk(node);
  return found;
}
document.querySelector('.navbtns').addEventListener('click',e=>{
  const b=e.target.closest('[data-all]'); if(!b) return;
  if(b.dataset.all==='collapse'){
    const all=[];
    const walk=n=>n.children.forEach(c=>{ if(c.dir){ all.push(c.path); walk(c); } });
    walk(dirTree());
    state.collapsed=new Set(all); save(); renderTree(); return;
  }
  if(b.dataset.all==='expand'){ state.collapsed=new Set(); save(); renderTree(); return; }
  setHidden(state.files.map(f=>f.path),b.dataset.all==='hide');
});
el('filter').oninput=e=>{ state.filter=e.target.value.trim().toLowerCase(); renderTree(); };
