import "./settings.ts";
import "./tree-controls.ts";
import { startAgentStatus } from './agent.ts';
import { updateCount } from './footer.ts';
import { repaintNote } from './notes.ts';
import { state } from './state.ts';
import { startHistory } from './history-ui.ts';
import { watchAudio } from "./audio.ts";
import { startLive } from "./live.ts";
import { watchImages } from "./images.ts";
import { load } from "./load.ts";
import { loadCfg } from "./persistence.ts";
import { watchPaths } from "./path.ts";
import { applyQuick } from "./quick.ts";
import { applyNav, applySections } from "./sidebar.ts";

loadCfg();
startHistory();
watchAudio();
watchImages();
watchPaths();
applyQuick();
applyNav();
applySections();
void load().then(()=>{
  startLive();
  startAgentStatus(()=>{ state.notes.forEach((note: any)=>repaintNote(note.id)); updateCount(); });
});
