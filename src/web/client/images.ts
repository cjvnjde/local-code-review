import { pathHtml } from './path.ts';
import { el, esc } from './state.ts';

/* ---------- files git prints no lines of: the picture itself ---------- */
/**
 * A binary diff says that the file differs and stops there, which for an image is the one thing the
 * reviewer already knew. So the two sides are fetched and shown, side by side and in the diff's own
 * order — what was there on the left, what replaces it on the right — because an image change is
 * read by looking at both at once rather than by reading either alone.
 *
 * Only what is drawn changes. The file card is the same card, its header carries the same controls,
 * and a whole-file note hangs off it exactly as it does on any other binary file: an image is not a
 * second kind of file, it is a file whose content the page can finally show.
 *
 * A file with a text diff and an image extension — an SVG — gets both: the picture above, so a shape
 * change is visible at a glance, and the source below, where it is actually reviewed.
 */
const IMG=/\.(png|jpe?g|gif|webp|avif|bmp|ico|svg|apng)$/i;
export const isImage=(path: string)=>IMG.test(path);

/** One side of one file, asked for by the name the diff lists it under; the server maps a rename. */
const src=(path: string,side: string)=>'/api/blob?side='+side+'&path='+encodeURIComponent(path);

/**
 * The panes for one file: both sides of a change, one of a file that was only added or only deleted.
 * The old side of a rename says which name it is the old side of, because that is the change.
 */
export function imagesHtml(f: any){
  if(!isImage(f.path)) return '';
  const sides=[];
  if(f.status!=='added'){
    sides.push(paneHtml(f,'old',f.status==='deleted'?'deleted':'before',f.from&&f.from!==f.path?f.from:''));
  }
  if(f.status!=='deleted'){
    sides.push(paneHtml(f,'new',f.status==='added'?'added':'after',''));
  }
  return '<div class="imgw'+(sides.length>1?' two':'')+'">'+sides.join('')+'</div>';
}
function paneHtml(f: any,side: string,label: string,name: string){
  return '<figure class="imgf '+side+'">'+
    '<figcaption><span class="side">'+label+'</span>'+
    (name?pathHtml(name,{className:'was',title:name}):'')+
    '<span class="spacer"></span><span class="dim"></span></figcaption>'+
    // Every file card is drawn, mounted or not, so a diff full of pictures waits for the reader.
    '<div class="imgb"><img alt="'+esc(f.path)+', '+label+'" loading="lazy" decoding="async" src="'+
      esc(src(f.path,side))+'"></div></figure>';
}

/**
 * How big the picture actually is, said once it is known. Neither `load` nor `error` bubbles, so the
 * pane listens for both on the way down; the diff is rebuilt often enough that binding per image
 * would mean binding again on every repaint.
 */
function measured(e: any,failed: boolean){
  const img=e.target;
  if(!img||img.tagName!=='IMG') return;
  const box=img.closest('.imgf'); if(!box) return;
  box.classList.toggle('gone',failed);
  const out=box.querySelector('.dim'); if(!out) return;
  out.textContent=failed?'could not be read':img.naturalWidth+'×'+img.naturalHeight;
}
/** Bound once, from the page's own start-up, so the module itself stays readable without a document. */
export function watchImages(){
  el('diff').addEventListener('load',e=>measured(e,false),true);
  el('diff').addEventListener('error',e=>measured(e,true),true);
}
