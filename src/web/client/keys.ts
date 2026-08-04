/* ---------- editor keys ---------- */
export type EditorAction='save'|'newline'|'cancel'|null;
/** What a keypress in the note editor means. `enterSaves` swaps plain enter and shift+enter, so one of
 *  the two always saves and the other always breaks the line; cmd/ctrl+enter saves either way. */
export function editorAction(e: {key: string,shiftKey?: boolean,metaKey?: boolean,ctrlKey?: boolean},
    enterSaves: boolean): EditorAction{
  if(e.key==='Escape') return 'cancel';
  if(e.key!=='Enter') return null;
  if(e.metaKey||e.ctrlKey) return 'save';
  return !!e.shiftKey!==!!enterSaves?'save':'newline';
}
