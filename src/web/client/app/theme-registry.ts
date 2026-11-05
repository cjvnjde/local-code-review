import catppuccinColors from "../../styles/themes/catppuccin.css" with { type: "text" };
import gruvboxColors from "../../styles/themes/gruvbox.css" with { type: "text" };

/** Each palette supplies colors only; controls and mode selection do not depend on its identity. */
export const THEMES = [
  // The default palette already lives in index.css; clearing the override restores it.
  { id: "default", label: "Default", colors: "" },
  { id: "catppuccin", label: "Catppuccin", colors: catppuccinColors },
  { id: "gruvbox", label: "Gruvbox", colors: gruvboxColors },
];
