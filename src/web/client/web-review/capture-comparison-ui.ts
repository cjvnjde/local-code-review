import { attachSrc } from "../components/attach.ts";
import {
  canCompareCaptures,
  wipeMismatch,
  wipeImageMismatch,
  type CaptureComparisons,
  type ComparisonEvidence,
} from "./capture-comparison.ts";

const mounted = new WeakMap<HTMLElement, string>();
function readComparisons(root: HTMLElement): CaptureComparisons | null {
  try {
    return JSON.parse(root.dataset.webComparisons || "null");
  } catch {
    return null;
  }
}
function labeledSelect(text: string) {
  const label = document.createElement("label");
  label.append(document.createTextNode(text));
  const select = document.createElement("select");
  label.append(select);
  return { label, select };
}
function option(value: number, text: string) {
  const item = document.createElement("option");
  item.value = String(value);
  item.textContent = text;
  return item;
}
function image(evidence: ComparisonEvidence): Promise<HTMLImageElement> {
  const { promise, resolve, reject } =
    Promise.withResolvers<HTMLImageElement>();
  const img = new Image();
  img.alt = evidence.label + " · original screenshot";
  img.onload = () =>
    img.naturalWidth && img.naturalHeight
      ? resolve(img)
      : reject(new Error("Screenshot has no image dimensions."));
  img.onerror = () =>
    reject(
      new Error(
        "A comparison screenshot could not load. Ordinary capture evidence is unchanged.",
      ),
    );
  img.src = attachSrc(evidence.capture.area!);
  return promise;
}
function comparisonControl(data: CaptureComparisons): HTMLDetailsElement {
  const details = document.createElement("details");
  details.className = "web-compare";
  const summary = document.createElement("summary");
  summary.textContent = "Compare captures";
  const controls = document.createElement("div");
  controls.className = "web-compare-controls";
  const original = labeledSelect("Original capture");
  const evidence = labeledSelect("Comparison evidence");
  data.originals.forEach((entry, i) => {
    if (
      data.evidence.some((next) =>
        canCompareCaptures(entry.capture, next.capture),
      )
    )
      original.select.append(option(i, entry.label));
  });
  const modes = document.createElement("div");
  modes.className = "web-compare-modes";
  const side = document.createElement("button");
  side.type = "button";
  side.textContent = "Side by side";
  side.setAttribute("aria-pressed", "false");
  const wipe = document.createElement("button");
  wipe.type = "button";
  wipe.textContent = "Before / after wipe";
  wipe.setAttribute("aria-pressed", "false");
  modes.append(side, wipe);
  const status = document.createElement("p");
  status.className = "web-compare-status";
  status.setAttribute("role", "status");
  const stage = document.createElement("div");
  stage.className = "web-compare-stage";
  controls.append(original.label, evidence.label, modes);
  details.append(summary, controls, status, stage);
  let generation = 0;
  const reset = () => {
    generation++;
    stage.replaceChildren();
    side.setAttribute("aria-pressed", "false");
    wipe.setAttribute("aria-pressed", "false");
    const a = data.originals[Number(original.select.value)]!;
    const b = data.evidence[Number(evidence.select.value)]!;
    const reason = wipeMismatch(a.capture, b.capture);
    wipe.disabled = !!reason;
    wipe.title = reason || "Reveal the comparison screenshot over the original";
    status.textContent =
      reason ||
      "Choose a view. These are original screenshots, not drawing proposals.";
  };
  const chooseOriginal = () => {
    const a = data.originals[Number(original.select.value)]!;
    evidence.select.replaceChildren();
    data.evidence.forEach((entry, i) => {
      if (canCompareCaptures(a.capture, entry.capture))
        evidence.select.append(option(i, entry.label));
    });
    reset();
  };
  original.select.onchange = chooseOriginal;
  evidence.select.onchange = reset;
  chooseOriginal();
  const show = async (mode: "side" | "wipe") => {
    const ticket = ++generation;
    const a = data.originals[Number(original.select.value)]!;
    const b = data.evidence[Number(evidence.select.value)]!;
    stage.replaceChildren();
    side.setAttribute("aria-pressed", "false");
    wipe.setAttribute("aria-pressed", "false");
    status.textContent = "Loading original screenshots…";
    try {
      const [before, after] = await Promise.all([image(a), image(b)]);
      if (ticket !== generation || !details.isConnected) return;
      const mismatch =
        wipeMismatch(a.capture, b.capture) ||
        wipeImageMismatch(
          { width: before.naturalWidth, height: before.naturalHeight },
          { width: after.naturalWidth, height: after.naturalHeight },
        );
      wipe.disabled = !!mismatch;
      wipe.title =
        mismatch || "Reveal the comparison screenshot over the original";
      if (mode === "wipe" && mismatch) {
        status.textContent = mismatch;
        return;
      }
      status.textContent =
        mismatch ||
        "Same capture geometry and image dimensions; no pixel score or automatic alignment is applied.";
      if (mode === "side") {
        const pair = document.createElement("div");
        pair.className = "web-compare-side";
        for (const [entry, img] of [
          [a, before],
          [b, after],
        ] as const) {
          const figure = document.createElement("figure");
          const caption = document.createElement("figcaption");
          caption.textContent = entry.label;
          figure.append(caption, img);
          pair.append(figure);
        }
        stage.append(pair);
        side.setAttribute("aria-pressed", "true");
        return;
      }
      const labels = document.createElement("p");
      labels.className = "web-compare-labels";
      labels.textContent = "Before: " + a.label + " · Comparison: " + b.label;
      const frame = document.createElement("div");
      frame.className = "web-compare-wipe";
      frame.style.maxWidth = before.naturalWidth + "px";
      after.className = "web-compare-reveal";
      const divider = document.createElement("span");
      divider.className = "web-compare-divider";
      divider.setAttribute("aria-hidden", "true");
      frame.append(before, after, divider);
      const label = document.createElement("label");
      label.className = "web-compare-range";
      const text = document.createElement("span");
      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = "0";
      slider.max = "100";
      slider.value = "50";
      slider.setAttribute("aria-label", "Comparison screenshot revealed");
      const reveal = () => {
        after.style.clipPath =
          "inset(0 " + (100 - Number(slider.value)) + "% 0 0)";
        divider.style.left = slider.value + "%";
        text.textContent =
          "Comparison screenshot revealed: " + slider.value + "%";
        slider.setAttribute(
          "aria-valuetext",
          slider.value +
            "% comparison, " +
            (100 - Number(slider.value)) +
            "% original",
        );
      };
      slider.oninput = reveal;
      // The native range retains Arrow, Home and End keyboard behavior in embedded editors.
      slider.onkeydown = (event) => event.stopPropagation();
      reveal();
      label.append(text, slider);
      stage.append(labels, frame, label);
      wipe.setAttribute("aria-pressed", "true");
    } catch (error) {
      if (ticket !== generation) return;
      wipe.disabled = true;
      status.textContent =
        error instanceof Error ? error.message : String(error);
    }
  };
  side.onclick = () => void show("side");
  wipe.onclick = () => void show("wipe");
  return details;
}

