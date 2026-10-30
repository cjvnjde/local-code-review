import { imageRegion, regionRect } from '../../image-region.ts';
import { upload } from './attach.ts';
import { refToken } from './note-ref.ts';
import { el, idxOf, state } from './state.ts';

let jumpToNote=(id: string)=>{};
type Actions={busy: ()=>boolean;open: (fi: number,region: any,stage: any,rect: any,capture: ()=>Promise<string>)=>void;
  jump: (id: string)=>void};

/** Rectangles are percentages of the image itself, never of the checkerboard around it. */
function position(node: any,r: any){
  Object.assign(node.style,{left:r.x/r.imageWidth*100+'%',top:r.y/r.imageHeight*100+'%',
    width:r.width/r.imageWidth*100+'%',height:r.height/r.imageHeight*100+'%'});
}
export function paintImageNotes(){
  el('diff').querySelectorAll('.imgstage').forEach((stage: any)=>{
    const host=stage.querySelector('.imgmarks'), img=stage.querySelector('img');
    host.replaceChildren();
    const path=stage.closest('.file').dataset.path, fi=idxOf(path), f=state.files[fi];
    if(!f||!img.naturalWidth) return;
    state.notes.forEach((n: any)=>{
      const r=imageRegion(n.image);
      if(n.file!==path||!r||r.side!==stage.dataset.side||r.source!==f.hash||
        r.imageWidth!==img.naturalWidth||r.imageHeight!==img.naturalHeight) return;
      const rect=document.createElement('div'); rect.className='imgregion'; position(rect,r);
      const button=document.createElement('button'); button.type='button'; button.textContent=refToken(n);
      button.title='Read this screenshot comment';
      button.onclick=()=>jumpToNote(n.id);
      rect.append(button); host.append(rect);
    });
  });
}

/** Canvas reads only the same-origin image already on screen. Uploads use the existing immutable store. */
async function capture(img: any,r: any){
  const canvas=document.createElement('canvas');
  // Bound the generated bitmap for exceptionally large selections, while retaining source coordinates.
  const scale=Math.min(1,2048/Math.max(r.width,r.height),Math.sqrt(2_000_000/(r.width*r.height)));
  canvas.width=Math.max(1,Math.round(r.width*scale)); canvas.height=Math.max(1,Math.round(r.height*scale));
  const context=canvas.getContext('2d');
  if(!context) throw new Error('Image capture is unavailable in this browser.');
  context.drawImage(img,r.x,r.y,r.width,r.height,0,0,canvas.width,canvas.height);
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(
    value=>value?resolve(value):reject(new Error('Could not capture this image.')),'image/png'));
  return upload(blob);
}

/** One pointer gesture, with cancellation and Alt left to the browser just like code selection. */
export function watchImageComments(actions: Actions){
  jumpToNote=actions.jump;
  const pane=el('diff');
  let press: any=null;
  const cancel=()=>{ if(!press) return; press.rect.remove(); press=null; };
  const begin=(stage: any,a: any,pointerId?: number)=>{
    if(actions.busy()) return;
    const img=stage.querySelector('img');
    if(!img.complete||!img.naturalWidth) return;
    const fi=idxOf(stage.closest('.file').dataset.path), f=state.files[fi];
    if(!f) return;
    const rect=document.createElement('div'); rect.className='imgregion picking'; stage.append(rect);
    press={stage,img,fi,source:f.hash,a,rect,pointerId};
    return press;
  };
  const point=(p: any,e: any)=>{
    const box=p.img.getBoundingClientRect();
    return {x:e.clientX-box.left,y:e.clientY-box.top};
  };
  const region=(p: any,b: any)=>{
    const box=p.img.getBoundingClientRect();
    return {...regionRect(p.a,b,box,{width:p.img.naturalWidth,height:p.img.naturalHeight}),
      side:p.stage.dataset.side,imageWidth:p.img.naturalWidth,imageHeight:p.img.naturalHeight,source:p.source};
  };
  const finish=(p: any,b: any)=>{
    const r=region(p,b);
    position(p.rect,r);
    press=null;
    actions.open(p.fi,r,p.stage,p.rect,()=>capture(p.img,r));
  };
  pane.addEventListener('pointerdown',(e: any)=>{
    if(e.button!==0||e.altKey||e.target.closest('button,.nbox')) return;
    const stage=e.target.closest('.imgstage'); if(!stage) return;
    cancel();
    const img=stage.querySelector('img'), box=img.getBoundingClientRect();
    const p=begin(stage,{x:e.clientX-box.left,y:e.clientY-box.top},e.pointerId); if(!p) return;
    e.preventDefault(); stage.setPointerCapture(e.pointerId);
    position(p.rect,region(p,p.a));
  });
  pane.addEventListener('pointermove',(e: any)=>{
    if(!press||e.pointerId!==press.pointerId) return;
    if(e.altKey){ cancel(); return; }
    position(press.rect,region(press,point(press,e)));
  });
  pane.addEventListener('pointerup',(e: any)=>{
    if(!press||e.pointerId!==press.pointerId) return;
    const p=press;
    if(e.altKey||!p.stage.isConnected){ cancel(); return; }
    finish(p,point(p,e));
  });
  pane.addEventListener('pointercancel',cancel);
  pane.addEventListener('lostpointercapture',()=>{ if(press) cancel(); });
  document.addEventListener('keydown',e=>{ if(e.key==='Escape') cancel(); });
  pane.addEventListener('click',(e: any)=>{
    const button=e.target.closest('.imgcomment'); if(!button) return;
    const stage=button.closest('.imgf').querySelector('.imgstage');
    const img=stage.querySelector('img'), box=img.getBoundingClientRect(), bounds=pane.getBoundingClientRect();
    const a={x:box.width/2,y:Math.max(0,Math.min(box.height/2,bounds.bottom-box.top-48))};
    const p=begin(stage,a); if(p) finish(p,a);
  });
  pane.addEventListener('load',(e: any)=>{ if(e.target.closest?.('.imgstage')) paintImageNotes(); },true);
  pane.addEventListener('dragstart',(e: any)=>{ if(!e.altKey&&e.target.closest('.imgstage')) e.preventDefault(); });
}
