import { isImage } from './images.ts';
import { SVG, esc } from './state.ts';

/* ---------- pictures the reviewer puts into a note ---------- */
/**
 * "Look at this" is a whole review note, and the thing being looked at is usually already in the
 * clipboard: a screenshot of the control that overlaps, the render that is wrong, the console the
 * agent should have seen. So a note takes a picture the way it takes prose — paste it in, drop it on
 * the editor, or pick it from disk — and what lands in the text is an ordinary Markdown image.
 *
 * The picture goes to the server the moment it arrives, before there is a note to hang it on, and
 * what comes back is a name. Everything after that is the note's own prose: the link travels into the
 * review file verbatim, where it resolves beside the file like any relative link in a Markdown
 * document, so the agent reading the note opens the same picture the page draws.
 *
 * Which is the point. A note that says "this looks wrong" beside a screenshot says far more to
 * whatever reads it next than the same note with the screenshot in a chat message somewhere else.
 */

/** Where the pictures live, as a note points at them. The server owns the directory itself. */
const DIR = 'images/';
/** One name in that directory: no separator, no traversal, nothing that could mean another place. */
const NAME=/^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * The address one of these is drawn from, or empty when the link is an ordinary one. It is what tells
 * an attached picture from a picture on the internet: the first is the review's own file, served over
 * loopback, and the second is a page this one does not fetch from.
 */
export function attachSrc(url: string){
  const raw=String(url||'').replace(/^<|>$/g,'').trim();
  if(raw.slice(0,DIR.length).toLowerCase()!==DIR) return '';
  const name=raw.slice(DIR.length);
  return NAME.test(name)&&isImage(name)?'/api/attachment?name='+encodeURIComponent(name):'';
}

/** Types the clipboard and the desktop hand over that the server will keep. */
const KEEP=/^image\/(png|jpeg|gif|webp|avif|bmp|svg\+xml|apng)$/i;
const kept=(file: any)=>!!file&&KEEP.test(String(file.type||''));
/** Whether a drag is carrying files at all; mid-drag the browser will not say what is in them. */
const hasFiles=(data: any)=>!!data&&[...(data.types||[])].includes('Files');

/**
 * The pictures a paste or a drop is carrying. `items` is what a clipboard screenshot arrives as and
 * `files` is what the desktop hands over; anything that is not a picture lcr keeps is left out, so a
 * paste of ordinary text is ordinary text and reaches the box untouched.
 */
export function filesFrom(data: any){
  const out: any[]=[];
  const items=data&&data.items?[...data.items]:[];
  items.forEach((item: any)=>{
    if(item.kind!=='file') return;
    const file=item.getAsFile&&item.getAsFile();
    if(kept(file)) out.push(file);
  });
  if(out.length) return out;
  const files=data&&data.files?[...data.files]:[];
  files.forEach((file: any)=>{ if(kept(file)) out.push(file); });
  return out;
}

/** Markdown link text is bracketed, so a name holding a bracket needs it kept out of the syntax. */
const escLabel=(text: string)=>text.replace(/[\\[\]]/g,'\\$&');
/**
 * What the picture is called in the note. The alt text is the only thing about it that is words, and
 * it is what the agent reads before deciding whether to open the file at all, so a name worth keeping
 * is kept: a clipboard screenshot has none and is called what it is.
 */
export function labelFor(name: string){
  const bare=String(name||'').split(/[\\/]/).pop()!.replace(/\.[^.]+$/,'').trim();
  return !bare||/^image$/i.test(bare)?'screenshot':escLabel(bare.slice(0,80));
}
/** How a note points at a picture: the ordinary Markdown image, which is all that is written down. */
export const shotToken=(label: string,ref: string)=>'!['+label+']('+ref+')';

/**
 * A picture written into the note at the caret, on a line of its own and one blank line clear of the
 * prose around it: it is read as a paragraph rather than as a word in one. Pure, because where text
 * lands is the part worth being sure of and the box it lands in is the editor's business.
 */
export function insertShot(text: string,from: number,to: number,token: string){
  const value=String(text||'');
  const cut=Math.max(0,Math.min(from,value.length));
  const end=Math.max(cut,Math.min(to,value.length));
  const head=value.slice(0,cut).replace(/\s+$/,''), tail=value.slice(end).replace(/^\s+/,'');
  const lead=head?head+'\n\n':'';
  return {value:lead+token+(tail?'\n\n'+tail:''),caret:lead.length+token.length};
}

/** The button an editor offers. Pasting and dropping need no button; being told they work does. */
export const attachButton=()=>'<button class="attb" type="button" '+
  'title="Attach a picture — or paste one, or drop one on this note">'+SVG.pic+' image</button>';

/** What stands in the note while a picture is on its way to disk; no note ever keeps one. */
const WAITING='#lcr-attaching-';
let waits=0;

/**
 * Hands one picture to the server and answers the link a note points at it with. The name comes back
 * rather than being made here: it is the hash of the bytes, so the server is the only side that can
 * say what a picture is called.
 */
async function upload(file: any){
  const response=await fetch('/api/attach',
    {method:'POST',headers:{'content-type':file.type},body:file});
  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data.error||'the server answered '+response.status);
  if(!data.ref) throw new Error('nothing was kept');
  return String(data.ref);
}

/** Grows the box for text put into it by hand; typing fires this, assigning `.value` does not. */
const grow=(ta: any)=>ta.dispatchEvent(new Event('input'));

/**
 * The placeholder swapped for the link it was standing in for; null once the reader has taken it back
 * out, which is how a picture is called off — the note is what a picture is for, so with nothing in
 * the note to point at it there is nothing to write. A picture that never arrived takes the blank line
 * it was given with it, leaving the note exactly as it was found.
 */
