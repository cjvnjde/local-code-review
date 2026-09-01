import "./settings.ts";
import "./tree-controls.ts";
import { watchAudio } from "./audio.ts";
import { startLive } from "./live.ts";
import { watchImages } from "./images.ts";
import { load } from "./load.ts";
import { loadCfg } from "./persistence.ts";
import { watchPaths } from "./path.ts";
import { applyQuick } from "./quick.ts";
import { applyNav, applySections } from "./sidebar.ts";

loadCfg();
watchAudio();
watchImages();
watchPaths();
applyQuick();
applyNav();
applySections();
void load().then(startLive);
