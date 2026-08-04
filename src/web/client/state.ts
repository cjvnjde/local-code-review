export const SVG={
  chevD:'<svg class="i" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 6h9l-4.5 5z"/></svg>',
  chevR:'<svg class="i" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5l5 4.5-5 4.5z"/></svg>',
  eye:'<svg class="i" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3C4.6 3 1.8 5.5 1 8c.8 2.5 3.6 5 7 5s6.2-2.5 7-5c-.8-2.5-3.6-5-7-5Zm0 8.2A3.2 3.2 0 1 1 8 4.8a3.2 3.2 0 0 1 0 6.4Zm0-1.6a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2Z"/></svg>',
  eyeOff:'<svg class="i" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3C4.6 3 1.8 5.5 1 8c.8 2.5 3.6 5 7 5s6.2-2.5 7-5c-.8-2.5-3.6-5-7-5Zm0 8.2A3.2 3.2 0 1 1 8 4.8a3.2 3.2 0 0 1 0 6.4Z"/><path d="M2.4 1.1 14.9 13.6l-1.3 1.3L1.1 2.4z"/></svg>',
  plus:'<svg class="i" viewBox="0 0 16 16" aria-hidden="true"><path d="M7.25 3h1.5v4.25H13v1.5H8.75V13h-1.5V8.75H3v-1.5h4.25z"/></svg>',
  box:'<svg class="i" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.2 2.2h11.6v11.6H2.2z" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  boxOn:'<svg class="i" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.2 2.2h11.6v11.6H2.2z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M4.6 8.1l2.3 2.3 4.5-4.7" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  check:'<svg class="i" viewBox="0 0 16 16" aria-hidden="true"><path d="M6.1 12.4 2 8.3l1.3-1.3 2.8 2.8 6.6-6.6L14 4.5z"/></svg>',
  sliders:'<svg class="i" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3.6h4.4V5H2zM9.6 3.6H14V5H9.6zM2 11h4.4v1.4H2zM9.6 11H14v1.4H9.6z"/><path d="M6.6 1.8h1.5v5.1H6.6zM9.1 9.2h1.5v5.1H9.1z"/></svg>',
};

export const state: any={
  files:[], range:'', notes:new Map(), status:new Map(), statusByKey:new Map(),
  hidden:new Set(), shown:new Set(), collapsed:new Set(), folded:new Set(), viewed:new Map(),
  filter:'', hideRx:[], sel:null,
  byPath:new Map(), h:new Map(), draftRow:null,
  cfg:{auto:true,back:true,limit:900,toast:true,hide:'',hideDeleted:false,enterSaves:false},
  scrolled:false, jumpUntil:0, autoNow:new Set(), lastUndo:0,
};
export const el=(id: string): any=>document.getElementById(id);
export const esc=(value: unknown)=>String(value).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
export const idxOf=(path: string)=>state.byPath.has(path)?state.byPath.get(path):-1;
export const rowKey=(row: any)=>row.n!=null?'n'+row.n:'o'+row.o;
/** Anchor of a note on the file itself. Row keys are always `n<line>`/`o<line>`, so it cannot collide. */
export const FILE_ANCHOR='*';
export const isFileNote=(n: any)=>!!n&&n.a===FILE_ANCHOR;
/** Character offsets belong in the id: a note on part of a line is not the note on the whole line. */
export const noteId=(path: string,a: string,b: string,ca?: number|null,cb?: number|null)=>
  path+'|'+a+'|'+b+(ca!=null?'|'+ca+'-'+cb:'');
/** One file-level note per file, so its id is fixed by the path alone. */
export const fileNoteId=(path: string)=>noteId(path,FILE_ANCHOR,FILE_ANCHOR);
export const clip=(text: string,max=48)=>text.length>max?text.slice(0,max-1)+'…':text;
/** The chord that saves a note under the current setting, phrased for the on-screen hints. */
export const saveKeyHint=()=>state.cfg.enterSaves?'enter':'shift+enter';
/** Heading text a review file uses for a note, and the fallback key when its id marker was lost. */
export const noteKey=(n: any)=>isFileNote(n)
  ?n.file+' (whole file)'
  :n.file+':'+(n.label||(n.start===n.end?String(n.start):n.start+'-'+n.end));
/** What an agent reported back about a note, or null while it is still unprocessed. */
export const statusOf=(n: any)=>state.status.get(n.id)||state.statusByKey.get(noteKey(n))||null;
export const appliedNotes=()=>[...state.notes.values()].filter((n: any)=>{
  const s=statusOf(n);
  return !!s&&s.status==='applied';
});
