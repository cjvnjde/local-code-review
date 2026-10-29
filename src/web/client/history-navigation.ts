/** One browser entry for the history overlay. Changes inside it replace that entry so Back closes it. */
export type HistoryView={note: string,selected: string,mode: 'changes'|'snapshot',query: string,
  source: string,scope: string,limit: number};
const KEY='lcrHistory';
type Navigation=Pick<History,'state'|'pushState'|'replaceState'|'back'>;

export function historyView(state: any): HistoryView|null{
  const v=state?.[KEY];
  if(!v||typeof v.note!=='string'||typeof v.selected!=='string'||
    !['changes','snapshot'].includes(v.mode)||typeof v.query!=='string'||
    !['','page','file'].includes(v.source)||!['current','repo'].includes(v.scope)||
    !Number.isInteger(v.limit)||v.limit<1) return null;
  return v;
}

export function historyNavigation(nav: Navigation,show: (view: HistoryView|null)=>void){
  let closing=false;
  const state=(view: HistoryView)=>({...nav.state,[KEY]:view});
  return {
    open(view: HistoryView){
      closing=false;
      if(historyView(nav.state)) nav.replaceState(state(view),'');
      else nav.pushState(state(view),'');
      show(view);
    },
    update(view: HistoryView){
      if(!closing&&historyView(nav.state)) nav.replaceState(state(view),'');
    },
    close(){
      if(closing) return;
      if(historyView(nav.state)){ closing=true; nav.back(); }
      else show(null);
    },
    restore(){ closing=false; show(historyView(nav.state)); },
  };
}
