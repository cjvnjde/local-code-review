import type { WebCapture } from "../../web-review-model.ts";
import {
  ANNOTATION_LIMITS as LIMITS,
  webAnnotation,
  type AnnotationMark,
  type AnnotationPoint,
  type WebAnnotation,
} from "../../web-annotation.ts";
import { attachSrc, upload } from "./attach.ts";
import { SVG } from "./state.ts";

type Tool = AnnotationMark["tool"] | "select" | "pan";
type Bounds = { x: number; y: number; width: number; height: number };
type Gesture = {
  id: number;
  start: AnnotationPoint;
  mark: AnnotationMark;
  index: number;
  move: boolean;
  points: number;
};
const PALETTE = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#3b82f6",
  "#a855f7",
  "#111111",
  "#ffffff",
];
const COLORS_KEY = "lcr:annotation-colors";
const SMOOTHING_KEY = "lcr:annotation-smoothing";
let active: Promise<void> | null = null;

/** Opens over the existing note: its textarea, selection and draft DOM are never replaced. */
export async function openAnnotation(
  capture: WebCapture,
  apply: (annotation: WebAnnotation | null) => Promise<void>,
): Promise<void> {
  if (active) {
    document
      .querySelector<HTMLDialogElement>("[data-annotation-editor]")
      ?.focus();
    return active;
  }
  active = editAnnotation(capture, apply);
  try {
    await active;
  } finally {
    active = null;
  }
}

