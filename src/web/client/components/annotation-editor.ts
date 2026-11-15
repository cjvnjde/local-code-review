import { encodeImageDrawing } from "../../../shared/image-drawing.ts";
import {
  ANNOTATION_LIMITS as LIMITS,
  webAnnotation,
  type AnnotationMark,
  type AnnotationPoint,
  type WebAnnotation,
} from "../../../shared/web-annotation.ts";
import {
  editHandle,
  insertPathNode,
  markBounds,
  markHandles,
  moveMark,
  nearestPathSegment,
  smoothNode,
  type AnnotationHandle,
} from "./annotation-geometry.ts";
import {
  attachmentSrc as attachSrc,
  uploadImage as upload,
} from "./attachments.ts";
import {
  mountDrawingEditor,
  type DrawingControlsModel,
  type DrawingTool,
} from "./annotation-controls.tsx";
import { pressureStroke } from "./annotation-pressure.ts";
import {
  createAnnotationScene,
  type AnnotationScene,
  type AnnotationSceneModel,
} from "./annotation-scene.tsx";
import {
  registerView,
  setView,
  setViews,
} from "../navigation/ui-navigation.ts";
import {
  closeImagePreviewForDrawing,
  imageEditorOwners,
} from "./image-preview.ts";
import {
  createAnnotationDraftStore,
  type AnnotationDraft,
  type AnnotationDraftStore,
} from "./annotation-draft.ts";

/** Pixels and optional drawing data, independent of where the image was captured. */
export interface AnnotationSource {
  image: string;
  annotation?: WebAnnotation;
  /** Captured CSS width preserves tool sizing for high-DPI browser screenshots. */
  cssWidth?: number;
  key?: string;
  applyLabel?: "Use drawing" | "Save drawing";
}

