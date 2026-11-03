import { startAppearance } from "./appearance.ts";
import { startNavigation } from "../navigation/ui-navigation.ts";
import { startWebReviewUI } from "../web-review/web-review-ui.ts";
import { prepareWebNote, startWebNote } from "../web-review/web-note.ts";
import "./settings.ts";
import "../navigation/tree-controls.ts";
import { startAgentStatus } from "./agent.ts";
import { updateCount } from "../notes/footer.ts";
import { busyEditor, openImageEditor, repaintNote } from "../notes/notes.ts";
import { state } from "./state.ts";
import { startHistory } from "../history/history-ui.ts";
import { watchAudio } from "../diff/audio.ts";
import { jumpToNote, startLive } from "./live.ts";
import { watchPreviews } from "../notes/ref-preview.ts";
import { renderBody } from "../components/body.ts";
import { startReadingPosition } from "../navigation/reading-position.ts";
import { watchImages } from "../diff/images.ts";
import { watchImageComments } from "../diff/image-comments.ts";
import { load } from "./load.ts";
import { loadCfg } from "./persistence.ts";
import { watchPaths } from "../components/path.ts";
import { applyQuick } from "./quick.ts";
import { applyNav, applySections } from "../navigation/sidebar.ts";
import { watchTooltips } from "../components/tooltip.ts";
import { startResolution } from "../notes/resolution.ts";
import { watchActions } from "../components/actions.ts";
import { watchNoteHeaders } from "../notes/sticky-notes.ts";
import { startSearch } from "../search/search.ts";
import { watchContext } from "../components/context.ts";

startAppearance();
prepareWebNote();
const regions = document.querySelectorAll<HTMLElement>(
  "body > header, body > main, body > footer",
);
regions.forEach((region) => {
  region.inert = true;
});
void start();

async function start() {
  try {
    await loadCfg();
  } catch (error) {
    const message = document.createElement("section");
    message.className = "empty ui-note-error";
    message.setAttribute("role", "alert");
    const text = document.createElement("p");
    text.textContent =
      error instanceof Error
        ? error.message
        : "Could not load review settings.";
    const retry = document.createElement("button");
    retry.textContent = "Retry";
    retry.onclick = () => location.reload();
    message.append(text, retry);
    document.body.append(message);
    return;
  }
  regions.forEach((region) => {
    region.inert = false;
  });
  startWebReviewUI();
  watchContext();
  watchActions();
  watchNoteHeaders();
  watchAudio();
  watchImages();
  watchImageComments({
    busy: busyEditor,
    open: openImageEditor,
    jump: jumpToNote,
  });
  watchPaths();
  watchTooltips();
  watchPreviews(renderBody);
  applyQuick();
  applyNav();
  applySections();
  await load();
  if (state.uiEmbed) {
    void startWebNote();
    startHistory();
    startLive();
    startAgentStatus(() => {
      state.notes.forEach((note) => repaintNote(note.id));
      updateCount();
    });
    return;
  }
  startResolution();
  startSearch();
  startHistory();
  startReadingPosition();
  startNavigation();
  startLive();
  startAgentStatus(() => {
    state.notes.forEach((note: { id: string }) => repaintNote(note.id));
    updateCount();
  });
}
