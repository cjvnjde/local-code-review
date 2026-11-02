import defaultColors from "../../styles/themes/default.css" with { type: "text" };
import catppuccinColors from "../../styles/themes/catppuccin.css" with { type: "text" };
import gruvboxColors from "../../styles/themes/gruvbox.css" with { type: "text" };

/** Each palette supplies colors only; controls and mode selection do not depend on its identity. */
export const THEMES = [
  { id: "default", label: "Default", colors: defaultColors },
  { id: "catppuccin", label: "Catppuccin", colors: catppuccinColors },
  { id: "gruvbox", label: "Gruvbox", colors: gruvboxColors },
];