/** Every mount is independent, including duplicate notes and read-only reference/history cards. */
export function hydrateCaptureComparisons(host: ParentNode = document) {
  host
    .querySelectorAll<HTMLElement>(".web-capture[data-web-comparisons]")
    .forEach((root) => {
      const data = readComparisons(root);
      if (!data) return;
      const box = root.closest(".nbox");
      // A pending capture belongs to the reply, not the submitted note. It can still be viewed
      // alongside that note, without moving evidence or coupling the two removal controls.
      if (box && !root.closest("[data-reply-evidence], .refpreview, .msg")) {
        box
          .querySelectorAll<HTMLElement>(
            "[data-reply-evidence] .web-capture[data-web-comparisons]",
          )
          .forEach((pending) => {
            if (pending.closest(".nbox") !== box) return;
            const reply = readComparisons(pending);
            if (reply)
              data.evidence.push(
                ...reply.originals.map((entry) => ({
                  ...entry,
                  label: "Pending reply · " + entry.label,
                })),
              );
          });
      }
      const signature = JSON.stringify(data);
      if (mounted.get(root) === signature) return;
      mounted.set(root, signature);
      const old = [...root.children].find((child) =>
        child.classList.contains("web-compare"),
      );
      old?.remove();
      if (
        data.originals.some((entry) =>
          data.evidence.some((next) =>
            canCompareCaptures(entry.capture, next.capture),
          ),
        )
      )
        root.append(comparisonControl(data));
    });
}
