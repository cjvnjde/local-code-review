import "./settings.ts";
import "./tree-controls.ts";
import { load } from "./load.ts";
import { loadCfg } from "./persistence.ts";

loadCfg();
void load();
