import { el, state } from "./state.ts";

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
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  });
}