type Tool = DrawingTool;
type PathMark = Extract<AnnotationMark, { tool: "path" }>;
type Gesture = {
  id: number;
  start: AnnotationPoint;
  mark: AnnotationMark;
  index: number;
  move: boolean;
  points: number;
  handle?: AnnotationHandle;
  path?: boolean;
  previousPath?: PathMark | null;
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
type ActiveAnnotation = {
  route: string;
  canLeave(next: string | null): boolean;
  close(): void;
};
let activeEditor: ActiveAnnotation | null = null;

registerView(
  "annotation",
  {
    canLeave(next) {
      return !activeEditor || activeEditor.canLeave(next);
    },
    restore(route) {
      if (activeEditor?.route === route) return;
      activeEditor?.close();
      if (route === null) return;
      document.dispatchEvent(
        new CustomEvent("lcr:annotation-restore", { detail: { route } }),
      );
      return activeEditor?.route === route;
    },
  },
  30,
);

/** Opens over the existing note: its textarea, selection and draft DOM are never replaced. */
export function openAnnotation(
  route: string,
  capture: AnnotationSource,
  apply: (annotation: WebAnnotation | null) => Promise<void>,
  scope: { repo: string; read: string } = { repo: location.origin, read: "" },
  owner?: HTMLElement | null,
): Promise<void> {
  if (active) {
    document.querySelector<HTMLElement>("[data-annotation-editor]")?.focus();
    return active;
  }
  const replacePreview = closeImagePreviewForDrawing();
  try {
    active = editAnnotation(route, capture, apply, scope, owner);
  } catch (reason) {
    return Promise.reject(reason);
  }
  setViews({ annotation: route, image: null }, { replace: replacePreview });
  return active;
}

function editAnnotation(
  route: string,
  capture: AnnotationSource,
  apply: (annotation: WebAnnotation | null) => Promise<void>,
  scope: { repo: string; read: string } = { repo: location.origin, read: "" },
  owner?: HTMLElement | null,
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
    selectedNode = -1,
    tool: Tool = "pen",
    color = PALETTE[0]!,
    stroke = 3,
    radius = 8,
    size = 20;
  let opacity = 0.3,
    fill = false,
    fillColor = "#eab308",
    wrap = 240,
    background = false,
    backgroundColor = "#ffffff",
    textOutline = false,
    textLeader = false,
    insetScale = 3,
    textEditing = false,
    original = false,
    heldOriginal = false;
  const hidden = new Set<AnnotationMark>();
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
  let pathDraft: PathMark | null = null;
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
  let discard = false,
    errorMessage = "",
    statusMessage = "",
    retry = false;
  let penMode: "classic" | "pressure" = "classic";
  let draftStore: AnnotationDraftStore | null = null;
  let recoverable: AnnotationDraft | null = null;
  const view = mountDrawingEditor(controlsModel(), {
    command: runCommand,
    tool: chooseTool,
    property: setProperty,
    textInput: onTextInput,
    textBlur: onTextBlur,
  });
  const { dialog, canvas, viewport, surface, outline, text, textLabel } =
    view.elements;
  let scene: AnnotationScene;
  try {
    scene = createAnnotationScene(canvas);
  } catch (reason) {
    view.destroy();
    throw reason;
  }
  if (owner) imageEditorOwners.set(dialog, owner);
  function persistDraft() {
    if (!draftStore || recoverable || closed || saving) return;
    const result =
      dirty() || pendingText
        ? draftStore.save({
            marks,
            path: pathDraft,
            pendingText,
            text: text.value,
          })
        : draftStore.clear();
    if (!result.ok) fail(result.error.message);
  }
  function clearDraft() {
    const result = draftStore?.clear();
    if (result && !result.ok) fail(result.error.message);
  }
  const dirty = () => !!pathDraft || JSON.stringify(marks) !== initial;
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
    errorMessage = reason instanceof Error ? reason.message : String(reason);
    view.render(controlsModel());
  }
  function clearError() {
    errorMessage = "";
    view.render(controlsModel());
  }
  function controlsModel(): DrawingControlsModel {
    const current = marks[selected];
    return {
      tool,
      current,
      selected,
      selectedNode,
      marks,
      hidden,
      colors,
      values: {
        color,
        width: stroke,
        radius,
        size,
        opacity: Math.round(opacity * 100),
        fill,
        "fill-color": fillColor,
        wrap: Math.round(wrap),
        background,
        "background-color": backgroundColor,
        "text-outline": textOutline,
        "text-leader": textLeader,
        scale: insetScale,
        smoothing,
        label: current?.tool === "callout" ? current.label : "",
        "pen-mode":
          current?.tool === "pen"
            ? current.stroke
              ? "pressure"
              : "classic"
            : penMode,
      },
      busy: loading || saving || !!recoverable,
      loading,
      saving,
      undo: !!undo.length || !!pathDraft,
      redo: !!redo.length && !pathDraft,
      dirty: !!pathDraft || JSON.stringify(marks) !== initial,
      hasImage: !!image,
      original: original || heldOriginal,
      path: pathDraft ?? (current?.tool === "path" ? current : null),
      pathDraft: !!pathDraft,
      recoverable: !!recoverable,
      discard,
      zoom,
      applyLabel: capture.applyLabel ?? "Use drawing",
      error: errorMessage,
      retry,
      message: statusMessage,
    };
  }
  function sync() {
    if (closed) return;
    view.render(controlsModel());
    syncTextEditor();
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
  function select(index: number) {
    if (index !== selected) selectedNode = -1;
    if (index !== selected) textEditing = false;
    selected = index >= 0 && index < marks.length ? index : -1;
    const mark = marks[selected];
    if (mark) {
      color = mark.color;
      if (mark.tool === "text") {
        size = mark.size;
        text.value = mark.text;
        wrap = mark.wrap ?? 240 * sourceScale;
        background = !!mark.background;
        backgroundColor = mark.background ?? "#ffffff";
        textOutline = !!mark.outline;
        textLeader = !!mark.target;
      } else stroke = mark.width;
      if (mark.tool === "rectangle") radius = mark.radius;
      if (mark.tool === "callout") size = mark.size;
      if (mark.tool === "highlighter") opacity = mark.opacity;
      if ("fill" in mark) {
        fill = !!mark.fill;
        fillColor = mark.fill ?? fillColor;
        opacity = mark.opacity ?? 0.3;
      } else if (
        ["rectangle", "ellipse", "triangle", "path"].includes(mark.tool)
      )
        fill = false;
      if (mark.tool === "magnifier") insetScale = mark.scale;
    }
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
    if (next.length === marks.length)
      next.forEach((mark, i) => {
        if (hidden.has(marks[i]!)) hidden.add(mark);
      });
    for (const mark of hidden) if (!next.includes(mark)) hidden.delete(mark);
    marks = next;
    selected = nextSelected;
    if (marks[selected]?.tool !== "path") selectedNode = -1;
    pendingText = null;
    const current = marks[selected];
    if (current?.tool === "rectangle") radius = current.radius;
    if (current?.tool === "text") size = current.size;
    sync();
    paint();
    persistDraft();
  }
  function history(back: boolean) {
    cancelGesture();
    if (pathDraft) {
      if (!back) return;
      pathDraft =
        pathDraft.nodes.length > 1
          ? { ...pathDraft, nodes: pathDraft.nodes.slice(0, -1) }
          : null;
      sync();
      paint();
      persistDraft();
      return;
    }
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
    hidden.clear();
    textEditing = false;
    selected = -1;
    sync();
    paint();
    persistDraft();
  }
  const measure = scene.measure;
  const bounds = (mark: AnnotationMark) => markBounds(mark, measure);
  const handles = (mark: AnnotationMark) => markHandles(mark, measure);
  function syncTextEditor() {
    const label = textLabel;
    const mark = marks[selected];
    const at = pendingText ?? (mark?.tool === "text" ? mark.at : null);
    label.hidden =
      !at ||
      !textEditing ||
      original ||
      heldOriginal ||
      (!!mark && hidden.has(mark));
    if (label.hidden || !image || !at) return;
    const textMark = mark?.tool === "text" ? mark : newText(at);
    const b = bounds(textMark);
    Object.assign(label.style, {
      left: at.x * zoom + "px",
      top: at.y * zoom + "px",
      width: Math.max(40, (textMark.wrap ?? b.width) * zoom) + "px",
    });
    const inset = textMark.background
      ? Math.max(4, textMark.size * 0.2) * zoom
      : 0;
    label.style.width =
      Math.max(40, (textMark.wrap ?? b.width) * zoom + inset * 2) + "px";
    text.style.height = "auto";
    Object.assign(text.style, {
      font: textMark.size * zoom + "px/1.25 sans-serif",
      color: textMark.color,
      background: textMark.background ?? "transparent",
      padding: inset + "px",
      textShadow: textMark.outline
        ? "-1px -1px #fff, 1px 1px #fff, -1px 1px #fff, 1px -1px #fff"
        : "none",
      height:
        Math.max(2 * textMark.size * zoom * 1.25, text.scrollHeight) + "px",
    });
  }
  function newText(
    at: AnnotationPoint,
  ): Extract<AnnotationMark, { tool: "text" }> {
    return {
      tool: "text",
      color,
      at,
      text: text.value,
      size,
      wrap: Math.max(1, Math.min(wrap, width - at.x)),
      ...(background ? { background: backgroundColor } : {}),
      ...(textOutline ? { outline: true } : {}),
      ...(textLeader
        ? {
            target: {
              x: Math.min(width, at.x + wrap / 2),
              y: Math.min(height, at.y + size * 4),
            },
          }
        : {}),
    };
  }
  function handleAt(mark: AnnotationMark, at: AnnotationPoint) {
    return handles(mark).find(
      (handle) => Math.hypot(handle.x - at.x, handle.y - at.y) <= 10 / zoom,
    );
  }
  function finishPath(closed = false) {
    cancelGesture();
    if (!pathDraft) return;
    const path = pathDraft;
    if (path.nodes.length < (closed ? 3 : 2)) {
      fail(
        closed
          ? "A closed path needs at least three points."
          : "A path needs at least two points.",
      );
      return;
    }
    pathDraft = null;
    tool = "select";
    selectedNode = -1;
    commit([...marks, { ...path, closed }], marks.length);
  }
  function updatePath(next: PathMark) {
    if (
      pointCount() - markPointCount(marks[selected]!) + markPointCount(next) >
      LIMITS.maxPoints
    ) {
      fail("This edit exceeds the drawing point limit.");
      return;
    }
    commit(
      marks.map((mark, i) => (i === selected ? next : mark)),
      selected,
    );
  }
  function deleteNode() {
    const mark = marks[selected];
    if (mark?.tool !== "path" || selectedNode < 0) return;
    const nodes = mark.nodes.filter((_, i) => i !== selectedNode);
    if (nodes.length < (mark.closed ? 3 : 2)) {
      fail(
        "Deleting that point would leave too few points. Open the path first, or delete the drawing.",
      );
      return;
    }
    selectedNode = -1;
    updatePath({ ...mark, nodes });
  }
  function sceneModel(): AnnotationSceneModel {
    return {
      image: image!,
      width,
      height,
      padding,
      sourceScale,
      zoom,
      marks,
      hidden,
      original: original || heldOriginal,
      textEditing,
      selected,
      selectedNode,
      selecting: tool === "select",
      gesture,
      pathDraft,
      pendingText,
    };
  }
  function paint() {
    if (paintFrame || !image || closed) return;
    paintFrame = requestAnimationFrame(() => {
      paintFrame = 0;
      if (closed) return;
      try {
        scene.render(sceneModel());
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
    surface.style.setProperty("--annotation-padding", padding * zoom + "px");
    Object.assign(outline.style, {
      left: padding * zoom + "px",
      top: padding * zoom + "px",
      width: image.naturalWidth * zoom + "px",
      height: image.naturalHeight * zoom + "px",
    });
    if (fit) {
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
    } else {
      const after = canvas.getBoundingClientRect();
      viewport.scrollLeft += after.left + x * zoom - at.x;
      viewport.scrollTop += after.top + y * zoom - at.y;
    }
    syncTextEditor();
    sync();
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
  let resizeFrame = 0;
  const resize = new ResizeObserver(() => {
    if (!fitted || resizeFrame) return;
    // Fitting also updates the toolbar; finish resize delivery before changing layout.
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      if (fitted) fit();
    });
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
    heldOriginal = false;
    syncTextEditor();
    paint();
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
    if (event.code === "KeyO" || event.key.toLowerCase() === "o") {
      heldOriginal = false;
      sync();
      paint();
    }
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
  function samplePressure(event: PointerEvent) {
    return Number.isFinite(event.pressure)
      ? Math.max(0, Math.min(1, event.pressure))
      : 0.5;
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
    if (gesture.path) pathDraft = gesture.previousPath ?? null;
    gesture = null;
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    sync();
    paint();
  }
  function markPointCount(mark: AnnotationMark) {
    return mark.tool === "pen" || mark.tool === "highlighter"
      ? mark.points.length
      : mark.tool === "path"
        ? mark.nodes.reduce(
            (sum, node) => sum + 1 + Number(!!node.in) + Number(!!node.out),
            0,
          )
        : 0;
  }
  function pointCount() {
    return marks.reduce((sum, mark) => sum + markPointCount(mark), 0);
  }
  canvas.addEventListener("pointerdown", (event) => {
    if (
      loading ||
      saving ||
      recoverable ||
      original ||
      heldOriginal ||
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
    if (tool === "path") {
      if (event.detail > 1) return;
      const first = pathDraft?.nodes[0];
      if (
        first &&
        pathDraft!.nodes.length >= 3 &&
        Math.hypot(first.x - at.x, first.y - at.y) < 10 / zoom
      ) {
        finishPath(true);
        return;
      }
      const last = pathDraft?.nodes.at(-1);
      if (last && Math.hypot(last.x - at.x, last.y - at.y) < 4 / zoom) return;
      if (
        marks.length >= LIMITS.maxMarks ||
        pointCount() + (pathDraft ? markPointCount(pathDraft) : 0) + 3 >
          LIMITS.maxPoints
      ) {
        fail("This drawing has reached its mark or point limit.");
        return;
      }
      const previousPath = pathDraft;
      const node = { ...at, kind: "corner" as const };
      pathDraft = pathDraft
        ? { ...pathDraft, nodes: [...pathDraft.nodes, node] }
        : {
            tool: "path",
            color,
            width: stroke,
            nodes: [node],
            closed: false,
            ...(fill ? { fill: fillColor, opacity } : {}),
          };
      selected = -1;
      gesture = {
        id: event.pointerId,
        start: at,
        mark: pathDraft,
        index: -1,
        move: false,
        points: pointCount(),
        path: true,
        previousPath,
      };
      canvas.setPointerCapture(event.pointerId);
      sync();
      paint();
      return;
    }
    if (tool === "select") {
      const current = marks[selected];
      let handle =
        current && !hidden.has(current) ? handleAt(current, at) : undefined;
      const index = handle
        ? selected
        : (() => {
            // Tool/style changes may have happened since the last animation frame.
            scene.render(sceneModel());
            return scene.hit(at);
          })();
      select(index);
      textEditing = false;
      syncTextEditor();
      if (index < 0) return;
      handle ??= handleAt(marks[index]!, at);
      if (handle?.kind === "node" || handle?.kind === "control")
        selectedNode = handle.index;
      else selectedNode = -1;
      gesture = {
        id: event.pointerId,
        start: at,
        mark: marks[index]!,
        index,
        move: true,
        points: 0,
        handle,
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
        select(-1);
        pendingText = at;
        text.value = "";
        textEditing = true;
        sync();
        text.focus();
        persistDraft();
        paint();
        return;
      }
      if (
        (tool === "pen" || tool === "highlighter") &&
        pointCount() >= LIMITS.maxPoints
      ) {
        fail(
          "This drawing has reached the pen point limit. Delete a pen stroke before drawing more.",
        );
        return;
      }
      if (
        tool === "magnifier" &&
        (at.x < padding ||
          at.y < padding ||
          at.x > width - padding ||
          at.y > height - padding)
      ) {
        fail(
          "Select a detail inside the original screenshot, not its drawing margin.",
        );
        return;
      }
      const shapeFill = fill ? { fill: fillColor, opacity } : {};
      const mark: AnnotationMark =
        tool === "pen" || tool === "highlighter"
          ? ({
              tool,
              color,
              width: stroke,
              points: [at],
              ...(tool === "highlighter" ? { opacity } : {}),
              ...(tool === "pen" && penMode === "pressure"
                ? {
                    stroke: pressureStroke(
                      event.pointerType === "pen" ? "pointer" : "simulated",
                      samplePressure(event),
                    ),
                  }
                : {}),
            } as AnnotationMark)
          : tool === "callout"
            ? {
                tool,
                id: crypto.randomUUID(),
                number:
                  Math.max(
                    0,
                    ...marks.flatMap((m) =>
                      m.tool === "callout" ? [m.number] : [],
                    ),
                  ) + 1,
                label: "",
                color,
                width: stroke,
                size: Math.min(
                  LIMITS.maxTextSize,
                  Math.max(24 * sourceScale, size),
                ),
                from: at,
                to: at,
              }
            : tool === "magnifier"
              ? {
                  tool,
                  color,
                  width: stroke,
                  from: at,
                  to: at,
                  at,
                  scale: insetScale,
                }
              : tool === "rectangle"
                ? {
                    tool,
                    color,
                    width: stroke,
                    from: at,
                    to: at,
                    radius: 0,
                    ...shapeFill,
                  }
                : {
                    tool,
                    color,
                    width: stroke,
                    from: at,
                    to: at,
                    ...(["ellipse", "triangle"].includes(tool)
                      ? shapeFill
                      : {}),
                  };
      selected = -1;
      selectedNode = -1;
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
    if (gesture.path && gesture.mark.tool === "path") {
      const mark = gesture.mark;
      const index = mark.nodes.length - 1;
      const node = mark.nodes[index]!;
      const dx = at.x - gesture.start.x,
        dy = at.y - gesture.start.y;
      if (Math.hypot(dx, dy) > 2 / zoom) {
        const reach = Math.min(
          1,
          dx ? (dx > 0 ? width - node.x : node.x) / Math.abs(dx) : 1,
          dx ? (dx > 0 ? node.x : width - node.x) / Math.abs(dx) : 1,
          dy ? (dy > 0 ? height - node.y : node.y) / Math.abs(dy) : 1,
          dy ? (dy > 0 ? node.y : height - node.y) / Math.abs(dy) : 1,
        );
        gesture.mark = {
          ...mark,
          nodes: mark.nodes.map((p, i) =>
            i !== index
              ? p
              : {
                  x: node.x,
                  y: node.y,
                  kind: "smooth",
                  in: { x: node.x - dx * reach, y: node.y - dy * reach },
                  out: { x: node.x + dx * reach, y: node.y + dy * reach },
                },
          ),
        };
      }
      paint();
      return;
    }
    textEditing = false;
    if (gesture.move) {
      const original = marks[gesture.index]!;
      gesture.mark = gesture.handle
        ? editHandle(
            original,
            gesture.handle,
            at,
            { width, height, padding },
            measure,
          )
        : moveMark(
            original,
            at.x - gesture.start.x,
            at.y - gesture.start.y,
            { width, height },
            measure,
          );
    } else if (
      gesture.mark.tool === "pen" ||
      gesture.mark.tool === "highlighter"
    ) {
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
      if (gesture.mark.tool === "pen" && gesture.mark.stroke)
        gesture.mark.stroke.pressures.push(samplePressure(event));
    } else if (gesture.mark.tool !== "text" && gesture.mark.tool !== "path") {
      let end = at;
      if (
        event.shiftKey &&
        ["rectangle", "ellipse", "triangle"].includes(gesture.mark.tool)
      ) {
        const dx = at.x - gesture.start.x,
          dy = at.y - gesture.start.y;
        const side = Math.min(
          Math.max(Math.abs(dx), Math.abs(dy)),
          dx >= 0 ? width - gesture.start.x : gesture.start.x,
          dy >= 0 ? height - gesture.start.y : gesture.start.y,
        );
        end = {
          x: gesture.start.x + (dx < 0 ? -side : side),
          y: gesture.start.y + (dy < 0 ? -side : side),
        };
      }
      gesture.mark = { ...gesture.mark, to: end };
      if (gesture.mark.tool === "magnifier") {
        const m = gesture.mark;
        m.to = {
          x: Math.max(padding, Math.min(width - padding, end.x)),
          y: Math.max(padding, Math.min(height - padding, end.y)),
        };
        const w = Math.abs(m.to.x - m.from.x),
          h = Math.abs(m.to.y - m.from.y);
        m.scale = Math.max(
          1,
          Math.min(insetScale, width / (w || 1), height / (h || 1)),
        );
        m.at = {
          x: Math.max(
            0,
            Math.min(
              width - w * m.scale,
              Math.max(m.from.x, m.to.x) + 16 * sourceScale,
            ),
          ),
          y: Math.max(
            0,
            Math.min(height - h * m.scale, Math.min(m.from.y, m.to.y)),
          ),
        };
      }
      if (gesture.mark.tool === "rectangle")
        gesture.mark.radius = Math.min(
          radius,
          Math.abs(end.x - gesture.start.x) / 2,
          Math.abs(end.y - gesture.start.y) / 2,
        );
    }
    paint();
  }
  canvas.addEventListener("pointermove", (event) => {
    if (gesture) {
      event.preventDefault();
      updateGesture(event);
    } else if (tool === "select") {
      const mark = marks[selected];
      const handle = mark && handleAt(mark, point(event));
      canvas.style.cursor =
        handle?.kind === "resize"
          ? {
              nw: "nwse",
              se: "nwse",
              ne: "nesw",
              sw: "nesw",
              n: "ns",
              s: "ns",
              e: "ew",
              w: "ew",
            }[handle.edge] + "-resize"
          : handle
            ? "crosshair"
            : "move";
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
    if (done.path && done.mark.tool === "path") {
      pathDraft = done.mark;
      sync();
      paint();
      persistDraft();
      return;
    }
    if (
      (done.mark.tool === "pen" || done.mark.tool === "highlighter") &&
      !done.move &&
      smoothing
    ) {
      const points = done.mark.points,
        at = point(event),
        last = points[points.length - 1]!;
      if (Math.hypot(at.x - last.x, at.y - last.y) > 0.5) {
        if (done.points + points.length < LIMITS.maxPoints) {
          points.push(at);
          if (done.mark.tool === "pen" && done.mark.stroke)
            done.mark.stroke.pressures.push(samplePressure(event));
        } else {
          points[points.length - 1] = at;
          if (done.mark.tool === "pen" && done.mark.stroke)
            done.mark.stroke.pressures[points.length - 1] =
              samplePressure(event);
        }
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
      done.mark.tool === "magnifier" &&
      (Math.abs(done.mark.to.x - done.mark.from.x) < 1 ||
        Math.abs(done.mark.to.y - done.mark.from.y) < 1)
    ) {
      paint();
      return;
    }
    if (
      done.mark.tool !== "pen" &&
      done.mark.tool !== "highlighter" &&
      done.mark.tool !== "callout" &&
      done.mark.tool !== "path" &&
      done.mark.tool !== "text" &&
      Math.hypot(
        done.mark.to.x - done.mark.from.x,
        done.mark.to.y - done.mark.from.y,
      ) < 1
    ) {
      paint();
      return;
    }
    if (
      done.mark.tool !== "pen" &&
      done.mark.tool !== "highlighter" &&
      done.mark.tool !== "callout"
    )
      tool = "select";
    commit([...marks, done.mark], marks.length);
  });
  canvas.addEventListener("pointercancel", cancelGesture);
  canvas.addEventListener("lostpointercapture", cancelGesture);
  canvas.addEventListener("dblclick", (event) => {
    if (loading || saving || gesture) return;
    event.preventDefault();
    if (pathDraft) {
      finishPath();
      return;
    }
    const mark = marks[selected];
    if (mark?.tool === "text" && tool === "select") {
      textEditing = true;
      text.value = mark.text;
      sync();
      paint();
      text.focus();
      return;
    }
    if (tool !== "select" || mark?.tool !== "path") return;
    const at = point(event as unknown as PointerEvent);
    if (handleAt(mark, at)) return;
    const best = nearestPathSegment(mark, at, 10 / zoom);
    if (best) {
      selectedNode = best.index + 1;
      updatePath(insertPathNode(mark, best.index, best.t));
    }
  });
  function changeProperty(name: string, value: string) {
    if (name === "pen-mode") {
      if (selected < 0) penMode = value === "pressure" ? "pressure" : "classic";
      sync();
      return;
    }
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
    if (name === "opacity") opacity = Math.max(0, Math.min(1, numeric / 100));
    if (name === "fill") fill = value === "true";
    if (name === "fill-color") fillColor = value;
    if (name === "wrap")
      wrap = Math.max(1, Math.min(LIMITS.maxDimension, numeric || 1));
    if (name === "background") background = value === "true";
    if (name === "background-color") backgroundColor = value;
    if (name === "text-outline") textOutline = value === "true";
    if (name === "text-leader") textLeader = value === "true";
    if (name === "scale") insetScale = Math.max(1, Math.min(8, numeric || 1));
    if (pathDraft) {
      pathDraft = {
        ...pathDraft,
        color,
        width: stroke,
        ...(fill
          ? { fill: fillColor, opacity }
          : { fill: undefined, opacity: undefined }),
      };
      sync();
      paint();
      persistDraft();
      return;
    }
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
      if (name === "size" && (mark.tool === "text" || mark.tool === "callout"))
        next = { ...mark, size };
      if (name === "label" && mark.tool === "callout")
        next = { ...mark, label: value };
      if (mark.tool === "highlighter" && name === "opacity")
        next = { ...mark, opacity };
      if (
        (mark.tool === "rectangle" ||
          mark.tool === "ellipse" ||
          mark.tool === "triangle" ||
          mark.tool === "path") &&
        ["fill", "fill-color", "opacity"].includes(name)
      )
        next = {
          ...mark,
          ...(fill
            ? { fill: fillColor, opacity }
            : { fill: undefined, opacity: undefined }),
        };
      if (mark.tool === "text") {
        if (name === "wrap") next = { ...mark, wrap };
        if (name === "background" || name === "background-color")
          next = {
            ...mark,
            background: background ? backgroundColor : undefined,
          };
        if (name === "text-outline") next = { ...mark, outline: textOutline };
        if (name === "text-leader")
          next = {
            ...mark,
            target: textLeader
              ? (mark.target ?? {
                  x: Math.min(width, mark.at.x + wrap / 2),
                  y: Math.min(height, mark.at.y + size * 4),
                })
              : undefined,
          };
      }
      if (name === "scale" && mark.tool === "magnifier") {
        const w = Math.abs(mark.to.x - mark.from.x),
          h = Math.abs(mark.to.y - mark.from.y);
        insetScale = Math.max(1, Math.min(insetScale, width / w, height / h));
        next = {
          ...mark,
          scale: insetScale,
          at: {
            x: Math.min(mark.at.x, width - w * insetScale),
            y: Math.min(mark.at.y, height - h * insetScale),
          },
        };
      }
      if (name === "text" && mark.tool === "text") {
        if (!value.trim()) {
          persistDraft();
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
  function setProperty(name: string, value: string) {
    if (loading || saving || recoverable) return;
    if (name === "mark") {
      pendingText = null;
      tool = "select";
      select(Number(value));
      return;
    }
    changeProperty(name, value);
    if (name === "color") {
      const color = value.toLowerCase();
      colors = [
        ...new Set([
          ...PALETTE,
          ...colors
            .filter((c) => !PALETTE.includes(c) && c !== color)
            .slice(-7),
          color,
        ]),
      ];
      try {
        localStorage.setItem(
          COLORS_KEY,
          JSON.stringify(colors.filter((c) => !PALETTE.includes(c))),
        );
      } catch {}
      sync();
    }
  }
  function onTextInput() {
    if (loading || saving) return;
    if (pendingText && text.value.trim()) {
      commit([...marks, newText(pendingText)], marks.length);
    } else if (marks[selected]?.tool === "text")
      changeProperty("text", text.value);
    syncTextEditor();
    persistDraft();
  }
  function onTextBlur() {
    if (closed) return;
    const mark = marks[selected];
    if (mark?.tool === "text" && !text.value.trim()) text.value = mark.text;
    textEditing = false;
    syncTextEditor();
    paint();
  }
  function canLeave(next: string | null) {
    if (saving) return false;
    if (next === route || !(dirty() || gesture || pendingText)) return true;
    discard = true;
    sync();
    return false;
  }
  function close(record = false) {
    finish();
    if (record) setView("annotation", null, { close: true });
  }
  function requestClose() {
    if (canLeave(null)) close(true);
  }
  async function save() {
    if (loading || saving || recoverable || !image) return;
    cancelGesture();
    if (pathDraft) {
      finishPath();
      if (pathDraft) return;
    }
    clearError();
    saving = true;
    sync();
    try {
      if (!marks.length) {
        await apply(null);
        delete capture.annotation;
      } else {
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
        // Export the same Konva scene without guides or preview-only visibility settings.
        const blob = await scene.export(sceneModel());
        const encoded = encodeImageDrawing(
          new Uint8Array(await blob.arrayBuffer()),
          { source: capture.image, annotation: proposal },
        );
        const ref = await upload(
          new Blob([new Uint8Array(encoded).buffer], { type: "image/png" }),
        );
        const annotation = webAnnotation({ ...proposal, image: ref });
        if (!annotation)
          throw new Error(
            "The uploaded drawing did not return a valid PNG reference.",
          );
        await apply(annotation);
        capture.annotation = annotation;
      }
      clearDraft();
      close(true);
    } catch (reason) {
      fail(reason);
    } finally {
      saving = false;
      if (!closed) sync();
    }
  }
  function chooseTool(next: Tool) {
    if (loading || saving || recoverable) return;
    canvas.focus({ preventScroll: true });
    cancelGesture();
    if (pathDraft) {
      if (pathDraft.nodes.length >= 2) finishPath();
      else pathDraft = null;
    }
    pendingText = null;
    const previousTool = tool;
    tool = next;
    textEditing = false;
    if (tool === "highlighter") {
      stroke = Math.min(LIMITS.maxWidth, Math.round(24 * sourceScale));
      color = "#eab308";
    } else if (previousTool === "highlighter") {
      stroke = Math.min(
        LIMITS.maxWidth,
        Math.max(1, Math.round(3 * sourceScale)),
      );
    }
    select(tool === "select" ? selected : -1);
    persistDraft();
  }
  function runCommand(command: string) {
    if (command === "cancel") {
      requestClose();
      return;
    }
    if (loading || saving) return;
    if (recoverable && !["restore-draft", "discard-draft"].includes(command))
      return;
    switch (command) {
      case "retry":
        void load();
        break;
      case "keep-editing":
        discard = false;
        sync();
        canvas.focus({ preventScroll: true });
        break;
      case "discard-changes":
        clearDraft();
        close(true);
        break;
      case "restore-draft": {
        if (!recoverable) break;
        const draft = recoverable;
        recoverable = null;
        undo.push(marks);
        marks = draft.marks;
        pathDraft = draft.path;
        pendingText = draft.pendingText;
        text.value = draft.text;
        tool = pathDraft ? "path" : pendingText ? "text" : "select";
        textEditing = !!pendingText;
        selected = -1;
        hidden.clear();
        sync();
        paint();
        break;
      }
      case "discard-draft":
        clearDraft();
        recoverable = null;
        sync();
        break;
      case "visibility": {
        const mark = marks[selected];
        if (!mark) break;
        if (hidden.has(mark)) hidden.delete(mark);
        else hidden.add(mark);
        sync();
        paint();
        break;
      }
      case "original":
        original = !original;
        sync();
        paint();
        break;
      case "edit-text":
        textEditing = true;
        sync();
        paint();
        text.focus();
        break;
      case "finish-path":
        finishPath();
        break;
      case "close-path": {
        if (pathDraft) finishPath(true);
        else {
          const mark = marks[selected];
          if (mark?.tool === "path")
            updatePath({ ...mark, closed: !mark.closed });
        }
        break;
      }
      case "smooth-node":
      case "corner-node": {
        const mark = marks[selected];
        if (mark?.tool === "path" && selectedNode >= 0)
          updatePath(
            smoothNode(mark, selectedNode, command === "smooth-node", {
              width,
              height,
            }),
          );
        break;
      }
      case "delete-node":
        deleteNode();
        break;
      case "undo":
        history(true);
        break;
      case "redo":
        history(false);
        break;
      case "clear":
        cancelGesture();
        pathDraft = null;
        commit([]);
        break;
      case "delete":
        cancelGesture();
        commit(marks.filter((_, i) => i !== selected));
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
  }
  function onKey(event: KeyboardEvent) {
    if (closed) return;
    // Capture at the window before note/page shortcut handlers can consume Escape or save/undo.
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (view.closePopup()) return;
      if (textEditing) {
        textEditing = false;
        sync();
        paint();
        canvas.focus({ preventScroll: true });
      } else if (gesture) cancelGesture();
      else if (pathDraft) {
        pathDraft = null;
        sync();
        paint();
        persistDraft();
      } else requestClose();
      return;
    }
    const target = event.target as HTMLElement;
    const typing =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      target.isContentEditable;
    // Let Base UI handle roving focus, slider keys, and native field editing.
    // Global canvas shortcuts must not intercept a focused control's activation.
    if (
      target.closest("button, input, textarea, select, [role=slider]") &&
      [
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
        "PageUp",
        "PageDown",
        "Enter",
        " ",
      ].includes(event.key)
    )
      return;
    if (recoverable) {
      if (event.key !== "Tab") event.stopImmediatePropagation();
      return;
    }
    if (
      !typing &&
      !target.closest("button") &&
      event.key === "Enter" &&
      pathDraft
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!loading && !saving) finishPath();
      return;
    }
    if (
      !typing &&
      (event.code === "KeyO" || event.key.toLowerCase() === "o") &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      heldOriginal = true;
      sync();
      paint();
      return;
    }
    if (!typing && !target.closest("button") && event.code === "Space") {
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
      if (!loading && !saving && selected >= 0) {
        if (selectedNode >= 0) deleteNode();
        else commit(marks.filter((_, i) => i !== selected));
      }
      return;
    }
    if (event.key !== "Tab") event.stopImmediatePropagation();
  }
  function finish() {
    if (closed) return;
    closed = true;
    active = null;
    activeEditor = null;
    endPan();
    cancelGesture();
    cancelAnimationFrame(paintFrame);
    resize.disconnect();
    cancelAnimationFrame(resizeFrame);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("pagehide", persistDraft);
    document.removeEventListener("visibilitychange", onVisibility);
    image = null;
    imageEditorOwners.delete(dialog);
    scene.destroy();
    view.destroy();
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
  }
  async function load() {
    loading = true;
    clearError();
    retry = false;
    statusMessage = "Loading original screenshot…";
    sync();
    try {
      if (!capture.image)
        throw new Error(
          "Point selections contain metadata only, with no screenshot to draw on.",
        );
      const src = attachSrc(capture.image);
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
      sourceScale = naturalWidth / (capture.cssWidth ?? naturalWidth);
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
      scene.render(sceneModel());
      stroke = Math.min(
        LIMITS.maxWidth,
        Math.max(1, Math.round(3 * sourceScale)),
      );
      radius = Math.round(8 * sourceScale);
      size = Math.min(
        LIMITS.maxTextSize,
        Math.max(1, Math.round(20 * sourceScale)),
      );
      wrap = Math.min(LIMITS.maxDimension, Math.round(240 * sourceScale));
      if (!draftStore) {
        try {
          draftStore = createAnnotationDraftStore(
            {
              repo: scope.repo,
              read: scope.read,
              route,
              source:
                capture.key ??
                JSON.stringify([capture.image, capture.cssWidth]),
              baseline: initial,
              width: naturalWidth,
              height: naturalHeight,
              padding,
            },
            localStorage,
          );
          const result = draftStore.load();
          if (result.ok) recoverable = result.value;
          else fail(result.error.message);
        } catch (reason) {
          fail(
            "Drawing recovery is unavailable: " +
              (reason instanceof Error ? reason.message : String(reason)),
          );
        }
      }
      statusMessage = "";
      fit();
      paint();
    } catch (reason) {
      if (!closed) {
        fail(reason);
        statusMessage = "Original screenshot could not be opened for drawing.";
        retry = true;
      }
    } finally {
      loading = false;
      if (!closed) sync();
    }
  }
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("blur", onBlur);
  window.addEventListener("pagehide", persistDraft);
  function onVisibility() {
    if (document.visibilityState === "hidden") persistDraft();
  }
  document.addEventListener("visibilitychange", onVisibility);
  try {
    sync();
    activeEditor = { route, canLeave, close };
    resize.observe(viewport);
    void load();
  } catch (reason) {
    finish();
    throw reason;
  }
  return promise;
}
