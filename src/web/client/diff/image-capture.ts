import { imageRegion, regionLabel } from "../../../shared/image-region.ts";
import { attachSrc } from "../components/attach.ts";
import { esc } from "../app/state.ts";

/** The capture is independent of the current diff, including in note lists and browser history. */
export function imageCaptureHtml(value: any, changed = false) {
  const r = imageRegion(value);
  if (!r) return "";
  return (
    '<div class="image-capture"><div class="image-caption">Screenshot region · ' +
    esc(regionLabel(r)) +
    (changed ? " · image has changed" : "") +
    '</div><a data-image-preview="' +
    esc(r.capture) +
    '" href="' +
    esc(attachSrc(r.capture)) +
    '" target="_blank" ' +
    'rel="noreferrer noopener"><img src="' +
    esc(attachSrc(r.capture)) +
    '" alt="Selected screenshot region" loading="lazy"></a></div>'
  );
}
