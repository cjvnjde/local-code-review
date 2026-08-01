import { idxOf } from './load.ts';
import { SVG, el, esc, state } from './state.ts';

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
        const pad=8+depth*13;
        if(c.dir){
          const open=state.filter||!state.collapsed.has(c.path);
          const kids=filesUnder(c);
          const allHidden=kids.length>0&&kids.every(p=>state.hidden.has(p));
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
          const f=c.file, hid=state.hidden.has(c.path), notes=noteCount(c.path), seen=state.viewed.has(c.path);
          html.push('<div class="tw file'+(hid?' hid':'')+(seen?' seen':'')+'" data-file="'+esc(c.path)+'" data-idx="'+c.idx+'" '+
            'title="'+esc(c.path)+' (+'+f.added+' -'+f.removed+')" style="padding-left:'+pad+'px">'+
            '<span class="st '+f.status+'">'+f.status[0].toUpperCase()+'</span>'+
            '<span class="nm">'+esc(c.name)+'</span>'+
            (notes?'<span class="ct">'+notes+'</span>':'')+
            '<button class="vf'+(seen?' on':'')+'" data-vf="'+esc(c.path)+'" title="'+
              (seen?'Mark not viewed':'Mark viewed')+'">'+(seen?SVG.boxOn:SVG.box)+'</button>'+
            '<button class="eye'+(hid?' on':'')+'" data-hf="'+esc(c.path)+'" title="'+
              (hid?'Show in diff':'Hide from diff')+'">'+(hid?SVG.eyeOff:SVG.eye)+'</button></div>');
        }
      });
  };
  walk(root,0);
  el('tree').innerHTML=html.join('')||'<div class="empty">No files match.</div>';
}