export function swapShot(text: string,mark: string,token: string){
  const value=String(text||''), at=value.indexOf(mark);
  if(at<0) return null;
  const head=value.slice(0,at), tail=value.slice(at+mark.length);
  if(token) return {value:head+token+tail,caret:at+token.length};
  const kept=head.replace(/\s+$/,''), rest=tail.replace(/^\s+/,'');
  return {value:kept+(kept&&rest?'\n\n':'')+rest,caret:kept.length};
}

/**
 * Takes pictures into the box, one after another. A placeholder goes in first and is swapped for the
 * link when the picture is on disk: the reviewer carries on writing while it travels, and the swap is
 * found by the text of the placeholder rather than by where it was put, because by then the caret has
 * moved on.
 */
async function take(ta: any,files: any[]){
  for(const file of files){
    const mark=shotToken('…attaching',WAITING+(++waits));
    const written=insertShot(ta.value,
      ta.selectionStart==null?ta.value.length:ta.selectionStart,
      ta.selectionEnd==null?ta.value.length:ta.selectionEnd,mark);
    ta.value=written.value;
    ta.setSelectionRange(written.caret,written.caret);
    grow(ta);
    let token='';
    try{
      token=shotToken(labelFor(file.name),await upload(file));
    }catch(error){
      alert('Could not attach that picture: '+(error instanceof Error?error.message:String(error)));
    }
    if(!ta.isConnected) return; // the note was saved or dropped while the picture was in flight
    const swapped=swapShot(ta.value,mark,token);
    if(!swapped) continue;
    ta.value=swapped.value;
    ta.setSelectionRange(swapped.caret,swapped.caret);
    grow(ta);
  }
}

/** The file picker, for a screenshot that went to disk rather than to the clipboard. */
function pick(ta: any){
  const input: any=document.createElement('input');
  input.type='file'; input.accept='image/*'; input.multiple=true; input.hidden=true;
  document.body.append(input);
  input.oncancel=()=>input.remove();
  input.onchange=()=>{
    const files=[...(input.files||[])].filter(kept);
    input.remove();
    ta.focus();
    if(files.length) void take(ta,files);
  };
  input.click();
}

/**
 * Wires an editor for pictures: the button, a paste that is carrying one, and a drop anywhere on the
 * box. The whole editor is the drop target rather than the text in it, because a picture dragged at a
 * note is aimed at the note.
 *
 * The text box is new every time an editor is drawn, so the paste belongs to it. The box around it is
 * not: a note edited twice is one box and two text areas, and a reply box stands *inside* the note
 * box it answers. So the drop is bound once per box and reads the document for whichever editor is
 * open in it now, and an event already taken by an inner box is left alone rather than acted on twice
 * on the way up.
 *
 * A drop carrying files is always taken, even one carrying something that is not a picture, because
 * the alternative is the browser opening the file in this tab and taking the review off the screen. A
 * drag of text is left alone, so dragging a word inside the box still moves the word.
 */
export function wireAttach(box: any,ta: any){
  const button=box.querySelector('.attb');
  if(button) button.onclick=()=>pick(ta);
  ta.addEventListener('paste',(e: any)=>{
    const files=filesFrom(e.clipboardData);
    if(!files.length) return;
    e.preventDefault();
    void take(ta,files);
  });
  if(box.__shots) return;
  box.__shots=true;
  /** The editor standing open in this box: its own, or a reply's, whichever is there. */
  const into=()=>box.querySelector('textarea');
  const over=(e: any)=>{
    if(e.defaultPrevented||!hasFiles(e.dataTransfer)) return;
    // Taken whether or not an editor is open, because a drop only reaches a target that took the drag
    // over it — and what the browser does with a file nobody took is open it in this tab, which takes
    // the review off the screen. Only a box with somewhere to put the picture marks itself for it.
    e.preventDefault();
    e.dataTransfer.dropEffect='copy';
    if(into()) box.classList.add('dropping');
  };
  box.addEventListener('dragenter',over);
  box.addEventListener('dragover',over);
  box.addEventListener('dragleave',(e: any)=>{
    if(!box.contains(e.relatedTarget)) box.classList.remove('dropping');
  });
  box.addEventListener('drop',(e: any)=>{
    box.classList.remove('dropping');
    if(e.defaultPrevented||!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    const open=into();
    if(!open){ alert('Open the note, or a reply to it, and drop the picture in there.'); return; }
    const files=filesFrom(e.dataTransfer);
    open.focus();
    if(files.length) void take(open,files);
    else alert('That file is not a picture lcr can attach.');
  });
}

/** The same link, as the parser reads it back. */
const SHOT=/!\[((?:[^[\]\\]|\\.)*)\]\([ \t]*<?([^\s)]*)>?[ \t]*\)/g;
/**
 * A body with its pictures read as the words they carry, for the places that show one line of a note
 * as text: a summary has no room for a picture, and what it was called is what the note was saying
 * about it. A picture with nothing written over it is named for what it is.
 */
export const plainShots=(text: string)=>String(text||'').replace(SHOT,(whole,label,url)=>
  attachSrc(url)?(String(label).replace(/\\(.)/g,'$1').trim()||'image'):whole);

/** One attached picture, drawn where the note points at it and opened whole in a tab of its own. */
export function shotHtml(src: string,label: string){
  const alt=String(label||'').replace(/\\(.)/g,'$1').trim()||'attached image';
  return '<a class="shot" href="'+esc(src)+'" target="_blank" rel="noreferrer noopener" title="'+
    esc(alt)+'"><img src="'+esc(src)+'" alt="'+esc(alt)+'" loading="lazy" decoding="async"></a>';
}