function editAnnotation(
  capture: WebCapture,
  apply: (annotation: WebAnnotation | null) => Promise<void>,
): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  const previous =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  const caret =
    previous instanceof HTMLTextAreaElement ||
    previous instanceof HTMLInputElement
      ? {
          start: previous.selectionStart,
          end: previous.selectionEnd,
          direction: previous.selectionDirection,
        }
      : null;
  const saved = capture.annotation;
  let marks: AnnotationMark[] = saved ? structuredClone(saved.marks) : [];
  const initial = JSON.stringify(marks);
  const undo: AnnotationMark[][] = [],
    redo: AnnotationMark[][] = [];
  // Reopened vector marks remain undoable, rather than becoming baked-in screenshot pixels.
  for (let i = Math.max(0, marks.length - 100); i < marks.length; i++)
    undo.push(marks.slice(0, i));
  let selected = -1,
    tool: Tool = "pen",
    color = PALETTE[0]!,
    stroke = 3,
    radius = 8,
    size = 20;
  let smoothing = 0;
  try {
    const value = Number(localStorage.getItem(SMOOTHING_KEY));
    if (Number.isFinite(value)) smoothing = Math.max(0, Math.min(100, value));
  } catch {}
  let image: HTMLImageElement | null = null,
    width = 0,
    height = 0,
    padding = 0,
    zoom = 1,
    fitted = true;
  let loading = true,
    saving = false,
    closed = false,
    gesture: Gesture | null = null,
    paintFrame = 0;
  let pendingText: AnnotationPoint | null = null;
  let space = false,
    pan: {
      id: number;
      x: number;
      y: number;
      left: number;
      top: number;
    } | null = null;
  let colors = [...PALETTE];
  try {
    const stored = JSON.parse(localStorage.getItem(COLORS_KEY) || "[]");
    if (Array.isArray(stored))
      colors = [
        ...new Set([
          ...PALETTE,
          ...stored
            .filter((c) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c))
            .map((c) => c.toLowerCase())
            .slice(-8),
        ]),
      ];
  } catch {}
  let lastState = "",
    sourceScale = 1;
  const dialog = document.createElement("dialog");
  dialog.dataset.annotationEditor = "";
  dialog.setAttribute("aria-label", "Draw on screenshot");
  dialog.setAttribute("aria-describedby", "annotation-help");
  dialog.innerHTML = `<div class="annotation-tools" role="toolbar" aria-label="Drawing tools">
        <div class="annotation-group" role="group" aria-label="Tools">
          <button type="button" data-tool="select" aria-pressed="false" aria-label="Select and move drawings" data-tooltip="Select / move">${SVG.cursor}</button>
          <button type="button" data-tool="pan" aria-pressed="false" aria-label="Pan image" data-tooltip="Hand / pan image">${SVG.hand}</button>
          <button type="button" data-tool="pen" aria-pressed="true" aria-label="Draw with pen" data-tooltip="Pen">${SVG.edit}</button>
          <button type="button" data-tool="arrow" aria-pressed="false" aria-label="Draw an arrow" data-tooltip="Arrow">${SVG.open}</button>
          <button type="button" data-tool="rectangle" aria-pressed="false" aria-label="Draw a rectangle" data-tooltip="Rectangle">${SVG.box}</button>
          <button type="button" data-tool="text" aria-pressed="false" aria-label="Add text" data-tooltip="Text">${SVG.text}</button>
        </div>
        <button type="button" class="annotation-color" data-command="colors" aria-label="Drawing color" aria-haspopup="dialog" aria-expanded="false" aria-controls="annotation-colors" data-tooltip="Drawing color"></button>
        <div class="annotation-properties">
          <label data-property="width" data-tooltip="Stroke width"><span aria-hidden="true">${SVG.minus}</span><input type="number" data-field="width" min="1" max="${LIMITS.maxWidth}" step="1" value="3" aria-label="Stroke width in image pixels"></label>
          <label data-property="smoothing" data-tooltip="Pen smoothing — new strokes only"><span aria-hidden="true">${SVG.sliders}</span><input type="range" data-field="smoothing" min="0" max="100" step="10" value="0" aria-label="Pen smoothing"><output class="annotation-smoothing">0%</output></label>
          <label data-property="radius" data-tooltip="Corner radius" hidden><span aria-hidden="true">${SVG.box}</span><input type="number" data-field="radius" min="0" step="1" value="8" aria-label="Rectangle corner radius in image pixels"></label>
          <label data-property="size" data-tooltip="Text size" hidden><span aria-hidden="true">${SVG.text}</span><input type="number" data-field="size" min="1" max="${LIMITS.maxTextSize}" step="1" value="20" aria-label="Text size in image pixels"></label>
          <label data-property="mark" hidden><select data-field="mark" aria-label="Select an editable drawing"><option value="-1">No drawing selected</option></select></label>
          <button type="button" data-command="delete" aria-label="Delete selected drawing" data-tooltip="Delete selected drawing" hidden>${SVG.trash}</button>
        </div>
        <div class="annotation-group" role="group" aria-label="History">
          <button type="button" data-command="undo" aria-label="Undo drawing" data-tooltip="Undo (⌘/Ctrl Z)">${SVG.reply}</button>
          <button type="button" data-command="redo" aria-label="Redo drawing" data-tooltip="Redo (⌘/Ctrl Shift Z)">${SVG.ref}</button>
          <button type="button" data-command="clear" aria-label="Clear all drawings" data-tooltip="Clear all drawings">${SVG.trash}</button>
        </div>
        <div class="annotation-group annotation-zoom-tools" role="group" aria-label="Zoom">
          <button type="button" data-command="out" aria-label="Zoom out" data-tooltip="Zoom out (−)">${SVG.minus}</button>
          <button type="button" data-command="actual" class="annotation-zoom" aria-label="Actual image size" data-tooltip="100% (1)">100%</button>
          <button type="button" data-command="in" aria-label="Zoom in" data-tooltip="Zoom in (+)">${SVG.plus}</button>
          <button type="button" data-command="fit" aria-label="Fit image" data-tooltip="Fit image (0)">${SVG.fit}</button>
        </div>
        <div class="annotation-group annotation-commit" role="group" aria-label="Finish drawing">
          <button type="button" data-command="apply" class="annotation-apply" aria-label="Apply drawing" data-tooltip="Apply drawing">${SVG.check}</button>
          <button type="button" data-command="cancel" aria-label="Close drawing editor" data-tooltip="Close drawing editor (Esc)">${SVG.x}</button>
        </div>
      </div>
      <div id="annotation-colors" class="annotation-colors" popover="auto" role="dialog" aria-label="Drawing colors">
        <div class="annotation-palette" role="group" aria-label="Saved drawing colors"></div>
        <label>Custom color <input type="color" data-field="color" value="${color}" aria-label="Custom drawing color"></label>
      </div>
      <label class="annotation-text-label" hidden><textarea data-field="text" rows="2" maxlength="${LIMITS.maxText}" aria-label="Text to draw" placeholder="Type text, then click to place it"></textarea></label>
      <p id="annotation-help" class="annotation-help">White margins are drawable blank space, not page context. Wheel or pinch to zoom; hold Space and drag to pan. Select a drawing to move it or edit its properties.</p>
      <div class="annotation-viewport"><div class="annotation-surface"><canvas tabindex="0" aria-label="Screenshot drawing canvas. Choose a tool and drag to draw; text is placed with a click."></canvas><div class="annotation-source-outline" aria-hidden="true"></div></div></div>
      <div class="annotation-feedback"><div class="annotation-message" role="status" aria-live="polite">Loading original screenshot…</div>
        <div class="annotation-error" role="alert" hidden></div><button type="button" data-command="retry" hidden>Retry image load</button></div>`;
  const find = <T extends Element>(selector: string) =>
    dialog.querySelector<T>(selector)!;
  const canvas = find<HTMLCanvasElement>("canvas"),
    viewport = find<HTMLElement>(".annotation-viewport");
  const surface = find<HTMLElement>(".annotation-surface"),
    outline = find<HTMLElement>(".annotation-source-outline");
  const message = find<HTMLElement>(".annotation-message"),
    error = find<HTMLElement>(".annotation-error");
  const markSelect = find<HTMLSelectElement>('[data-field="mark"]'),
    text = find<HTMLTextAreaElement>('[data-field="text"]');
  const field = (name: string) =>
    find<HTMLInputElement>('[data-field="' + name + '"]');
  const button = (name: string) =>
    find<HTMLButtonElement>('[data-command="' + name + '"]');
  const colorPopup = find<HTMLElement>(".annotation-colors");
  const context = canvas.getContext("2d");
  const dirty = () => JSON.stringify(marks) !== initial;
  function emit() {
    const state = {
      open: !closed,
      dirty: !closed && dirty(),
      busy: !closed && (loading || saving),
    };
    const json = JSON.stringify(state);
    if (json !== lastState) {
      lastState = json;
      document.dispatchEvent(
        new CustomEvent("lcr:annotation-state", { detail: state }),
      );
    }
  }
  function fail(reason: unknown) {
    error.textContent =
      reason instanceof Error ? reason.message : String(reason);
    error.hidden = false;
  }
  function clearError() {
    error.hidden = true;
    error.textContent = "";
  }
  function sync() {
    const busy = loading || saving;
    dialog
      .querySelectorAll<
        | HTMLButtonElement
        | HTMLInputElement
        | HTMLTextAreaElement
        | HTMLSelectElement
      >("button,input,textarea,select")
      .forEach((el) => {
        el.disabled =
          busy &&
          !(
            el instanceof HTMLButtonElement &&
            el.dataset.command === "cancel" &&
            !saving
          );
      });
    button("undo").disabled = busy || !undo.length;
    button("redo").disabled = busy || !redo.length;
    button("clear").disabled = busy || !marks.length;
    button("delete").disabled = busy || selected < 0;
    button("apply").disabled = busy || !image;
    button("in").disabled = busy || zoom >= 8;
    button("out").disabled = busy || zoom <= 0.01;
    const applyLabel = saving
      ? "Applying drawing…"
      : marks.length
        ? "Apply drawing"
        : "Apply without drawings";
    button("apply").setAttribute("aria-label", applyLabel);
    button("apply").dataset.tooltip = applyLabel;
    button("apply").toggleAttribute("data-dirty", dirty());
    button("colors").style.setProperty("--annotation-color", color);
    dialog
      .querySelectorAll<HTMLButtonElement>("[data-tool]")
      .forEach((el) =>
        el.setAttribute("aria-pressed", String(el.dataset.tool === tool)),
      );
    dialog
      .querySelectorAll<HTMLButtonElement>("[data-color]")
      .forEach((el) =>
        el.setAttribute(
          "aria-pressed",
          String(el.dataset.color === color.toLowerCase()),
        ),
      );
    field("color").value = color;
    field("width").value = String(stroke);
    field("radius").value = String(radius);
    field("size").value = String(size);
    field("smoothing").value = String(smoothing);
    field("smoothing").setAttribute("aria-valuetext", smoothing + "%");
    find<HTMLOutputElement>(".annotation-smoothing").value = smoothing + "%";
    const current = marks[selected];
    const activeTool = current?.tool ?? tool;
    find<HTMLElement>('[data-property="width"]').hidden =
      activeTool === "text" || activeTool === "select" || activeTool === "pan";
    find<HTMLElement>('[data-property="radius"]').hidden =
      activeTool !== "rectangle";
    find<HTMLElement>('[data-property="size"]').hidden = activeTool !== "text";
    find<HTMLElement>('[data-property="mark"]').hidden = tool !== "select";
    find<HTMLElement>('[data-property="smoothing"]').hidden = tool !== "pen";
    button("colors").hidden = tool === "pan";
    find<HTMLElement>(".annotation-text-label").hidden = activeTool !== "text";
    button("delete").hidden = selected < 0;
    canvas.style.cursor =
      space || tool === "pan"
        ? "grab"
        : tool === "select"
          ? "move"
          : tool === "text"
            ? "text"
            : "crosshair";
    emit();
  }
  function refreshMarks() {
    markSelect.replaceChildren(new Option("No drawing selected", "-1"));
    marks.forEach((mark, i) =>
      markSelect.add(new Option(i + 1 + " · " + mark.tool, String(i))),
    );
    markSelect.value = String(selected);
  }
  function select(index: number) {
    selected = index >= 0 && index < marks.length ? index : -1;
    const mark = marks[selected];
    if (mark) {
      color = mark.color;
      if (mark.tool === "text") {
        size = mark.size;
        text.value = mark.text;
      } else stroke = mark.width;
      if (mark.tool === "rectangle") radius = mark.radius;
    }
    markSelect.value = String(selected);
    sync();
    paint();
  }
  function commit(next: AnnotationMark[], nextSelected = -1) {
    if (JSON.stringify(next) === JSON.stringify(marks)) {
      select(nextSelected);
      return;
    }
    undo.push(marks);
    if (undo.length > 100) undo.shift();
    redo.length = 0;
    marks = next;
    selected = nextSelected;
    pendingText = null;
    const current = marks[selected];
    if (current?.tool === "rectangle") radius = current.radius;
    refreshMarks();
    sync();
    paint();
  }
  function history(back: boolean) {
    cancelGesture();
    pendingText = null;
    const from = back ? undo : redo,
      to = back ? redo : undo;
    const next = from.pop();
    if (!next) {
      paint();
      return;
    }
    to.push(marks);
    marks = next;
    selected = -1;
    refreshMarks();
    sync();
    paint();
  }
  function bounds(mark: AnnotationMark): Bounds {
    if (mark.tool === "text") {
      const lines = mark.text.split("\n");
      if (context) context.font = mark.size + "px sans-serif";
      return {
        x: mark.at.x,
        y: mark.at.y,
        width: Math.max(
          1,
          ...lines.map(
            (line) =>
              context?.measureText(line).width ?? line.length * mark.size,
          ),
        ),
        height: lines.length * mark.size * 1.25,
      };
    }
    const points = mark.tool === "pen" ? mark.points : [mark.from, mark.to];
    let x = Infinity,
      y = Infinity,
      right = -Infinity,
      bottom = -Infinity;
    for (const p of points) {
      x = Math.min(x, p.x);
      y = Math.min(y, p.y);
      right = Math.max(right, p.x);
      bottom = Math.max(bottom, p.y);
    }
    return { x, y, width: right - x, height: bottom - y };
  }
  function drawMark(ctx: CanvasRenderingContext2D, mark: AnnotationMark) {
    ctx.save();
    ctx.strokeStyle = mark.color;
    ctx.fillStyle = mark.color;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (mark.tool === "text") {
      ctx.font = mark.size + "px sans-serif";
      ctx.textBaseline = "top";
      mark.text
        .split("\n")
        .forEach((line, i) =>
          ctx.fillText(line, mark.at.x, mark.at.y + i * mark.size * 1.25),
        );
    } else {
      ctx.lineWidth = mark.width;
      ctx.beginPath();
      if (mark.tool === "pen") {
        const first = mark.points[0]!;
        if (mark.points.length === 1) {
          ctx.arc(first.x, first.y, mark.width / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.moveTo(first.x, first.y);
          for (let i = 1; i < mark.points.length; i++) {
            const p = mark.points[i]!;
            ctx.lineTo(p.x, p.y);
          }
          ctx.stroke();
        }
      } else if (mark.tool === "rectangle") {
        const x = Math.min(mark.from.x, mark.to.x),
          y = Math.min(mark.from.y, mark.to.y);
        const w = Math.abs(mark.to.x - mark.from.x),
          h = Math.abs(mark.to.y - mark.from.y);
        ctx.roundRect(x, y, w, h, Math.min(mark.radius, w / 2, h / 2));
        ctx.stroke();
      } else {
        const angle = Math.atan2(
          mark.to.y - mark.from.y,
          mark.to.x - mark.from.x,
        );
        const length = Math.min(
          Math.hypot(mark.to.x - mark.from.x, mark.to.y - mark.from.y),
          Math.max(10 * sourceScale, mark.width * 4),
        );
        ctx.moveTo(mark.from.x, mark.from.y);
        ctx.lineTo(mark.to.x, mark.to.y);
        ctx.moveTo(
          mark.to.x - length * Math.cos(angle - Math.PI / 6),
          mark.to.y - length * Math.sin(angle - Math.PI / 6),
        );
        ctx.lineTo(mark.to.x, mark.to.y);
        ctx.lineTo(
          mark.to.x - length * Math.cos(angle + Math.PI / 6),
          mark.to.y - length * Math.sin(angle + Math.PI / 6),
        );
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  function render(ctx: CanvasRenderingContext2D, guides: boolean) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    if (image) ctx.drawImage(image, padding, padding);
    marks.forEach((mark, i) => {
      if (!gesture || !gesture.move || i !== gesture.index) drawMark(ctx, mark);
    });
    if (gesture) drawMark(ctx, gesture.mark);
    if (guides && selected >= 0) {
      const b = bounds(gesture?.move ? gesture.mark : marks[selected]!);
      ctx.save();
      ctx.strokeStyle = "#2563eb";
      ctx.lineWidth = 1 / zoom;
      ctx.setLineDash([5 / zoom, 4 / zoom]);
      ctx.strokeRect(
        b.x - 4 / zoom,
        b.y - 4 / zoom,
        b.width + 8 / zoom,
        b.height + 8 / zoom,
      );
      ctx.restore();
    }
    if (guides && pendingText) {
      ctx.save();
      ctx.strokeStyle = "#2563eb";
      ctx.lineWidth = 1 / zoom;
      ctx.beginPath();
      ctx.moveTo(pendingText.x - 6 / zoom, pendingText.y);
      ctx.lineTo(pendingText.x + 6 / zoom, pendingText.y);
      ctx.moveTo(pendingText.x, pendingText.y - 6 / zoom);
      ctx.lineTo(pendingText.x, pendingText.y + 6 / zoom);
      ctx.stroke();
      ctx.restore();
    }
  }
  function paint() {
    if (paintFrame || !image || !context || closed) return;
    paintFrame = requestAnimationFrame(() => {
      paintFrame = 0;
      if (closed) return;
      try {
        render(context, true);
      } catch (reason) {
        fail(reason);
      }
    });
  }
  function setZoom(
    value: number,
    fit = false,
    anchor?: { x: number; y: number },
  ) {
    if (!image || gesture || pan) return;
    const view = viewport.getBoundingClientRect(),
      before = canvas.getBoundingClientRect();
    const at = anchor ?? {
      x: view.left + viewport.clientWidth / 2,
      y: view.top + viewport.clientHeight / 2,
    };
    const x = (at.x - before.left) / zoom,
      y = (at.y - before.top) / zoom;
    zoom = Math.max(0.01, Math.min(8, value));
    fitted = fit;
    canvas.style.width = width * zoom + "px";
    canvas.style.height = height * zoom + "px";
    surface.style.width = width * zoom + "px";
    surface.style.height = height * zoom + "px";
    Object.assign(outline.style, {
      left: padding * zoom + "px",
      top: padding * zoom + "px",
      width: image.naturalWidth * zoom + "px",
      height: image.naturalHeight * zoom + "px",
    });
    button("actual").textContent = Math.round(zoom * 100) + "%";
    button("in").disabled = loading || saving || zoom >= 8;
    button("out").disabled = loading || saving || zoom <= 0.01;
    if (fit) {
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
    } else {
      const after = canvas.getBoundingClientRect();
      viewport.scrollLeft += after.left + x * zoom - at.x;
      viewport.scrollTop += after.top + y * zoom - at.y;
    }
    paint();
  }
  function fit() {
    if (!image) return;
    const css = getComputedStyle(viewport);
    setZoom(
      Math.min(
        1,
        (viewport.clientWidth -
          parseFloat(css.paddingLeft) -
          parseFloat(css.paddingRight)) /
          width,
        (viewport.clientHeight -
          parseFloat(css.paddingTop) -
          parseFloat(css.paddingBottom)) /
          height,
      ),
      true,
    );
  }
  const resize = new ResizeObserver(() => {
    if (fitted) fit();
    if (colorPopup.matches(":popover-open")) positionColors();
  });
  viewport.addEventListener(
    "wheel",
    (event) => {
      if (loading || saving || gesture || pan || !image) return;
      event.preventDefault();
      const delta =
        event.deltaY *
        (event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? viewport.clientHeight
            : 1);
      setZoom(
        zoom * Math.exp(-Math.max(-100, Math.min(100, delta)) * 0.01),
        false,
        { x: event.clientX, y: event.clientY },
      );
    },
    { passive: false },
  );
  function endPan() {
    if (!pan) return;
    const id = pan.id;
    pan = null;
    viewport.classList.remove("panning");
    if (viewport.hasPointerCapture(id)) viewport.releasePointerCapture(id);
  }
  viewport.addEventListener(
    "pointerdown",
    (event) => {
      if (
        loading ||
        saving ||
        !image ||
        gesture ||
        pan ||
        !(
          event.button === 1 ||
          ((space || tool === "pan") && event.button === 0)
        )
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      canvas.focus({ preventScroll: true });
      pan = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        left: viewport.scrollLeft,
        top: viewport.scrollTop,
      };
      viewport.setPointerCapture(event.pointerId);
      viewport.classList.add("panning");
    },
    true,
  );
  viewport.addEventListener("pointermove", (event) => {
    if (pan?.id !== event.pointerId) return;
    viewport.scrollLeft = pan.left + pan.x - event.clientX;
    viewport.scrollTop = pan.top + pan.y - event.clientY;
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
    viewport.addEventListener(type, endPan);
  function onBlur() {
    space = false;
    endPan();
    cancelGesture();
    canvas.style.cursor =
      tool === "pan"
        ? "grab"
        : tool === "select"
          ? "move"
          : tool === "text"
            ? "text"
            : "crosshair";
  }
  function onKeyUp(event: KeyboardEvent) {
    if (event.code === "Space") {
      space = false;
      canvas.style.cursor =
        tool === "pan"
          ? "grab"
          : tool === "select"
            ? "move"
            : tool === "text"
              ? "text"
              : "crosshair";
    }
  }
  function point(event: PointerEvent): AnnotationPoint {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(width, ((event.clientX - rect.left) * width) / rect.width),
      ),
      y: Math.max(
        0,
        Math.min(height, ((event.clientY - rect.top) * height) / rect.height),
      ),
    };
  }
  function cancelGesture() {
    if (!gesture) return;
    const id = gesture.id;
    gesture = null;
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    paint();
  }
  function pointCount() {
    return marks.reduce(
      (sum, mark) => sum + (mark.tool === "pen" ? mark.points.length : 0),
      0,
    );
  }
  function moved(mark: AnnotationMark, dx: number, dy: number): AnnotationMark {
    const b = bounds(mark);
    dx = Math.max(
      -b.x,
      Math.min(width - b.x - Math.min(b.width, width - b.x), dx),
    );
    dy = Math.max(
      -b.y,
      Math.min(height - b.y - Math.min(b.height, height - b.y), dy),
    );
    const translate = (p: AnnotationPoint) => ({ x: p.x + dx, y: p.y + dy });
    if (mark.tool === "text") return { ...mark, at: translate(mark.at) };
    if (mark.tool === "pen")
      return { ...mark, points: mark.points.map(translate) };
    return { ...mark, from: translate(mark.from), to: translate(mark.to) };
  }
  canvas.addEventListener("pointerdown", (event) => {
    if (
      loading ||
      saving ||
      !image ||
      gesture ||
      tool === "pan" ||
      event.button !== 0 ||
      !event.isPrimary
    )
      return;
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    clearError();
    const at = point(event);
    if (tool === "select") {
      const tolerance = 8 / zoom;
      let index = -1;
      for (let i = marks.length - 1; i >= 0; i--) {
        const b = bounds(marks[i]!);
        if (
          at.x >= b.x - tolerance &&
          at.x <= b.x + b.width + tolerance &&
          at.y >= b.y - tolerance &&
          at.y <= b.y + b.height + tolerance
        ) {
          index = i;
          break;
        }
      }
      select(index);
      if (index < 0) return;
      gesture = {
        id: event.pointerId,
        start: at,
        mark: marks[index]!,
        index,
        move: true,
        points: 0,
      };
    } else {
      if (marks.length >= LIMITS.maxMarks) {
        fail(
          "This drawing has reached the " +
            LIMITS.maxMarks +
            " mark limit. Delete a mark before drawing more.",
        );
        return;
      }
      if (tool === "text") {
        if (!text.value.trim()) {
          pendingText = at;
          select(-1);
          text.focus();
          paint();
          return;
        }
        commit(
          [...marks, { tool: "text", color, at, text: text.value, size }],
          marks.length,
        );
        return;
      }
      if (tool === "pen" && pointCount() >= LIMITS.maxPoints) {
        fail(
          "This drawing has reached the pen point limit. Delete a pen stroke before drawing more.",
        );
        return;
      }
      const mark: AnnotationMark =
        tool === "pen"
          ? { tool, color, width: stroke, points: [at] }
          : tool === "rectangle"
            ? { tool, color, width: stroke, from: at, to: at, radius: 0 }
            : { tool: "arrow", color, width: stroke, from: at, to: at };
      selected = -1;
      refreshMarks();
      sync();
      gesture = {
        id: event.pointerId,
        start: at,
        mark,
        index: -1,
        move: false,
        points: pointCount(),
      };
    }
    canvas.setPointerCapture(event.pointerId);
    paint();
  });
  function updateGesture(event: PointerEvent) {
    if (!gesture || gesture.id !== event.pointerId) return;
    const at = point(event);
    if (gesture.move) {
      gesture.mark = moved(
        marks[gesture.index]!,
        at.x - gesture.start.x,
        at.y - gesture.start.y,
      );
    } else if (gesture.mark.tool === "pen") {
      const points = gesture.mark.points,
        last = points[points.length - 1]!;
      const distance = Math.hypot(at.x - last.x, at.y - last.y);
      if (distance < 0.5) return;
      if (gesture.points + points.length >= LIMITS.maxPoints) {
        cancelGesture();
        fail(
          "That stroke exceeded the pen point limit and was discarded. Use shorter strokes or delete an existing stroke.",
        );
        return;
      }
      // A screen-space low-pass filter steadies new strokes equally at every zoom level.
      const weight = smoothing
        ? distance / (distance + ((smoothing / 100) * 12) / zoom)
        : 1;
      points.push({
        x: last.x + (at.x - last.x) * weight,
        y: last.y + (at.y - last.y) * weight,
      });
    } else if (gesture.mark.tool === "rectangle") {
      gesture.mark = {
        ...gesture.mark,
        to: at,
        radius: Math.min(
          radius,
          Math.abs(at.x - gesture.start.x) / 2,
          Math.abs(at.y - gesture.start.y) / 2,
        ),
      };
    } else if (gesture.mark.tool === "arrow")
      gesture.mark = { ...gesture.mark, to: at };
    paint();
  }
  canvas.addEventListener("pointermove", (event) => {
    if (gesture) {
      event.preventDefault();
      updateGesture(event);
    }
  });
  canvas.addEventListener("pointerup", (event) => {
    if (!gesture || gesture.id !== event.pointerId) return;
    updateGesture(event);
    if (!gesture) return;
    const done = gesture;
    gesture = null;
    if (canvas.hasPointerCapture(event.pointerId))
      canvas.releasePointerCapture(event.pointerId);
    if (done.mark.tool === "pen" && !done.move && smoothing) {
      const points = done.mark.points,
        at = point(event),
        last = points[points.length - 1]!;
      if (Math.hypot(at.x - last.x, at.y - last.y) > 0.5) {
        if (done.points + points.length < LIMITS.maxPoints) points.push(at);
        else points[points.length - 1] = at;
      }
    }
    if (done.move) {
      commit(
        marks.map((mark, i) => (i === done.index ? done.mark : mark)),
        done.index,
      );
      return;
    }
    if (
      (done.mark.tool === "arrow" || done.mark.tool === "rectangle") &&
      Math.hypot(
        done.mark.to.x - done.mark.from.x,
        done.mark.to.y - done.mark.from.y,
      ) < 1
    ) {
      paint();
      return;
    }
    commit([...marks, done.mark], marks.length);
  });
  canvas.addEventListener("pointercancel", cancelGesture);
  canvas.addEventListener("lostpointercapture", cancelGesture);
  function changeProperty(name: string, value: string) {
    const numeric = Number(value);
    if (name === "smoothing") {
      smoothing = Math.max(
        0,
        Math.min(100, Number.isFinite(numeric) ? numeric : smoothing),
      );
      try {
        localStorage.setItem(SMOOTHING_KEY, String(smoothing));
      } catch {}
      sync();
      return;
    }
    if (name === "color") color = value.toLowerCase();
    if (name === "width")
      stroke = Math.max(
        1,
        Math.min(LIMITS.maxWidth, Number.isFinite(numeric) ? numeric : stroke),
      );
    if (name === "radius")
      radius = Math.max(
        0,
        Math.min(
          LIMITS.maxDimension,
          Number.isFinite(numeric) ? numeric : radius,
        ),
      );
    if (name === "size")
      size = Math.max(
        1,
        Math.min(LIMITS.maxTextSize, Number.isFinite(numeric) ? numeric : size),
      );
    const mark = marks[selected];
    if (mark) {
      let next: AnnotationMark = mark;
      if (name === "color") next = { ...mark, color };
      if (name === "width" && mark.tool !== "text")
        next = { ...mark, width: stroke };
      if (name === "radius" && mark.tool === "rectangle")
        next = {
          ...mark,
          radius: Math.min(
            radius,
            Math.abs(mark.to.x - mark.from.x) / 2,
            Math.abs(mark.to.y - mark.from.y) / 2,
          ),
        };
      if (name === "size" && mark.tool === "text") next = { ...mark, size };
      if (name === "text" && mark.tool === "text") {
        if (!value.trim()) {
          fail(
            "Text must not be empty. Use Delete selected to remove the drawing.",
          );
          text.value = mark.text;
          return;
        }
        next = { ...mark, text: value };
      }
      commit(
        marks.map((item, i) => (i === selected ? next : item)),
        selected,
      );
    } else sync();
  }
  dialog.addEventListener("change", (event) => {
    const target = event.target as HTMLInputElement;
    if (!target.dataset.field || loading || saving) return;
    if (target.dataset.field === "mark") {
      pendingText = null;
      tool = "select";
      select(Number(target.value));
    } else {
      changeProperty(target.dataset.field, target.value);
      if (target.dataset.field === "color") {
        const value = target.value.toLowerCase();
        colors = [
          ...new Set([
            ...PALETTE,
            ...colors
              .filter((c) => !PALETTE.includes(c) && c !== value)
              .slice(-7),
            value,
          ]),
        ];
        try {
          localStorage.setItem(
            COLORS_KEY,
            JSON.stringify(colors.filter((c) => !PALETTE.includes(c))),
          );
        } catch {}
        renderColors();
        colorPopup.hidePopover();
      }
    }
  });
  field("smoothing").addEventListener("input", () => {
    if (!loading && !saving)
      changeProperty("smoothing", field("smoothing").value);
  });
  text.addEventListener("input", () => {
    if (loading || saving) return;
    if (pendingText && text.value.trim()) {
      commit(
        [
          ...marks,
          { tool: "text", color, at: pendingText, text: text.value, size },
        ],
        marks.length,
      );
    } else if (marks[selected]?.tool === "text")
      changeProperty("text", text.value);
  });
  const palette = find<HTMLElement>(".annotation-palette");
  function renderColors() {
    palette.replaceChildren();
    colors.forEach((value) => {
      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.dataset.color = value;
      swatch.style.setProperty("--annotation-color", value);
      swatch.setAttribute("aria-label", "Use color " + value);
      swatch.dataset.tooltip = "Color " + value;
      swatch.setAttribute("aria-pressed", String(value === color));
      palette.append(swatch);
    });
  }
  function positionColors() {
    const at = button("colors").getBoundingClientRect(),
      box = colorPopup.getBoundingClientRect();
    colorPopup.style.left =
      Math.max(0, Math.min(innerWidth - box.width, at.left)) + "px";
    colorPopup.style.top =
      (at.bottom + box.height <= innerHeight
        ? at.bottom
        : Math.max(0, at.top - box.height)) + "px";
  }
  colorPopup.addEventListener("toggle", () =>
    button("colors").setAttribute(
      "aria-expanded",
      String(colorPopup.matches(":popover-open")),
    ),
  );
  renderColors();
  function requestClose() {
    if (saving) return;
    cancelGesture();
    if (
      dirty() &&
      !window.confirm(
        "Discard your drawing changes? The original screenshot will be kept.",
      )
    )
      return;
    dialog.close();
  }
  async function save() {
    if (loading || saving || !image || !context) return;
    cancelGesture();
    clearError();
    saving = true;
    sync();
    try {
      if (!marks.length) await apply(null);
      else {
        const proposal = {
          image: "images/annotation.png",
          width: image.naturalWidth,
          height: image.naturalHeight,
          padding,
          marks,
        };
        if (!webAnnotation(proposal))
          throw new Error(
            "The drawing exceeds the supported annotation limits. Reduce its size or remove drawings and try again.",
          );
        // Export separately so selection handles and the editor's screenshot outline never enter the PNG.
        const output = document.createElement("canvas");
        output.width = width;
        output.height = height;
        const ctx = output.getContext("2d");
        if (!ctx) throw new Error("The browser could not create a PNG canvas.");
        let blob: Blob;
        try {
          render(ctx, false);
          const encoded = Promise.withResolvers<Blob>();
          output.toBlob(
            (result) =>
              result
                ? encoded.resolve(result)
                : encoded.reject(
                    new Error(
                      "The browser could not encode this drawing as PNG.",
                    ),
                  ),
            "image/png",
          );
          blob = await encoded.promise;
        } finally {
          output.width = 0;
          output.height = 0;
        }
        const ref = await upload(blob);
        const annotation = webAnnotation({ ...proposal, image: ref });
        if (!annotation)
          throw new Error(
            "The uploaded drawing did not return a valid PNG reference.",
          );
        await apply(annotation);
      }
      dialog.close();
    } catch (reason) {
      fail(reason);
    } finally {
      saving = false;
      if (!closed) sync();
    }
  }
  dialog.addEventListener("click", (event) => {
    const target = (event.target as Element).closest<HTMLButtonElement>(
      "button",
    );
    if (!target || target.disabled) return;
    if (target.dataset.command === "cancel") {
      requestClose();
      return;
    }
    if (loading || saving) return;
    if (target.dataset.tool) {
      cancelGesture();
      pendingText = null;
      tool = target.dataset.tool as Tool;
      select(-1);
      if (tool === "text") text.focus();
      return;
    }
    if (target.dataset.color) {
      changeProperty("color", target.dataset.color);
      colorPopup.hidePopover();
      return;
    }
    switch (target.dataset.command) {
      case "undo":
        history(true);
        break;
      case "redo":
        history(false);
        break;
      case "clear":
        cancelGesture();
        commit([]);
        break;
      case "delete":
        cancelGesture();
        commit(marks.filter((_, i) => i !== selected));
        break;
      case "colors":
        colorPopup.togglePopover();
        if (colorPopup.matches(":popover-open")) positionColors();
        break;
      case "in":
        setZoom(zoom * 1.25);
        break;
      case "out":
        setZoom(zoom / 1.25);
        break;
      case "fit":
        fit();
        break;
      case "actual":
        setZoom(1);
        break;
      case "apply":
        void save();
        break;
    }
  });
  function onKey(event: KeyboardEvent) {
    if (closed) return;
    // Capture at the window before note/page shortcut handlers can consume Escape or save/undo.
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (colorPopup.matches(":popover-open")) colorPopup.hidePopover();
      else requestClose();
      return;
    }
    const target = event.target as HTMLElement;
    const typing =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      target.isContentEditable;
    if (!typing && event.code === "Space") {
      event.preventDefault();
      event.stopImmediatePropagation();
      space = true;
      canvas.style.cursor = "grab";
      return;
    }
    if (!typing && ["+", "=", "-", "0", "1"].includes(event.key)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!loading && !saving) {
        if (event.key === "0") fit();
        else
          setZoom(
            event.key === "1"
              ? 1
              : event.key === "-"
                ? zoom / 1.25
                : zoom * 1.25,
          );
      }
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (
        !typing &&
        (event.key.toLowerCase() === "z" || event.key.toLowerCase() === "y")
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!loading && !saving)
          history(event.key.toLowerCase() === "z" && !event.shiftKey);
        return;
      }
    }
    if (!typing && (event.key === "Delete" || event.key === "Backspace")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!loading && !saving && selected >= 0)
        commit(marks.filter((_, i) => i !== selected));
      return;
    }
    if (event.key !== "Tab") event.stopImmediatePropagation();
  }
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    requestClose();
  });
  dialog.addEventListener(
    "close",
    () => {
      closed = true;
      endPan();
      cancelGesture();
      cancelAnimationFrame(paintFrame);
      resize.disconnect();
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
      image = null;
      canvas.width = 0;
      canvas.height = 0;
      dialog.remove();
      emit();
      if (previous?.isConnected) {
        previous.focus({ preventScroll: true });
        if (
          caret &&
          caret.start !== null &&
          caret.end !== null &&
          (previous instanceof HTMLTextAreaElement ||
            previous instanceof HTMLInputElement)
        ) {
          try {
            previous.setSelectionRange(
              caret.start,
              caret.end,
              caret.direction ?? undefined,
            );
          } catch {
            /* Some input types have no text selection. */
          }
        }
      }
      resolve();
    },
    { once: true },
  );
  async function load() {
    loading = true;
    clearError();
    button("retry").hidden = true;
    message.hidden = false;
    message.textContent = "Loading original screenshot…";
    sync();
    try {
      if (!context)
        throw new Error("This browser does not support a 2D drawing canvas.");
      const src = attachSrc(capture.area);
      if (!src)
        throw new Error("The original screenshot attachment is unavailable.");
      const source = new Image();
      const decoded = Promise.withResolvers<void>();
      source.onload = () => decoded.resolve();
      source.onerror = () =>
        decoded.reject(
          new Error(
            "Could not load the original screenshot. Retry when the server is available.",
          ),
        );
      source.src = src;
      await decoded.promise;
      if (closed) return;
      const naturalWidth = source.naturalWidth,
        naturalHeight = source.naturalHeight;
      if (!naturalWidth || !naturalHeight)
        throw new Error(
          "The original screenshot has no decodable image pixels.",
        );
      sourceScale = naturalWidth / capture.rect.width;
      padding = saved ? saved.padding : Math.round(64 * sourceScale);
      width = naturalWidth + 2 * padding;
      height = naturalHeight + 2 * padding;
      if (
        !Number.isFinite(sourceScale) ||
        sourceScale <= 0 ||
        padding > LIMITS.maxPadding ||
        width > LIMITS.maxDimension ||
        height > LIMITS.maxDimension ||
        width * height > LIMITS.maxPixels
      )
        throw new Error(
          "This screenshot is too large to annotate safely (maximum " +
            LIMITS.maxDimension +
            " pixels per side and " +
            LIMITS.maxPixels / 1048576 +
            " megapixels including padding). Capture a smaller area.",
        );
      if (
        saved &&
        (saved.width !== naturalWidth ||
          saved.height !== naturalHeight ||
          !webAnnotation(saved))
      )
        throw new Error(
          "The saved drawing does not match the original screenshot or exceeds supported limits.",
        );
      image = source;
      canvas.width = width;
      canvas.height = height;
      stroke = Math.min(
        LIMITS.maxWidth,
        Math.max(1, Math.round(3 * sourceScale)),
      );
      radius = Math.round(8 * sourceScale);
      size = Math.min(
        LIMITS.maxTextSize,
        Math.max(1, Math.round(20 * sourceScale)),
      );
      message.textContent = "";
      message.hidden = true;
      fit();
      paint();
    } catch (reason) {
      if (!closed) {
        fail(reason);
        message.textContent =
          "Original screenshot could not be opened for drawing.";
        button("retry").hidden = false;
      }
    } finally {
      loading = false;
      if (!closed) sync();
    }
  }
  button("retry").addEventListener("click", () => {
    if (!loading && !saving) void load();
  });
  document.body.append(dialog);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("blur", onBlur);
  refreshMarks();
  sync();
  try {
    dialog.showModal();
    resize.observe(viewport);
    void load();
  } catch (reason) {
    dialog.remove();
    closed = true;
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("blur", onBlur);
    resize.disconnect();
    emit();
    resolve();
    throw reason;
  }
  return promise;
}
