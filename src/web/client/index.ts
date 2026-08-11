import "./settings.ts";
import "./tree-controls.ts";
import { startLive } from "./live.ts";
import { load } from "./load.ts";
import { loadCfg } from "./persistence.ts";
import { applyNav, applySections } from "./sidebar.ts";

loadCfg();
applyNav();
applySections();
void load().then(startLive);
