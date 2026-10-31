import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { Cdp } from './cdp.ts';

export function chromeCandidates(platform=process.platform):string[]{
  if(process.env.LCR_BROWSER_PATH) return [process.env.LCR_BROWSER_PATH];
  if(platform==='darwin') return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'];
  if(platform==='win32') return [path.join(process.env.PROGRAMFILES||'C:\\Program Files','Google/Chrome/Application/chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)']||'C:\\Program Files (x86)','Microsoft/Edge/Application/msedge.exe')];
  return ['google-chrome','google-chrome-stable','chromium','chromium-browser','microsoft-edge'];
}
export async function launchReviewBrowser(profile:string,extraArgs:string[]=[]){
  const executable=chromeCandidates().map(candidate=>Bun.which(candidate)).find(Boolean);
  if(!executable) throw new Error('Chrome/Chromium was not found. Install it or set LCR_BROWSER_PATH to its executable.');
  await mkdir(profile,{recursive:true});
  const active=path.join(profile,'DevToolsActivePort');
  // Never attach to an unrelated process or a stale endpoint from a previous run.
  await rm(active,{force:true});
  const child=Bun.spawn([executable,'--remote-debugging-port=0','--remote-debugging-address=127.0.0.1',
    '--user-data-dir='+profile,'--no-first-run','--no-default-browser-check','--new-window',...extraArgs,'about:blank'],
    {stdin:'ignore',stdout:'ignore',stderr:'ignore'});
  try{
    let endpoint='';
    for(let i=0;i<150;i++){
      if(child.exitCode!==null) throw new Error('The review browser exited. Close any other lcr browser using this review directory and retry.');
      const lines=(await readFile(active,'utf8').catch(()=>'')).trim().split('\n');
      if(/^\d+$/.test(lines[0]||'')&&/^\/devtools\/browser\/[\w-]+$/.test(lines[1]||'')){
        endpoint='ws://127.0.0.1:'+lines[0]+lines[1]; break;
      }
      await Bun.sleep(100);
    }
    if(!endpoint) throw new Error('Chrome did not expose its review connection within 15 seconds.');
    const cdp=await Cdp.connect(endpoint);
    return {cdp,child,async close(){await cdp.send('Browser.close').catch(()=>{});cdp.close();child.kill();}};
  }catch(error){child.kill();throw error;}
}
