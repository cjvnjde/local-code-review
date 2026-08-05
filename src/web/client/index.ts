import "./settings.ts";
import "./tree-controls.ts";
import { load } from "./load.ts";
import { loadCfg } from "./persistence.ts";
import { applyNav } from "./sidebar.ts";

loadCfg();
applyNav();
void load();
