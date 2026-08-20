import { idxOf, state } from './state.ts';

/* ---------- the file tree's shape, and the order it puts the files in ---------- */
/**
 * The tree the sidebar draws, cached because every render walks it. Dropped whenever the diff is
 * loaded again, since the files it stands for are new objects then.
 */
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
/** A folder whose only child is a folder is drawn as one row, so `src/web/client` reads as one step. */
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
/** Siblings in the order the tree lists them: folders before files, and each of the two by name. */
export function shownChildren(node: any){
  return [...node.children.values()]
    .sort((a: any,b: any)=>a.dir===b.dir?a.name.localeCompare(b.name):a.dir?-1:1);
}
export function filesUnder(node: any,out?: string[]){
  out=out||[];
  node.children.forEach(c=>c.dir?filesUnder(c,out):out.push(c.path));
  return out;
}
/** Opens only the collapsed folders containing `path`, leaving every other folder as it was. */
export function expandedToFile(collapsed: ReadonlySet<string>,path: string){
  return new Set([...collapsed].filter(dir=>!path.startsWith(dir+'/')));
}
/**
 * Every file's path, in the order the tree shows it. This is the order the whole page reads the diff
 * in, rather than the order git listed the files in: git sorts a path whole, which puts a folder's own
 * files after its subfolders and reads nothing like the tree standing beside the diff.
 */
export function treeOrder(files: any[]){
  const out: string[]=[];
  const walk=(node: any)=>shownChildren(node).forEach((c: any)=>c.dir?walk(c):out.push(c.path));
  walk(buildTree(files));
  return out;
}
/** The files themselves in that order, which is what `state.files` is kept as. */
export function inTreeOrder(files: any[]){
  const at=new Map(treeOrder(files).map((path,i)=>[path,i]));
  return [...files].sort((a,b)=>at.get(a.path)-at.get(b.path));
}
