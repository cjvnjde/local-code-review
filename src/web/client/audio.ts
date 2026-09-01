import { pathHtml } from './path.ts';
import { el, esc } from './state.ts';
import type { DiffFile } from '../../types.ts';

/* ---------- files git prints no lines of: listen to the recording itself ---------- */
const AUDIO=/\.(mp3|wav|ogg|oga|opus|flac|m4a|aac|aif|aiff|weba)$/i;
export const isAudio=(path: string)=>AUDIO.test(path);

type AudioFile=Pick<DiffFile,'path'|'from'|'status'>;

/** Both recordings for a change, or the single side an added or deleted file has. */
export function audioHtml(f: AudioFile){
  if(!isAudio(f.path)) return '';
  const sides=[];
  if(f.status!=='added'){
    sides.push(paneHtml(f,'old',f.status==='deleted'?'deleted':'before',f.from&&f.from!==f.path?f.from:''));
  }
  if(f.status!=='deleted'){
    sides.push(paneHtml(f,'new',f.status==='added'?'added':'after',''));
  }
  return '<div class="audw'+(sides.length>1?' two':'')+'">'+sides.join('')+'</div>';
}

function paneHtml(f: AudioFile,side: string,label: string,name: string){
  const source='/api/blob?side='+side+'&path='+encodeURIComponent(f.path);
  return '<figure class="audf '+side+'">'+
    '<figcaption><span class="side">'+label+'</span>'+
    (name?pathHtml(name,{className:'was',title:name}):'')+
    '<span class="spacer"></span><span class="dim"></span></figcaption>'+
    '<div class="audb"><audio controls preload="metadata" src="'+esc(source)+'">'+
    'Audio playback is not supported.</audio></div></figure>';
}

function durationOf(seconds: number){
  if(!Number.isFinite(seconds)) return '';
  const whole=Math.floor(seconds), hours=Math.floor(whole/3600), minutes=Math.floor(whole%3600/60);
  const clock=(hours?String(minutes).padStart(2,'0'):String(minutes))+':'+String(whole%60).padStart(2,'0');
  return hours?hours+':'+clock:clock;
}

function measured(e: Event,failed: boolean){
  if(!(e.target instanceof HTMLAudioElement)) return;
  const audio=e.target;
  const box=audio.closest('.audf'); if(!box) return;
  box.classList.toggle('gone',failed);
  const out=box.querySelector('.dim'); if(!out) return;
  out.textContent=failed?'could not be played':durationOf(audio.duration);
}

/** Audio metadata events do not bubble, so one capture listener watches every repainted player. */
export function watchAudio(){
  el('diff').addEventListener('loadedmetadata',e=>measured(e,false),true);
  el('diff').addEventListener('error',e=>measured(e,true),true);
}
