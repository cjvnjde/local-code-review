/** Measure the header above a note; wrapping paths and controls must not leave a fixed sticky offset. */
export function watchNoteHeaders(){
  const selector='.file>.fh,.gcard>.fh,.rdrg>.gh';
  const resize=new ResizeObserver(entries=>{
    for(const {target} of entries){
      const header=target as HTMLElement;
      header.parentElement?.style.setProperty('--note-top',header.getBoundingClientRect().height+'px');
    }
  });
  const visit=(node:Node,observe:boolean)=>{
    if(!(node instanceof Element)) return;
    const headers=[...(node.matches(selector)?[node]:[]),...node.querySelectorAll(selector)];
    headers.forEach(header=>observe?resize.observe(header):resize.unobserve(header));
  };
  visit(document.body,true);
  new MutationObserver(entries=>entries.forEach(entry=>{
    entry.removedNodes.forEach(node=>visit(node,false));
    entry.addedNodes.forEach(node=>visit(node,true));
  })).observe(document.body,{childList:true,subtree:true});
}
