import {
  createRef,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { Dialog } from "@base-ui/react/dialog";
import { Popover } from "@base-ui/react/popover";
import { Toolbar } from "@base-ui/react/toolbar";
import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { Slider } from "@base-ui/react/slider";
import { Button } from "@base-ui/react/button";
import {
  ArrowUpRight,
  Circle,
  Hand,
  Highlighter,
  MousePointer2,
  Pencil,
  Plus,
  Minus,
  Redo2,
  Undo2,
  Scan,
  Square,
  Triangle,
  Type,
  X,
  ZoomIn,
  Eye,
  GitBranch,
  Hash,
  Slash,
  ChevronDown,
  Palette,
} from "lucide-react";
import {
  ANNOTATION_LIMITS as LIMITS,
  type AnnotationMark,
} from "../../../shared/web-annotation.ts";

export type DrawingTool = AnnotationMark["tool"] | "select" | "pan";
export const TOOL_NAMES: Record<DrawingTool, string> = {
  select: "Select",
  pan: "Pan",
  pen: "Pen",
  highlighter: "Highlighter",
  arrow: "Arrow",
  rectangle: "Rectangle",
  ellipse: "Ellipse",
  triangle: "Triangle",
  line: "Line",
  path: "Vector path",
  text: "Text",
  callout: "Callout",
  magnifier: "Magnifier",
};
const TOOLS = {
  select: [MousePointer2, "Select and edit drawings"],
  pen: [Pencil, "Draw with pen"],
  arrow: [ArrowUpRight, "Draw an arrow"],
  rectangle: [Square, "Draw a rectangle"],
  text: [Type, "Add text"],
  callout: [Hash, "Add numbered callout"],
  highlighter: [Highlighter, "Highlight screenshot"],
  ellipse: [Circle, "Draw a circle or ellipse"],
  triangle: [Triangle, "Draw a triangle"],
  line: [Slash, "Draw a line"],
  path: [GitBranch, "Draw a vector path"],
  magnifier: [ZoomIn, "Magnify screenshot detail"],
  pan: [Hand, "Pan image"],
} as const;
const COMMON: DrawingTool[] = [
  "select",
  "pen",
  "arrow",
  "rectangle",
  "text",
  "callout",
];
const EXTRA: DrawingTool[] = [
  "highlighter",
  "ellipse",
  "triangle",
  "line",
  "path",
  "magnifier",
  "pan",
];
type Popup = "colors" | "more-tools" | "options" | null;
export interface DrawingControlsModel {
  tool: DrawingTool;
  current?: AnnotationMark;
  selected: number;
  selectedNode: number;
  marks: AnnotationMark[];
  hidden: ReadonlySet<AnnotationMark>;
  colors: string[];
  values: Record<string, string | number | boolean>;
  busy: boolean;
  saving: boolean;
  loading: boolean;
  undo: boolean;
  redo: boolean;
  dirty: boolean;
  hasImage: boolean;
  original: boolean;
  path: Extract<AnnotationMark, { tool: "path" }> | null;
  pathDraft: boolean;
  recoverable: boolean;
  discard: boolean;
  zoom: number;
  padding: number;
  applyLabel: string;
  hint: string;
  error: string;
  message: string;
  retry: boolean;
}
interface Actions {
  command(name: string): void;
  tool(tool: DrawingTool): void;
  property(name: string, value: string): void;
  textInput(): void;
  textBlur(): void;
}
interface Refs {
  dialog: RefObject<HTMLDivElement | null>;
  canvas: RefObject<HTMLDivElement | null>;
  viewport: RefObject<HTMLDivElement | null>;
  surface: RefObject<HTMLDivElement | null>;
  outline: RefObject<HTMLDivElement | null>;
  text: RefObject<HTMLTextAreaElement | null>;
  textLabel: RefObject<HTMLLabelElement | null>;
}
function Property({
  name,
  label,
  model,
  actions,
  type = "number",
  min,
  max,
  step = 1,
}: {
  name: string;
  label: string;
  model: DrawingControlsModel;
  actions: Actions;
  type?: string;
  min?: number;
  max?: number;
  step?: number;
}) {
  const caption =
    name === "width" ? "Width" : name === "size" ? "Text size" : label;
  return (
    <label data-property={name}>
      <span>{caption}</span>
      <input
        data-field={name}
        aria-label={label}
        type={type}
        min={min}
        max={max}
        step={step}
        maxLength={name === "label" ? LIMITS.maxCalloutLabel : undefined}
        disabled={model.busy}
        value={
          type === "checkbox" ? undefined : String(model.values[name] ?? "")
        }
        checked={type === "checkbox" ? !!model.values[name] : undefined}
        onChange={(e) =>
          actions.property(
            name,
            type === "checkbox"
              ? String(e.currentTarget.checked)
              : e.currentTarget.value,
          )
        }
      />
    </label>
  );
}
function RangeProperty({
  name,
  label,
  model,
  actions,
  step,
}: {
  name: string;
  label: string;
  model: DrawingControlsModel;
  actions: Actions;
  step: number;
}) {
  return (
    <Slider.Root
      className="annotation-slider"
      data-property={name}
      value={Number(model.values[name])}
      min={0}
      max={100}
      step={step}
      disabled={model.busy}
      onValueChange={(value) => actions.property(name, String(value))}
    >
      <Slider.Label>{label}</Slider.Label>
      <Slider.Control className="annotation-slider-control">
        <Slider.Track className="annotation-slider-track">
          <Slider.Indicator className="annotation-slider-indicator" />
          <Slider.Thumb
            className="annotation-slider-thumb"
            aria-label={label}
            data-field={name}
          />
        </Slider.Track>
      </Slider.Control>
      <Slider.Value
        className={name === "smoothing" ? "annotation-smoothing" : undefined}
      >
        {(value) => `${value[0]}%`}
      </Slider.Value>
    </Slider.Root>
  );
}
function DrawingPopover({
  name,
  label,
  children,
  model,
  popup,
  onPopup,
  refs,
  className = "",
}: {
  name: Exclude<Popup, null>;
  label: string;
  children: ReactNode;
  model: DrawingControlsModel;
  popup: Popup;
  onPopup(value: Popup): void;
  refs: Refs;
  className?: string;
}) {
  return (
    <Popover.Root
      open={popup === name}
      onOpenChange={(open) => onPopup(open ? name : null)}
    >
      <Popover.Trigger
        data-command={name}
        aria-label={label}
        aria-pressed={
          name === "more-tools" ? EXTRA.includes(model.tool) : undefined
        }
        className={
          name === "colors" ? "annotation-color" : "annotation-labeled"
        }
        style={
          name === "colors"
            ? ({ "--annotation-color": model.values.color } as CSSProperties)
            : undefined
        }
        disabled={model.busy}
      >
        {name === "colors" ? (
          <Palette size={16} />
        ) : (
          <>
            {label}
            <ChevronDown size={16} />
          </>
        )}
      </Popover.Trigger>
      <Popover.Portal container={refs.dialog.current} keepMounted>
        <Popover.Positioner
          sideOffset={4}
          align="start"
          className="annotation-popover-positioner"
        >
          <Popover.Popup
            id={`annotation-${name}`}
            className={`annotation-popover annotation-${name} ${className}`}
            aria-label={label}
            finalFocus={false}
            initialFocus={() =>
              refs.dialog.current
                ?.querySelector<HTMLElement>(`#annotation-${name}`)
                ?.querySelector<HTMLElement>(
                  name === "more-tools"
                    ? "[data-tool]"
                    : "input:not(:disabled), select:not(:disabled), [role=slider], button:not(:disabled)",
                ) ?? true
            }
          >
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
export function DrawingEditorView({
  model: m,
  actions: a,
  refs,
  popup,
  onPopup,
}: {
  model: DrawingControlsModel;
  actions: Actions;
  refs: Refs;
  popup: Popup;
  onPopup(value: Popup): void;
}) {
  const activeTool = m.current?.tool ?? m.tool;
  const filled = ["rectangle", "ellipse", "triangle", "path"].includes(
    activeTool,
  );
  const command = (
    name: string,
    label: string,
    children: ReactNode = label,
    disabled = m.busy,
    extra: { className?: string; pressed?: boolean } = {},
  ) => (
    <Button
      data-command={name}
      aria-label={label}
      disabled={disabled}
      className={extra.className}
      aria-pressed={extra.pressed}
      onClick={() => {
        if (popup) {
          onPopup(null);
          refs.canvas.current?.focus({ preventScroll: true });
        }
        a.command(name);
      }}
    >
      {children}
    </Button>
  );
  const property = (
    name: string,
    label: string,
    type = "number",
    min?: number,
    max?: number,
    step?: number,
  ) => (
    <Property
      name={name}
      label={label}
      type={type}
      min={min}
      max={max}
      step={step}
      model={m}
      actions={a}
    />
  );
  const tools = (values: DrawingTool[], expanded = false) => (
    <ToggleGroup
      value={[m.tool]}
      disabled={m.busy}
      onValueChange={(value) => {
        onPopup(null);
        a.tool((value[0] as DrawingTool | undefined) ?? m.tool);
      }}
      className={expanded ? "annotation-extra-tools" : "annotation-group"}
    >
      {values.map((tool) => {
        const [Icon, label] = TOOLS[tool];
        return (
          <Toggle
            key={tool}
            value={tool}
            data-tool={tool}
            aria-label={label}
            title={TOOL_NAMES[tool]}
          >
            <Icon size={16} />
            {expanded && TOOL_NAMES[tool]}
          </Toggle>
        );
      })}
    </ToggleGroup>
  );
  const popoverProps = { model: m, popup, onPopup, refs };
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) a.command("cancel");
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="annotation-backdrop" />
        <Dialog.Popup
          ref={refs.dialog}
          data-annotation-editor=""
          aria-label="Draw on screenshot"
          aria-labelledby={undefined}
          finalFocus={false}
          initialFocus={refs.canvas}
        >
          <div className="annotation-tools">
            <div className="annotation-header">
              <Dialog.Title className="annotation-title">Drawing</Dialog.Title>
              <Toolbar.Root className="annotation-group" aria-label="History">
                <Toolbar.Button
                  render={command(
                    "undo",
                    "Undo drawing",
                    <Undo2 size={16} />,
                    m.busy || !m.undo,
                  )}
                />
                <Toolbar.Button
                  render={command(
                    "redo",
                    "Redo drawing",
                    <Redo2 size={16} />,
                    m.busy || !m.redo,
                  )}
                />
              </Toolbar.Root>
              <div
                className="annotation-group annotation-commit"
                role="group"
                aria-label="Finish drawing"
              >
                <Button
                  data-command="apply"
                  className="annotation-apply"
                  aria-label={m.applyLabel}
                  aria-busy={m.saving}
                  data-dirty={m.dirty ? "" : undefined}
                  disabled={m.busy || !m.hasImage}
                  onClick={() => a.command("apply")}
                >
                  {m.applyLabel}
                </Button>
                {command(
                  "cancel",
                  "Close drawing editor",
                  <X size={16} />,
                  m.saving,
                )}
              </div>
            </div>
            <div className="annotation-context">
              <div className="annotation-state" aria-live="polite">
                <span className="annotation-active-tool">
                  Tool: {TOOL_NAMES[m.tool]}
                </span>
                <span className="annotation-selection">
                  Selected: {m.current ? TOOL_NAMES[m.current.tool] : "None"}
                </span>
              </div>
              {command(
                "original",
                "Show original screenshot",
                <>
                  <Eye size={16} /> Show original
                </>,
                m.busy,
                { className: "annotation-labeled", pressed: m.original },
              )}
            </div>
            <Toolbar.Root
              className="annotation-group annotation-common-tools"
              aria-label="Drawing tools"
            >
              {tools(COMMON)}
              <DrawingPopover
                name="more-tools"
                label="More tools"
                {...popoverProps}
              >
                {tools(EXTRA, true)}
                <div className="annotation-secondary-actions">
                  {command(
                    "clear",
                    "Clear all drawings",
                    undefined,
                    m.busy || (!m.marks.length && !m.pathDraft),
                  )}
                </div>
              </DrawingPopover>
            </Toolbar.Root>
            <div
              className="annotation-properties annotation-primary-properties"
              role="group"
              aria-label="Tool properties"
            >
              {!["pan", "select"].includes(activeTool) && (
                <DrawingPopover
                  name="colors"
                  label="Drawing color"
                  {...popoverProps}
                >
                  <ToggleGroup
                    className="annotation-palette"
                    aria-label="Saved drawing colors"
                    value={[String(m.values.color)]}
                    onValueChange={(value) => {
                      if (value[0]) {
                        a.property("color", value[0]);
                        onPopup(null);
                      }
                    }}
                  >
                    {m.colors.map((color) => (
                      <Toggle
                        key={color}
                        value={color}
                        data-color={color}
                        aria-label={`Use color ${color}`}
                        style={{ "--annotation-color": color } as CSSProperties}
                      />
                    ))}
                  </ToggleGroup>
                  {property("color", "Custom drawing color", "color")}
                </DrawingPopover>
              )}
              {!["text", "select", "pan"].includes(activeTool) &&
                property(
                  "width",
                  "Stroke width in image pixels",
                  "number",
                  1,
                  LIMITS.maxWidth,
                )}
              {["text", "callout"].includes(activeTool) &&
                property(
                  "size",
                  "Text size in image pixels",
                  "number",
                  1,
                  LIMITS.maxTextSize,
                )}
              <DrawingPopover
                name="options"
                label="Options"
                className="annotation-properties"
                {...popoverProps}
              >
                {m.selected < 0 && ["pen", "highlighter"].includes(m.tool) && (
                  <RangeProperty
                    name="smoothing"
                    label="Pen smoothing"
                    model={m}
                    actions={a}
                    step={10}
                  />
                )}
                {activeTool === "pen" && (
                  <>
                    <label data-property="pen-mode">
                      <span>Pen rendering</span>
                      <select
                        data-field="pen-mode"
                        aria-label="Pen rendering"
                        value={String(m.values["pen-mode"])}
                        disabled={m.busy || m.selected >= 0}
                        onChange={(e) =>
                          a.property("pen-mode", e.currentTarget.value)
                        }
                      >
                        <option value="classic">Classic constant width</option>
                        <option value="pressure">Pressure / tapered</option>
                      </select>
                    </label>
                    <p className="annotation-pressure-hint">
                      Pressure / tapered uses pen-reported pressure; mouse and
                      touch use simulated pressure. Existing strokes keep their
                      rendering mode.
                    </p>
                    {m.current?.tool === "pen" && m.current.stroke && (
                      <p role="status">
                        {m.current.stroke.pressure === "pointer"
                          ? "Recorded pen pressure"
                          : "Simulated pressure"}{" "}
                        · perfect-freehand 1.2.3
                      </p>
                    )}
                  </>
                )}
                {activeTool === "rectangle" &&
                  property(
                    "radius",
                    "Rectangle corner radius in image pixels",
                    "number",
                    0,
                    LIMITS.maxDimension,
                  )}
                {(activeTool === "highlighter" || filled) && (
                  <RangeProperty
                    name="opacity"
                    label="Highlight or fill opacity"
                    model={m}
                    actions={a}
                    step={5}
                  />
                )}
                {filled && (
                  <>
                    {property("fill", "Fill shape", "checkbox")}
                    {property("fill-color", "Shape fill color", "color")}
                  </>
                )}
                {activeTool === "text" && (
                  <>
                    {property(
                      "wrap",
                      "Text wrapping width",
                      "number",
                      1,
                      LIMITS.maxDimension,
                    )}
                    {property("background", "Text background", "checkbox")}
                    {property(
                      "background-color",
                      "Text background color",
                      "color",
                    )}
                    {property("text-outline", "Outline text", "checkbox")}
                    {property(
                      "text-leader",
                      "Connect text to target",
                      "checkbox",
                    )}
                  </>
                )}
                {activeTool === "callout" &&
                  property("label", "Callout label", "text")}
                {activeTool === "magnifier" &&
                  property(
                    "scale",
                    "Detail magnification",
                    "number",
                    1,
                    8,
                    0.5,
                  )}
                {!!m.marks.length &&
                  (m.tool === "select" || m.selected >= 0) && (
                    <label data-property="mark">
                      <span>Drawing</span>
                      <select
                        data-field="mark"
                        aria-label="Select an editable drawing"
                        disabled={m.busy}
                        value={m.selected}
                        onChange={(e) =>
                          a.property("mark", e.currentTarget.value)
                        }
                      >
                        <option value={-1}>No drawing selected</option>
                        {m.marks.map((mark, i) => (
                          <option key={i} value={i}>
                            {i + 1} ·{" "}
                            {mark.tool === "callout"
                              ? `Callout ${mark.number}${mark.label ? `: ${mark.label}` : ""}`
                              : mark.tool}
                            {m.hidden.has(mark) ? " (hidden)" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                {m.current?.tool === "text" &&
                  command("edit-text", "Edit text in place", "Edit text")}
                {m.selected >= 0 && (
                  <>
                    {command(
                      "delete",
                      "Delete selected drawing",
                      "Delete drawing",
                    )}
                    {command(
                      "visibility",
                      m.current && m.hidden.has(m.current)
                        ? "Show selected drawing"
                        : "Hide selected drawing",
                      m.current && m.hidden.has(m.current)
                        ? "Show drawing"
                        : "Hide drawing",
                    )}
                  </>
                )}
                {m.path && (
                  <div
                    className="annotation-path-tools"
                    data-path-tools
                    role="group"
                    aria-label="Path editing"
                  >
                    {m.pathDraft &&
                      command(
                        "finish-path",
                        "Finish open path",
                        "Finish path",
                        m.busy || m.path.nodes.length < 2,
                      )}
                    {command(
                      "close-path",
                      m.path.closed ? "Open path" : "Close path",
                      undefined,
                      m.busy || m.path.nodes.length < 3,
                      { pressed: m.path.closed },
                    )}
                    {command(
                      "smooth-node",
                      "Smooth selected path point",
                      "Smooth point",
                      m.busy || m.pathDraft || m.selectedNode < 0,
                    )}
                    {command(
                      "corner-node",
                      "Make selected path point a corner",
                      "Corner point",
                      m.busy || m.pathDraft || m.selectedNode < 0,
                    )}
                    {command(
                      "delete-node",
                      "Delete selected path point",
                      "Delete point",
                      m.busy || m.pathDraft || m.selectedNode < 0,
                    )}
                  </div>
                )}
              </DrawingPopover>
            </div>
          </div>
          {m.discard && (
            <div
              className="annotation-discard annotation-recovery"
              role="alert"
            >
              <span>
                Discard your drawing changes? The original screenshot will be
                kept.
              </span>
              {command("keep-editing", "Keep editing", undefined, false)}
              {command("discard-changes", "Discard drawing", undefined, false)}
            </div>
          )}
          <Toolbar.Root
            className="annotation-group annotation-zoom-tools"
            aria-label="Zoom"
          >
            <Toolbar.Button
              render={command(
                "out",
                "Zoom out",
                <Minus size={16} />,
                m.busy || m.zoom <= 0.01,
              )}
            />
            <Toolbar.Button
              render={command(
                "actual",
                "Actual image size",
                `${Math.round(m.zoom * 100)}%`,
                m.busy,
                { className: "annotation-zoom" },
              )}
            />
            <Toolbar.Button
              render={command(
                "in",
                "Zoom in",
                <Plus size={16} />,
                m.busy || m.zoom >= 8,
              )}
            />
            <Toolbar.Button
              render={command("fit", "Fit image", <Scan size={16} />)}
            />
          </Toolbar.Root>
          {m.recoverable && (
            <div className="annotation-recovery" role="status">
              <span>Unfinished drawing found.</span>
              {command(
                "restore-draft",
                "Restore draft",
                undefined,
                m.loading || m.saving,
              )}
              {command(
                "discard-draft",
                "Discard draft",
                undefined,
                m.loading || m.saving,
              )}
            </div>
          )}
          <p className="annotation-gesture-hint">{m.hint}</p>
          <p className="annotation-padding-hint" hidden={!m.padding}>
            Striped margins: drawing space, not captured content.
          </p>
          <Dialog.Description id="annotation-help" className="annotation-help">
            Select a drawing to resize it using handles. Drag line endpoints or
            path points and curve handles. Double-click a path segment to add a
            point. Path tool: click points, drag for curves, Enter or
            double-click to finish; click the first point to close. Shift draws
            squares and circles. Escape cancels an active gesture or unfinished
            path. Striped margins are drawing space, not captured content; the
            stripes and labels are not exported. Hold O or use Show original to
            compare. Wheel to zoom; Space and drag to pan.
          </Dialog.Description>
          <div ref={refs.viewport} className="annotation-viewport">
            <div ref={refs.surface} className="annotation-surface">
              <div
                ref={refs.canvas}
                data-drawing-surface
                tabIndex={0}
                role="img"
                aria-label="Screenshot drawing canvas. Select to resize or edit points. Path: click points, drag for curves, Enter to finish."
              />
              <div className="annotation-padding" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
              </div>
              <div
                ref={refs.outline}
                className="annotation-source-outline"
                aria-hidden="true"
              />
              <label
                ref={refs.textLabel}
                className="annotation-text-label"
                hidden
              >
                <textarea
                  ref={refs.text}
                  data-field="text"
                  rows={2}
                  maxLength={LIMITS.maxText}
                  aria-label="Text to draw"
                  placeholder="Type your label"
                  disabled={m.busy}
                  onInput={a.textInput}
                  onBlur={a.textBlur}
                />
              </label>
            </div>
          </div>
          <div className="annotation-feedback">
            <div
              className="annotation-message"
              role="status"
              aria-live="polite"
              hidden={!m.message}
            >
              {m.message}
            </div>
            <div className="annotation-error" role="alert" hidden={!m.error}>
              {m.error}
            </div>
            {m.retry &&
              command(
                "retry",
                "Retry image load",
                undefined,
                m.loading || m.saving,
              )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** React owns controls and modal lifecycle; the controller owns only scene gestures and text positioning. */
export function mountDrawingEditor(
  initial: DrawingControlsModel,
  actions: Actions,
) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const refs: Refs = {
    dialog: createRef(),
    canvas: createRef(),
    viewport: createRef(),
    surface: createRef(),
    outline: createRef(),
    text: createRef(),
    textLabel: createRef(),
  };
  let model = initial,
    popup: Popup = null;
  const render = () =>
    flushSync(() =>
      root.render(
        <DrawingEditorView
          model={model}
          actions={actions}
          refs={refs}
          popup={popup}
          onPopup={onPopup}
        />,
      ),
    );
  function onPopup(value: Popup) {
    popup = value;
    render();
  }
  function destroy() {
    root.unmount();
    host.remove();
  }
  try {
    render();
    const dialog = refs.dialog.current,
      canvas = refs.canvas.current,
      viewport = refs.viewport.current,
      surface = refs.surface.current,
      outline = refs.outline.current,
      text = refs.text.current,
      textLabel = refs.textLabel.current;
    // The imperative scene must only receive committed DOM, never nullable React refs.
    if (
      !dialog?.isConnected ||
      !canvas ||
      !viewport ||
      !surface ||
      !outline ||
      !text ||
      !textLabel
    )
      throw new Error("The drawing editor could not mount its controls.");
    return {
      elements: { dialog, canvas, viewport, surface, outline, text, textLabel },
      render(next: DrawingControlsModel) {
        model = next;
        render();
      },
      closePopup() {
        if (!popup) return false;
        const command = popup;
        onPopup(null);
        dialog
          .querySelector<HTMLElement>(`[data-command="${command}"]`)
          ?.focus({ preventScroll: true });
        return true;
      },
      destroy,
    };
  } catch (reason) {
    destroy();
    throw reason;
  }
}
