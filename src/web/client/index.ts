import "./settings.ts";
import "./tree-controls.ts";
import { startLive } from "./live.ts";
import { watchImages } from "./images.ts";
import { load } from "./load.ts";
import { loadCfg } from "./persistence.ts";
import { applyQuick } from "./quick.ts";
import { applyNav, applySections } from "./sidebar.ts";

loadCfg();
watchImages();
applyQuick();
applyNav();
applySections();
void load().then(startLive);
