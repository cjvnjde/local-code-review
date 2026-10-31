import type { WebCapture } from '../../web-review-model.ts';
import { ANNOTATION_LIMITS as LIMITS, webAnnotation, type AnnotationMark, type AnnotationPoint, type WebAnnotation } from '../../web-annotation.ts';
import { attachSrc, upload } from './attach.ts';
import { SVG } from './state.ts';

type Tool = AnnotationMark['tool'] | 'select';
type Bounds = {x:number;y:number;width:number;height:number};
type Gesture = {id:number;start:AnnotationPoint;mark:AnnotationMark;index:number;move:boolean;points:number};
const PALETTE = ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#a855f7','#111111','#ffffff'];
let active: Promise<void> | null = null;

/** Opens over the existing note: its textarea, selection and draft DOM are never replaced. */
export async function openAnnotation(capture: WebCapture, apply: (annotation: WebAnnotation|null)=>Promise<void>): Promise<void> {
  if(active){ document.querySelector<HTMLDialogElement>('[data-annotation-editor]')?.focus(); return active; }
  active = editAnnotation(capture,apply);
  try { await active; } finally { active=null; }
}

function editAnnotation(capture: WebCapture, apply: (annotation: WebAnnotation|null)=>Promise<void>): Promise<void> {
    const { promise, resolve } = Promise.withResolvers<void>();
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const caret = previous instanceof HTMLTextAreaElement || previous instanceof HTMLInputElement ?
      {start:previous.selectionStart,end:previous.selectionEnd,direction:previous.selectionDirection} : null;
    const saved = capture.annotation;
    let marks: AnnotationMark[] = saved ? structuredClone(saved.marks) : [];
    const initial = JSON.stringify(marks);
    const undo: AnnotationMark[][] = [], redo: AnnotationMark[][] = [];
    // Reopened vector marks remain undoable, rather than becoming baked-in screenshot pixels.
    for(let i=Math.max(0,marks.length-100);i<marks.length;i++)undo.push(marks.slice(0,i));
    let selected=-1, tool:Tool='pen', color=PALETTE[0]!, stroke=3, radius=8, size=20;
    let image:HTMLImageElement|null=null, width=0, height=0, padding=0, zoom=1, fitted=true;
    let loading=true, saving=false, closed=false, gesture:Gesture|null=null, paintFrame=0;
    let pendingText:AnnotationPoint|null=null;
    let lastState='', sourceScale=1;
    const dialog=document.createElement('dialog');
    dialog.dataset.annotationEditor='';
    dialog.setAttribute('aria-label','Draw on screenshot');
    dialog.setAttribute('aria-describedby','annotation-help');
    dialog.innerHTML=`<div class="annotation-head"><strong>Draw on screenshot</strong><span class="annotation-dirty"></span>
      <button type="button" data-command="cancel" aria-label="Close drawing editor" data-tooltip="Close drawing editor">${SVG.x}</button></div>
      <div class="annotation-tools" role="toolbar" aria-label="Drawing tools">
        <div class="annotation-group" role="group" aria-label="Tools">
          <button type="button" data-tool="select" aria-pressed="false">Select / move</button>
          <button type="button" data-tool="pen" aria-pressed="true" aria-label="Draw with pen" data-tooltip="Draw a freehand stroke">${SVG.edit} Pen</button>
          <button type="button" data-tool="arrow" aria-pressed="false" aria-label="Draw an arrow" data-tooltip="Drag from arrow tail to tip">${SVG.open} Arrow</button>
          <button type="button" data-tool="rectangle" aria-pressed="false" aria-label="Draw a rectangle" data-tooltip="Drag a rectangle; adjust corner radius below">${SVG.box} Rectangle</button>
          <button type="button" data-tool="text" aria-pressed="false">Text</button>
        </div>
        <div class="annotation-group" role="group" aria-label="History">
          <button type="button" data-command="undo" aria-label="Undo drawing" data-tooltip="Undo (⌘/Ctrl Z)">${SVG.reply} Undo</button>
          <button type="button" data-command="redo" aria-label="Redo drawing" data-tooltip="Redo (⌘/Ctrl Shift Z)">${SVG.ref} Redo</button>
          <button type="button" data-command="clear" aria-label="Clear all drawings" data-tooltip="Remove all drawings, keeping the original">${SVG.trash} Clear drawings</button>
        </div>
        <div class="annotation-group" role="group" aria-label="Zoom">
          <button type="button" data-command="out" aria-label="Zoom out" data-tooltip="Zoom out">−</button><output class="annotation-zoom">100%</output>
          <button type="button" data-command="in" aria-label="Zoom in" data-tooltip="Zoom in">+</button><button type="button" data-command="fit">Fit</button>
        </div>
      </div>
      <div class="annotation-properties">
        <div class="annotation-palette" role="group" aria-label="Drawing colors"></div>
        <label>Custom color <input type="color" data-field="color" value="${color}" aria-label="Custom drawing color"></label>
        <label>Stroke <input type="number" data-field="width" min="1" max="${LIMITS.maxWidth}" step="1" value="3" aria-label="Stroke width in image pixels"></label>
        <label>Corner radius <input type="number" data-field="radius" min="0" step="1" value="8" aria-label="Rectangle corner radius in image pixels"></label>
        <label>Text size <input type="number" data-field="size" min="1" max="${LIMITS.maxTextSize}" step="1" value="20" aria-label="Text size in image pixels"></label>
        <label class="annotation-mark-label">Drawing <select data-field="mark" aria-label="Select an editable drawing"><option value="-1">No drawing selected</option></select></label>
        <button type="button" data-command="delete" aria-label="Delete selected drawing" data-tooltip="Delete the selected drawing">${SVG.trash} Delete selected</button>
        <label class="annotation-text-label">Text <textarea data-field="text" rows="2" maxlength="${LIMITS.maxText}" placeholder="Click to place text, or type here first, then click the screenshot or white padding"></textarea></label>
      </div>
      <p id="annotation-help" class="annotation-help">White padding is drawable blank space, not page context. The outlined screenshot stays at its original pixel size. Select a drawing to move it or edit its properties.</p>
      <div class="annotation-viewport"><div class="annotation-surface"><canvas tabindex="0" aria-label="Screenshot drawing canvas. Choose a tool and drag to draw; text is placed with a click."></canvas><div class="annotation-source-outline" aria-hidden="true"></div></div></div>
      <div class="annotation-message" role="status" aria-live="polite">Loading original screenshot…</div>
      <div class="annotation-error" role="alert" hidden></div>
      <div class="annotation-footer"><button type="button" data-command="retry" hidden>Retry image load</button><span>Original screenshot is never changed.</span>
        <button type="button" data-command="cancel">Cancel</button><button type="button" data-command="apply" class="annotation-apply">Apply drawing</button></div>`;
    const find=<T extends Element>(selector:string)=>dialog.querySelector<T>(selector)!;
    const canvas=find<HTMLCanvasElement>('canvas'), viewport=find<HTMLElement>('.annotation-viewport');
    const surface=find<HTMLElement>('.annotation-surface'), outline=find<HTMLElement>('.annotation-source-outline');
    const message=find<HTMLElement>('.annotation-message'), error=find<HTMLElement>('.annotation-error');
    const markSelect=find<HTMLSelectElement>('[data-field="mark"]'), text=find<HTMLTextAreaElement>('[data-field="text"]');
    const field=(name:string)=>find<HTMLInputElement>('[data-field="'+name+'"]');
    const button=(name:string)=>find<HTMLButtonElement>('[data-command="'+name+'"]');
    const context=canvas.getContext('2d');
    const dirty=()=>JSON.stringify(marks)!==initial;
    function emit(){
      const state={open:!closed,dirty:!closed&&dirty(),busy:!closed&&(loading||saving)};
      const json=JSON.stringify(state);
      if(json!==lastState){lastState=json;document.dispatchEvent(new CustomEvent('lcr:annotation-state',{detail:state}));}
    }
    function fail(reason:unknown){error.textContent=reason instanceof Error?reason.message:String(reason);error.hidden=false;}
    function clearError(){error.hidden=true;error.textContent='';}
    function sync(){
      const busy=loading||saving;
      dialog.querySelectorAll<HTMLButtonElement|HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>('button,input,textarea,select').forEach(el=>{
        el.disabled=busy && !(el instanceof HTMLButtonElement && el.dataset.command==='cancel' && !saving);
      });
      button('undo').disabled=busy||!undo.length;
      button('redo').disabled=busy||!redo.length;
      button('clear').disabled=busy||!marks.length;
      button('delete').disabled=busy||selected<0;
      button('apply').disabled=busy||!image;
      button('apply').textContent=saving?'Applying…':marks.length?'Apply drawing':'Apply without drawings';
      find<HTMLElement>('.annotation-dirty').textContent=dirty()?'Unsaved drawing changes':'';
      dialog.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.tool===tool)));
      dialog.querySelectorAll<HTMLButtonElement>('[data-color]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.color===color.toLowerCase())));
      field('color').value=color;field('width').value=String(stroke);field('radius').value=String(radius);field('size').value=String(size);
      const current=marks[selected];
      field('radius').disabled=busy||!(current?.tool==='rectangle'||tool==='rectangle');
      field('size').disabled=busy||!(current?.tool==='text'||tool==='text');
      field('width').disabled=busy||current?.tool==='text'||(selected<0&&tool==='text');
      text.disabled=busy||!(current?.tool==='text'||tool==='text');
      canvas.style.cursor=tool==='select'?'move':tool==='text'?'text':'crosshair';
      emit();
    }
    function refreshMarks(){
      markSelect.replaceChildren(new Option('No drawing selected','-1'));
      marks.forEach((mark,i)=>markSelect.add(new Option((i+1)+' · '+mark.tool,String(i))));
      markSelect.value=String(selected);
    }
    function select(index:number){
      selected=index>=0&&index<marks.length?index:-1;
      const mark=marks[selected];
      if(mark){
        color=mark.color;
        if(mark.tool==='text'){size=mark.size;text.value=mark.text;}
        else stroke=mark.width;
        if(mark.tool==='rectangle')radius=mark.radius;
      }
      markSelect.value=String(selected);sync();paint();
    }
    function commit(next:AnnotationMark[],nextSelected=-1){
      if(JSON.stringify(next)===JSON.stringify(marks)){select(nextSelected);return;}
      undo.push(marks);if(undo.length>100)undo.shift();redo.length=0;
      marks=next;selected=nextSelected;pendingText=null;
      const current=marks[selected];if(current?.tool==='rectangle')radius=current.radius;
      refreshMarks();sync();paint();
    }
    function history(back:boolean){
      cancelGesture();pendingText=null;const from=back?undo:redo,to=back?redo:undo;
      const next=from.pop();if(!next){paint();return;}
      to.push(marks);marks=next;selected=-1;refreshMarks();sync();paint();
    }
    function bounds(mark:AnnotationMark):Bounds {
      if(mark.tool==='text'){
        const lines=mark.text.split('\n');
        if(context)context.font=mark.size+'px sans-serif';
        return {x:mark.at.x,y:mark.at.y,width:Math.max(1,...lines.map(line=>context?.measureText(line).width??line.length*mark.size)),height:lines.length*mark.size*1.25};
      }
      const points=mark.tool==='pen'?mark.points:[mark.from,mark.to];
      let x=Infinity,y=Infinity,right=-Infinity,bottom=-Infinity;
      for(const p of points){x=Math.min(x,p.x);y=Math.min(y,p.y);right=Math.max(right,p.x);bottom=Math.max(bottom,p.y);}
      return {x,y,width:right-x,height:bottom-y};
    }
    function drawMark(ctx:CanvasRenderingContext2D,mark:AnnotationMark){
      ctx.save();ctx.strokeStyle=mark.color;ctx.fillStyle=mark.color;ctx.lineCap='round';ctx.lineJoin='round';
      if(mark.tool==='text'){
        ctx.font=mark.size+'px sans-serif';ctx.textBaseline='top';
        mark.text.split('\n').forEach((line,i)=>ctx.fillText(line,mark.at.x,mark.at.y+i*mark.size*1.25));
      }else{
        ctx.lineWidth=mark.width;ctx.beginPath();
        if(mark.tool==='pen'){
          const first=mark.points[0]!;
          if(mark.points.length===1){ctx.arc(first.x,first.y,mark.width/2,0,Math.PI*2);ctx.fill();}
          else {ctx.moveTo(first.x,first.y);for(let i=1;i<mark.points.length;i++){const p=mark.points[i]!;ctx.lineTo(p.x,p.y);}ctx.stroke();}
        }else if(mark.tool==='rectangle'){
          const x=Math.min(mark.from.x,mark.to.x),y=Math.min(mark.from.y,mark.to.y);
          const w=Math.abs(mark.to.x-mark.from.x),h=Math.abs(mark.to.y-mark.from.y);
          ctx.roundRect(x,y,w,h,Math.min(mark.radius,w/2,h/2));ctx.stroke();
        }else{
          const angle=Math.atan2(mark.to.y-mark.from.y,mark.to.x-mark.from.x);
          const length=Math.min(Math.hypot(mark.to.x-mark.from.x,mark.to.y-mark.from.y),Math.max(10*sourceScale,mark.width*4));
          ctx.moveTo(mark.from.x,mark.from.y);ctx.lineTo(mark.to.x,mark.to.y);
          ctx.moveTo(mark.to.x-length*Math.cos(angle-Math.PI/6),mark.to.y-length*Math.sin(angle-Math.PI/6));
          ctx.lineTo(mark.to.x,mark.to.y);ctx.lineTo(mark.to.x-length*Math.cos(angle+Math.PI/6),mark.to.y-length*Math.sin(angle+Math.PI/6));ctx.stroke();
        }
      }
      ctx.restore();
    }
    function render(ctx:CanvasRenderingContext2D,guides:boolean){
      ctx.fillStyle='#ffffff';ctx.fillRect(0,0,width,height);
      if(image)ctx.drawImage(image,padding,padding);
      marks.forEach((mark,i)=>{if(!gesture||!gesture.move||i!==gesture.index)drawMark(ctx,mark);});
      if(gesture)drawMark(ctx,gesture.mark);
      if(guides&&selected>=0){
        const b=bounds(gesture?.move?gesture.mark:marks[selected]!);
        ctx.save();ctx.strokeStyle='#2563eb';ctx.lineWidth=1/zoom;ctx.setLineDash([5/zoom,4/zoom]);
        ctx.strokeRect(b.x-4/zoom,b.y-4/zoom,b.width+8/zoom,b.height+8/zoom);ctx.restore();
      }
      if(guides&&pendingText){
        ctx.save();ctx.strokeStyle='#2563eb';ctx.lineWidth=1/zoom;ctx.beginPath();
        ctx.moveTo(pendingText.x-6/zoom,pendingText.y);ctx.lineTo(pendingText.x+6/zoom,pendingText.y);
        ctx.moveTo(pendingText.x,pendingText.y-6/zoom);ctx.lineTo(pendingText.x,pendingText.y+6/zoom);ctx.stroke();ctx.restore();
      }
    }
    function paint(){
      if(paintFrame||!image||!context||closed)return;
      paintFrame=requestAnimationFrame(()=>{
        paintFrame=0;if(closed)return;
        try{render(context,true);}catch(reason){fail(reason);}
      });
    }
    function setZoom(value:number,fit=false){
      if(!image)return;
      const centerX=(viewport.scrollLeft+viewport.clientWidth/2)/zoom,centerY=(viewport.scrollTop+viewport.clientHeight/2)/zoom;
      zoom=Math.max(.01,Math.min(4,value));fitted=fit;
      canvas.style.width=width*zoom+'px';canvas.style.height=height*zoom+'px';
      surface.style.width=width*zoom+'px';surface.style.height=height*zoom+'px';
      Object.assign(outline.style,{left:padding*zoom+'px',top:padding*zoom+'px',width:image.naturalWidth*zoom+'px',height:image.naturalHeight*zoom+'px'});
      find<HTMLOutputElement>('.annotation-zoom').value=Math.round(zoom*100)+'%';
      if(fit){viewport.scrollLeft=0;viewport.scrollTop=0;}
      else {viewport.scrollLeft=centerX*zoom-viewport.clientWidth/2;viewport.scrollTop=centerY*zoom-viewport.clientHeight/2;}
      paint();
    }
    function fit(){if(image)setZoom(Math.min(1,(viewport.clientWidth-32)/width,(viewport.clientHeight-32)/height),true);}
    const resize=new ResizeObserver(()=>{if(fitted)fit();});
    function point(event:PointerEvent):AnnotationPoint {
      const rect=canvas.getBoundingClientRect();
      return {x:Math.max(0,Math.min(width,(event.clientX-rect.left)*width/rect.width)),y:Math.max(0,Math.min(height,(event.clientY-rect.top)*height/rect.height))};
    }
    function cancelGesture(){
      if(!gesture)return;
      const id=gesture.id;gesture=null;
      if(canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);
      paint();
    }
    function pointCount(){return marks.reduce((sum,mark)=>sum+(mark.tool==='pen'?mark.points.length:0),0);}
    function moved(mark:AnnotationMark,dx:number,dy:number):AnnotationMark {
      const b=bounds(mark);
      dx=Math.max(-b.x,Math.min(width-b.x-Math.min(b.width,width-b.x),dx));
      dy=Math.max(-b.y,Math.min(height-b.y-Math.min(b.height,height-b.y),dy));
      const translate=(p:AnnotationPoint)=>({x:p.x+dx,y:p.y+dy});
      if(mark.tool==='text')return {...mark,at:translate(mark.at)};
      if(mark.tool==='pen')return {...mark,points:mark.points.map(translate)};
      return {...mark,from:translate(mark.from),to:translate(mark.to)};
    }
    canvas.addEventListener('pointerdown',event=>{
      if(loading||saving||!image||gesture||event.button!==0||!event.isPrimary)return;
      event.preventDefault();canvas.focus({preventScroll:true});clearError();const at=point(event);
      if(tool==='select'){
        const tolerance=8/zoom;
        let index=-1;
        for(let i=marks.length-1;i>=0;i--){const b=bounds(marks[i]!);if(at.x>=b.x-tolerance&&at.x<=b.x+b.width+tolerance&&at.y>=b.y-tolerance&&at.y<=b.y+b.height+tolerance){index=i;break;}}
        select(index);if(index<0)return;
        gesture={id:event.pointerId,start:at,mark:marks[index]!,index,move:true,points:0};
      }else{
        if(marks.length>=LIMITS.maxMarks){fail('This drawing has reached the '+LIMITS.maxMarks+' mark limit. Delete a mark before drawing more.');return;}
        if(tool==='text'){
          if(!text.value.trim()){pendingText=at;select(-1);text.focus();paint();return;}
          commit([...marks,{tool:'text',color,at,text:text.value,size}],marks.length);return;
        }
        if(tool==='pen'&&pointCount()>=LIMITS.maxPoints){fail('This drawing has reached the pen point limit. Delete a pen stroke before drawing more.');return;}
        const mark:AnnotationMark=tool==='pen'?{tool,color,width:stroke,points:[at]}:tool==='rectangle'?
          {tool,color,width:stroke,from:at,to:at,radius:0}:{tool:'arrow',color,width:stroke,from:at,to:at};
        selected=-1;refreshMarks();sync();gesture={id:event.pointerId,start:at,mark,index:-1,move:false,points:pointCount()};
      }
      canvas.setPointerCapture(event.pointerId);paint();
    });
    function updateGesture(event:PointerEvent){
      if(!gesture||gesture.id!==event.pointerId)return;
      const at=point(event);
      if(gesture.move){gesture.mark=moved(marks[gesture.index]!,at.x-gesture.start.x,at.y-gesture.start.y);}
      else if(gesture.mark.tool==='pen'){
        const points=gesture.mark.points,last=points[points.length-1]!;
        if(Math.hypot(at.x-last.x,at.y-last.y)<.5)return;
        if(gesture.points+points.length>=LIMITS.maxPoints){cancelGesture();fail('That stroke exceeded the pen point limit and was discarded. Use shorter strokes or delete an existing stroke.');return;}
        points.push(at);
      }else if(gesture.mark.tool==='rectangle'){
        gesture.mark={...gesture.mark,to:at,radius:Math.min(radius,Math.abs(at.x-gesture.start.x)/2,Math.abs(at.y-gesture.start.y)/2)};
      }else if(gesture.mark.tool==='arrow')gesture.mark={...gesture.mark,to:at};
      paint();
    }
    canvas.addEventListener('pointermove',event=>{if(gesture){event.preventDefault();updateGesture(event);}});
    canvas.addEventListener('pointerup',event=>{
      if(!gesture||gesture.id!==event.pointerId)return;
      updateGesture(event);if(!gesture)return;
      const done=gesture;gesture=null;
      if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
      if(done.move){commit(marks.map((mark,i)=>i===done.index?done.mark:mark),done.index);return;}
      if((done.mark.tool==='arrow'||done.mark.tool==='rectangle')&&Math.hypot(done.mark.to.x-done.mark.from.x,done.mark.to.y-done.mark.from.y)<1){paint();return;}
      commit([...marks,done.mark],marks.length);
    });
    canvas.addEventListener('pointercancel',cancelGesture);
    canvas.addEventListener('lostpointercapture',cancelGesture);
    function changeProperty(name:string,value:string){
      const numeric=Number(value);
      if(name==='color')color=value.toLowerCase();
      if(name==='width')stroke=Math.max(1,Math.min(LIMITS.maxWidth,Number.isFinite(numeric)?numeric:stroke));
      if(name==='radius')radius=Math.max(0,Math.min(LIMITS.maxDimension,Number.isFinite(numeric)?numeric:radius));
      if(name==='size')size=Math.max(1,Math.min(LIMITS.maxTextSize,Number.isFinite(numeric)?numeric:size));
      const mark=marks[selected];
      if(mark){
        let next:AnnotationMark=mark;
        if(name==='color')next={...mark,color};
        if(name==='width'&&mark.tool!=='text')next={...mark,width:stroke};
        if(name==='radius'&&mark.tool==='rectangle')next={...mark,radius:Math.min(radius,Math.abs(mark.to.x-mark.from.x)/2,Math.abs(mark.to.y-mark.from.y)/2)};
        if(name==='size'&&mark.tool==='text')next={...mark,size};
        if(name==='text'&&mark.tool==='text'){
          if(!value.trim()){fail('Text must not be empty. Use Delete selected to remove the drawing.');text.value=mark.text;return;}
          next={...mark,text:value};
        }
        commit(marks.map((item,i)=>i===selected?next:item),selected);
      }else sync();
    }
    dialog.addEventListener('change',event=>{
      const target=event.target as HTMLInputElement;
      if(!target.dataset.field||loading||saving)return;
      if(target.dataset.field==='mark'){pendingText=null;tool='select';select(Number(target.value));}
      else changeProperty(target.dataset.field,target.value);
    });
    text.addEventListener('input',()=>{
      if(loading||saving)return;
      if(pendingText&&text.value.trim()){
        commit([...marks,{tool:'text',color,at:pendingText,text:text.value,size}],marks.length);
      }else if(marks[selected]?.tool==='text')changeProperty('text',text.value);
    });
    const palette=find<HTMLElement>('.annotation-palette');
    PALETTE.forEach(value=>{
      const swatch=document.createElement('button');swatch.type='button';swatch.dataset.color=value;
      swatch.style.setProperty('--annotation-color',value);swatch.setAttribute('aria-label','Use color '+value);
      swatch.dataset.tooltip='Color '+value;swatch.setAttribute('aria-pressed',String(value===color));palette.append(swatch);
    });
    function requestClose(){
      if(saving)return;
      cancelGesture();
      if(dirty()&&!window.confirm('Discard your drawing changes? The original screenshot will be kept.'))return;
      dialog.close();
    }
    async function save(){
      if(loading||saving||!image||!context)return;
      cancelGesture();clearError();saving=true;sync();
      try{
        if(!marks.length)await apply(null);
        else{
          const proposal={image:'images/annotation.png',width:image.naturalWidth,height:image.naturalHeight,padding,marks};
          if(!webAnnotation(proposal))throw new Error('The drawing exceeds the supported annotation limits. Reduce its size or remove drawings and try again.');
          // Export separately so selection handles and the editor's screenshot outline never enter the PNG.
          const output=document.createElement('canvas');output.width=width;output.height=height;
          const ctx=output.getContext('2d');if(!ctx)throw new Error('The browser could not create a PNG canvas.');
          let blob:Blob;
          try{
            render(ctx,false);
            const encoded=Promise.withResolvers<Blob>();
            output.toBlob(result=>result?encoded.resolve(result):encoded.reject(new Error('The browser could not encode this drawing as PNG.')),'image/png');
            blob=await encoded.promise;
          }
          finally{output.width=0;output.height=0;}
          const ref=await upload(blob);
          const annotation=webAnnotation({...proposal,image:ref});
          if(!annotation)throw new Error('The uploaded drawing did not return a valid PNG reference.');
          await apply(annotation);
        }
        dialog.close();
      }catch(reason){fail(reason);}
      finally{saving=false;if(!closed)sync();}
    }
    dialog.addEventListener('click',event=>{
      const target=(event.target as Element).closest<HTMLButtonElement>('button');if(!target||target.disabled)return;
      if(target.dataset.command==='cancel'){requestClose();return;}
      if(loading||saving)return;
      if(target.dataset.tool){cancelGesture();pendingText=null;tool=target.dataset.tool as Tool;select(-1);if(tool==='text')text.focus();return;}
      if(target.dataset.color){changeProperty('color',target.dataset.color);return;}
      switch(target.dataset.command){
        case 'undo':history(true);break;case 'redo':history(false);break;
        case 'clear':cancelGesture();commit([]);break;
        case 'delete':cancelGesture();commit(marks.filter((_,i)=>i!==selected));break;
        case 'in':setZoom(zoom*1.25);break;case 'out':setZoom(zoom/1.25);break;case 'fit':fit();break;
        case 'apply':void save();break;
      }
    });
    function onKey(event:KeyboardEvent){
      if(closed)return;
      // Capture at the window before note/page shortcut handlers can consume Escape or save/undo.
      if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();requestClose();return;}
      const target=event.target as HTMLElement;
      const typing=target instanceof HTMLInputElement||target instanceof HTMLTextAreaElement||target instanceof HTMLSelectElement||target.isContentEditable;
      if(event.ctrlKey||event.metaKey){
        if(event.key.toLowerCase()==='s'){event.preventDefault();event.stopImmediatePropagation();return;}
        if(!typing&&(event.key.toLowerCase()==='z'||event.key.toLowerCase()==='y')){
          event.preventDefault();event.stopImmediatePropagation();if(!loading&&!saving)history(event.key.toLowerCase()==='z'&&!event.shiftKey);return;
        }
      }
      if(!typing&&(event.key==='Delete'||event.key==='Backspace')){
        event.preventDefault();event.stopImmediatePropagation();if(!loading&&!saving&&selected>=0)commit(marks.filter((_,i)=>i!==selected));return;
      }
      if(event.key!=='Tab')event.stopImmediatePropagation();
    }
    dialog.addEventListener('cancel',event=>{event.preventDefault();requestClose();});
    dialog.addEventListener('close',()=>{
      closed=true;cancelGesture();cancelAnimationFrame(paintFrame);resize.disconnect();window.removeEventListener('keydown',onKey,true);
      window.removeEventListener('blur',cancelGesture);
      image=null;canvas.width=0;canvas.height=0;dialog.remove();emit();
      if(previous?.isConnected){
        previous.focus({preventScroll:true});
        if(caret&&caret.start!==null&&caret.end!==null&&(previous instanceof HTMLTextAreaElement||previous instanceof HTMLInputElement)){
          try{previous.setSelectionRange(caret.start,caret.end,caret.direction??undefined);}catch{/* Some input types have no text selection. */}
        }
      }
      resolve();
    },{once:true});
    async function load(){
      loading=true;clearError();button('retry').hidden=true;message.textContent='Loading original screenshot…';sync();
      try{
        if(!context)throw new Error('This browser does not support a 2D drawing canvas.');
        const src=attachSrc(capture.area);if(!src)throw new Error('The original screenshot attachment is unavailable.');
        const source=new Image();
        const decoded=Promise.withResolvers<void>();
        source.onload=()=>decoded.resolve();
        source.onerror=()=>decoded.reject(new Error('Could not load the original screenshot. Retry when the server is available.'));
        source.src=src;
        await decoded.promise;
        if(closed)return;
        const naturalWidth=source.naturalWidth,naturalHeight=source.naturalHeight;
        if(!naturalWidth||!naturalHeight)throw new Error('The original screenshot has no decodable image pixels.');
        sourceScale=naturalWidth/capture.rect.width;
        padding=saved?saved.padding:Math.round(64*sourceScale);
        width=naturalWidth+2*padding;height=naturalHeight+2*padding;
        if(!Number.isFinite(sourceScale)||sourceScale<=0||padding>LIMITS.maxPadding||width>LIMITS.maxDimension||height>LIMITS.maxDimension||width*height>LIMITS.maxPixels)
          throw new Error('This screenshot is too large to annotate safely (maximum '+LIMITS.maxDimension+' pixels per side and '+(LIMITS.maxPixels/1048576)+' megapixels including padding). Capture a smaller area.');
        if(saved&&(saved.width!==naturalWidth||saved.height!==naturalHeight||!webAnnotation(saved)))throw new Error('The saved drawing does not match the original screenshot or exceeds supported limits.');
        image=source;canvas.width=width;canvas.height=height;
        stroke=Math.min(LIMITS.maxWidth,Math.max(1,Math.round(3*sourceScale)));
        radius=Math.round(8*sourceScale);size=Math.min(LIMITS.maxTextSize,Math.max(1,Math.round(20*sourceScale)));
        message.textContent=naturalWidth+' × '+naturalHeight+' original pixels · '+padding+' px white padding on each side · edit or move saved drawings with Select';
        fit();paint();
      }catch(reason){if(!closed){fail(reason);message.textContent='Original screenshot could not be opened for drawing.';button('retry').hidden=false;}}
      finally{loading=false;if(!closed)sync();}
    }
    button('retry').addEventListener('click',()=>{if(!loading&&!saving)void load();});
    document.body.append(dialog);
    window.addEventListener('keydown',onKey,true);
    window.addEventListener('blur',cancelGesture);
    refreshMarks();sync();
    try{dialog.showModal();resize.observe(viewport);void load();}
    catch(reason){fail(reason);dialog.remove();closed=true;window.removeEventListener('keydown',onKey,true);window.removeEventListener('blur',cancelGesture);resize.disconnect();emit();resolve();}
    return promise;
}
