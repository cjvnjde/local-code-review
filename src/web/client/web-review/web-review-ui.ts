import { el, state } from "../app/state.ts";
import { updateWebNoteEvidence } from "../notes/notes.ts";
import { webReview } from "../../../shared/web-review.ts";

export function configureWebReview(value: unknown) {
  const web =
    value &&
    typeof value === "object" &&
    "url" in value &&
    typeof value.url === "string"
      ? value
      : null;
  state.web = web;
  let button = document.getElementById(
    "openWebPage",
  ) as HTMLButtonElement | null;
  if (!button) {
    button = document.createElement("button");
    button.id = "openWebPage";
    button.dataset.webOpen = "";
    button.textContent = "Open page";
    el("addGlobal").before(button);
  }
  button.hidden = !web;
  button.title = web ? "Open or focus " + web.url : "";
}
export function startWebReviewUI() {
  const hydrated = new WeakSet<HTMLElement>();
  const restoreReplyEvidence = () => {
    if (state.uiEmbed || !state.web) return;
    document.querySelectorAll<HTMLElement>(".nrow .reply").forEach((reply) => {
      const id = reply.closest<HTMLElement>(".nrow")?.dataset.nid;
      if (!id || hydrated.has(reply) || reply.dataset.draftId) return;
      hydrated.add(reply);
      void fetch("/api/web/draft?note=" + encodeURIComponent(id))
        .then(async (response) => {
          const result = await response.json();
          const web = webReview(result.web);
          if (
            response.ok &&
            web &&
            typeof result.draftId === "string" &&
            reply.isConnected &&
            !reply.dataset.draftId
          )
            updateWebNoteEvidence(document, id, web, {
              reply: true,
              draftId: result.draftId,
            });
        })
        .catch(() => {});
    });
  };
  new MutationObserver(restoreReplyEvidence).observe(document.body, {
    childList: true,
    subtree: true,
  });
  restoreReplyEvidence();
  document.addEventListener("click", async (event) => {
    const button = (event.target as Element)?.closest?.(
      "[data-web-open],[data-web-after],[data-web-focus]",
    ) as HTMLButtonElement;
    if (!button) return;
    const action = button.hasAttribute("data-web-after")
      ? "capture"
      : button.hasAttribute("data-web-focus")
        ? "focus"
        : "";
    const id = button.dataset.webAfter || button.dataset.webFocus;
    const label = button.textContent;
    button.disabled = true;
    button.textContent = action === "capture" ? "Capturing…" : "Opening…";
    try {
      const response = await fetch("/api/web" + (action ? "/" + action : ""), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Could not reach the review browser.");
      if (!action) configureWebReview(result);
      else if (action === "capture" && id && result.reply === true) {
        const web = webReview(result.web);
        if (!web || typeof result.draftId !== "string")
          throw new Error(
            "The comparison capture did not return follow-up evidence.",
          );
        updateWebNoteEvidence(document, id, web, {
          reply: true,
          draftId: result.draftId,
        });
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  });
}
