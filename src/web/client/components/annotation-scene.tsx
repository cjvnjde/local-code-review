import Konva from "konva";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import {
  Arrow,
  Circle,
  Ellipse,
  Group,
  Image,
  Layer,
  Line,
  Path,
  Rect,
  Stage,
  Text,
} from "react-konva";
import type {
  AnnotationMark,
  AnnotationPoint,
} from "../../../shared/web-annotation.ts";
import {
  calloutLabel,
  markBounds,
  markHandles,
  textLines,
} from "./annotation-geometry.ts";

type PathMark = Extract<AnnotationMark, { tool: "path" }>;
export interface AnnotationSceneModel {
  image: HTMLImageElement;
  width: number;
  height: number;
  padding: number;
  sourceScale: number;
  zoom: number;
  marks: AnnotationMark[];
  hidden: ReadonlySet<AnnotationMark>;
  original: boolean;
  textEditing: boolean;
  selected: number;
  selectedNode: number;
  selecting: boolean;
  gesture: {
    mark: AnnotationMark;
    index: number;
    move: boolean;
    path?: boolean;
  } | null;
  pathDraft: PathMark | null;
  pendingText: AnnotationPoint | null;
}
type Measure = (text: string, size: number) => number;
const points = (...values: AnnotationPoint[]) =>
  values.flatMap(({ x, y }) => [x, y]);
const box = (from: AnnotationPoint, to: AnnotationPoint) => ({
  x: Math.min(from.x, to.x),
  y: Math.min(from.y, to.y),
  width: Math.abs(to.x - from.x),
  height: Math.abs(to.y - from.y),
});
function contrastInk(color: string) {
  const channels = [1, 3, 5].map((start) => {
    const channel = parseInt(color.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722 >
    0.179
    ? "#000000"
    : "#ffffff";
}
function pathData(mark: PathMark) {
  const first = mark.nodes[0];
  if (!first) return "";
  const commands = [`M ${first.x} ${first.y}`];
  for (let i = 0; i < mark.nodes.length - (mark.closed ? 0 : 1); i++) {
    const from = mark.nodes[i]!,
      to = mark.nodes[(i + 1) % mark.nodes.length]!;
    const a = from.out ?? from,
      b = to.in ?? to;
    commands.push(
      from.out || to.in
        ? `C ${a.x} ${a.y} ${b.x} ${b.y} ${to.x} ${to.y}`
        : `L ${to.x} ${to.y}`,
    );
  }
  if (mark.closed) commands.push("Z");
  return commands.join(" ");
}
function DrawingArrow({
  mark,
  scale,
  hit,
}: {
  mark: Extract<AnnotationMark, { tool: "arrow" | "callout" }>;
  scale: number;
  hit: number;
}) {
  const length = Math.min(
    Math.hypot(mark.to.x - mark.from.x, mark.to.y - mark.from.y),
    Math.max(10 * scale, mark.width * 4),
  );
  return (
    <Arrow
      points={points(mark.from, mark.to)}
      stroke={mark.color}
      fill={mark.color}
      strokeWidth={mark.width}
      lineCap="round"
      lineJoin="round"
      pointerLength={length * Math.cos(Math.PI / 6)}
      pointerWidth={length}
      hitStrokeWidth={hit}
    />
  );
}
function TextLines({
  lines,
  x,
  y,
  size,
  color,
  outline,
  scale = 1,
}: {
  lines: string[];
  x: number;
  y: number;
  size: number;
  color: string;
  outline?: boolean;
  scale?: number;
}) {
  return lines.map((line, i) => (
    <Text
      key={i}
      x={x}
      y={y + i * size * 1.25}
      text={line}
      fontFamily="sans-serif"
      fontSize={size}
      fill={color}
      stroke={outline ? contrastInk(color) : undefined}
      strokeWidth={outline ? Math.max(2 * scale, size * 0.12) : 0}
      fillAfterStrokeEnabled
      wrap="none"
    />
  ));
}
/** A callout is one editable mark composed entirely of ordinary Konva nodes. */
function Callout({
  mark,
  scale,
  hit,
  measure,
}: {
  mark: Extract<AnnotationMark, { tool: "callout" }>;
  scale: number;
  hit: number;
  measure: Measure;
}) {
  const label = calloutLabel(mark, measure);
  return (
    <Group>
      <DrawingArrow mark={mark} scale={scale} hit={hit} />
      <Circle
        x={mark.from.x}
        y={mark.from.y}
        radius={mark.size / 2}
        fill={mark.color}
      />
      <Text
        x={mark.from.x - mark.size / 2}
        y={mark.from.y - mark.size / 2}
        width={mark.size}
        height={mark.size}
        text={String(mark.number)}
        fontFamily="sans-serif"
        fontSize={mark.size * 0.5}
        fontStyle="bold"
        align="center"
        verticalAlign="middle"
        fill={contrastInk(mark.color)}
      />
      {mark.label && (
        <Group>
          <Rect
            x={label.x}
            y={label.y}
            width={label.width}
            height={label.height}
            fill="#ffffff"
            stroke={mark.color}
            strokeWidth={mark.width}
          />
          <TextLines
            lines={label.lines}
            x={label.x + label.padding}
            y={label.y + label.padding}
            size={label.size}
            color="#111111"
          />
        </Group>
      )}
    </Group>
  );
}
function DrawingMark({
  mark,
  model,
  measure,
}: {
  mark: AnnotationMark;
  model: AnnotationSceneModel;
  measure: Measure;
}) {
  const scale = model.sourceScale;
  const hit = ("width" in mark ? mark.width : scale) + 16 / model.zoom;
  if (mark.tool === "callout")
    return <Callout mark={mark} scale={scale} hit={hit} measure={measure} />;
  if (mark.tool === "text") {
    const bounds = markBounds(mark, measure),
      padding = mark.background ? Math.max(4, mark.size * 0.2) : 0;
    return (
      <Group>
        {mark.target && (
          <Line
            points={points(mark.target, {
              x: bounds.x + bounds.width / 2,
              y: bounds.y + bounds.height / 2,
            })}
            stroke={mark.color}
            strokeWidth={Math.max(1, scale)}
            hitStrokeWidth={hit}
          />
        )}
        <Rect {...bounds} fill={mark.background ?? "rgba(0,0,0,0)"} />
        <TextLines
          lines={textLines(mark, measure)}
          x={mark.at.x + padding}
          y={mark.at.y + padding}
          size={mark.size}
          color={mark.color}
          outline={mark.outline}
          scale={scale}
        />
      </Group>
    );
  }
  if (mark.tool === "magnifier") {
    const crop = box(mark.from, mark.to),
      destination = markBounds(mark);
    return (
      <Group>
        <Line
          points={[
            crop.x + crop.width / 2,
            crop.y + crop.height / 2,
            destination.x + destination.width / 2,
            destination.y + destination.height / 2,
          ]}
          stroke={mark.color}
          strokeWidth={mark.width}
          hitStrokeWidth={hit}
        />
        <Rect
          {...crop}
          fillEnabled={false}
          stroke={mark.color}
          strokeWidth={mark.width}
          dash={[5 * scale, 3 * scale]}
          hitStrokeWidth={hit}
        />
        <Image
          {...destination}
          image={model.image}
          crop={{
            ...crop,
            x: crop.x - model.padding,
            y: crop.y - model.padding,
          }}
        />
        <Rect
          {...destination}
          fillEnabled={false}
          stroke={mark.color}
          strokeWidth={mark.width}
          hitStrokeWidth={hit}
        />
      </Group>
    );
  }
  const stroke = {
    stroke: mark.color,
    strokeWidth: mark.width,
    hitStrokeWidth: hit,
    lineCap: "round" as const,
    lineJoin: "round" as const,
  };
  if (mark.tool === "pen" || mark.tool === "highlighter") {
    const opacity = mark.tool === "highlighter" ? mark.opacity : 1;
    return mark.points.length === 1 ? (
      <Circle
        x={mark.points[0]!.x}
        y={mark.points[0]!.y}
        radius={mark.width / 2}
        fill={mark.color}
        opacity={opacity}
      />
    ) : (
      <Line {...stroke} points={points(...mark.points)} opacity={opacity} />
    );
  }
  if (mark.tool === "arrow")
    return <DrawingArrow mark={mark} scale={scale} hit={hit} />;
  if (mark.tool === "line")
    return <Line {...stroke} points={points(mark.from, mark.to)} />;
  // Encode alpha in the fill so the border remains fully opaque.
  const fill =
    mark.fill && (mark.opacity ?? 1) > 0
      ? mark.fill +
        Math.round((mark.opacity ?? 1) * 255)
          .toString(16)
          .padStart(2, "0")
      : undefined;
  if (mark.tool === "path")
    return (
      <Path
        {...stroke}
        data={pathData(mark)}
        fill={fill}
        fillEnabled={!!fill}
      />
    );
  const bounds = markBounds(mark);
  if (mark.tool === "rectangle")
    return (
      <Rect
        {...stroke}
        {...bounds}
        cornerRadius={Math.min(
          mark.radius,
          bounds.width / 2,
          bounds.height / 2,
        )}
        fill={fill}
        fillEnabled={!!fill}
      />
    );
  if (mark.tool === "ellipse" && bounds.width && bounds.height)
    return (
      <Ellipse
        {...stroke}
        x={bounds.x + bounds.width / 2}
        y={bounds.y + bounds.height / 2}
        radiusX={bounds.width / 2}
        radiusY={bounds.height / 2}
        fill={fill}
        fillEnabled={!!fill}
      />
    );
  if (mark.tool === "ellipse")
    return (
      <Line
        {...stroke}
        points={[
          bounds.x,
          bounds.y,
          bounds.x + bounds.width,
          bounds.y + bounds.height,
        ]}
      />
    );
  return (
    <Line
      {...stroke}
      points={[
        bounds.x + bounds.width / 2,
        bounds.y,
        bounds.x + bounds.width,
        bounds.y + bounds.height,
        bounds.x,
        bounds.y + bounds.height,
      ]}
      closed
      fill={fill}
      fillEnabled={!!fill}
    />
  );
}
function PathGuides({ path, zoom }: { path: PathMark; zoom: number }) {
  return (
    <Group>
      {path.nodes.map((node, i) => (
        <Group key={i}>
          {[node.in, node.out].map(
            (control, side) =>
              control && (
                <Line
                  key={side}
                  points={points(node, control)}
                  stroke="#2563eb"
                  strokeWidth={1 / zoom}
                />
              ),
          )}
        </Group>
      ))}
    </Group>
  );
}
function Guides({
  model,
  measure,
}: {
  model: AnnotationSceneModel;
  measure: Measure;
}) {
  const { zoom, selected, gesture } = model;
  const current = gesture?.move ? gesture.mark : model.marks[selected];
  const draft = gesture?.path ? (gesture.mark as PathMark) : model.pathDraft;
  return (
    <Layer listening={false}>
      {current && !model.hidden.has(model.marks[selected]!) && (
        <Group>
          <Rect
            {...(() => {
              const b = markBounds(current, measure);
              return {
                x: b.x - 4 / zoom,
                y: b.y - 4 / zoom,
                width: b.width + 8 / zoom,
                height: b.height + 8 / zoom,
              };
            })()}
            stroke="#2563eb"
            strokeWidth={1 / zoom}
            dash={[5 / zoom, 4 / zoom]}
          />
          {model.selecting && (
            <Group>
              {current.tool === "path" && (
                <PathGuides path={current} zoom={zoom} />
              )}
              {markHandles(current, measure).map((handle, i) => {
                const r = (handle.kind === "control" ? 3 : 4) / zoom;
                const fill =
                  handle.kind === "node" && handle.index === model.selectedNode
                    ? "#2563eb"
                    : "#ffffff";
                const style = {
                  stroke: "#2563eb",
                  strokeWidth: 1 / zoom,
                  fill,
                };
                return handle.kind === "control" ? (
                  <Circle
                    key={i}
                    {...style}
                    x={handle.x}
                    y={handle.y}
                    radius={r}
                  />
                ) : (
                  <Rect
                    key={i}
                    {...style}
                    x={handle.x - r}
                    y={handle.y - r}
                    width={2 * r}
                    height={2 * r}
                  />
                );
              })}
            </Group>
          )}
        </Group>
      )}
      {draft && (
        <Group>
          <PathGuides path={draft} zoom={zoom} />
          {draft.nodes.map((node, i) => (
            <Rect
              key={i}
              x={node.x - 4 / zoom}
              y={node.y - 4 / zoom}
              width={8 / zoom}
              height={8 / zoom}
              stroke="#2563eb"
              fill="#ffffff"
              strokeWidth={1 / zoom}
            />
          ))}
        </Group>
      )}
      {model.pendingText && (
        <Line
          points={[
            model.pendingText.x - 6 / zoom,
            model.pendingText.y,
            model.pendingText.x + 6 / zoom,
            model.pendingText.y,
            model.pendingText.x,
            model.pendingText.y,
            model.pendingText.x,
            model.pendingText.y - 6 / zoom,
            model.pendingText.x,
            model.pendingText.y + 6 / zoom,
          ]}
          stroke="#2563eb"
          strokeWidth={1 / zoom}
        />
      )}
    </Layer>
  );
}

/** The same Konva scene owns rendering, hit testing and PNG export for every tool.
 * Saved data remains our validated, portable mark model; never deserialize arbitrary nodes.
 */
export function createAnnotationScene(host: HTMLElement) {
  // Coordinates already use the source image's physical pixels (including HiDPI
  // captures). Avoid allocating another devicePixelRatio-sized copy of each layer.
  Konva.pixelRatio = 1;
  const root = createRoot(host);
  const ruler = new Konva.Text({ fontFamily: "sans-serif" });
  const measure: Measure = (text, size) => {
    ruler.fontSize(size);
    return ruler.measureSize(text).width;
  };
  let stage: Konva.Stage | null = null;
  function render(model: AnnotationSceneModel, exporting = false) {
    host.dataset.width = String(model.width);
    host.dataset.height = String(model.height);
    flushSync(() =>
      root.render(
        <Stage
          ref={(node) => {
            stage = node;
          }}
          width={model.width}
          height={model.height}
          style={{ transform: `scale(${model.zoom})`, transformOrigin: "0 0" }}
        >
          <Layer imageSmoothingEnabled={false}>
            <Rect
              width={model.width}
              height={model.height}
              fill="#ffffff"
              listening={false}
            />
            <Image
              x={model.padding}
              y={model.padding}
              image={model.image}
              listening={false}
            />
            {(!model.original || exporting) &&
              model.marks.map(
                (mark, index) =>
                  (exporting ||
                    (!model.hidden.has(mark) &&
                      !(
                        model.textEditing &&
                        index === model.selected &&
                        mark.tool === "text"
                      ))) &&
                  (!model.gesture?.move ||
                    index !== model.gesture.index ||
                    exporting) && (
                    <Group key={index} markIndex={index}>
                      <DrawingMark
                        mark={mark}
                        model={model}
                        measure={measure}
                      />
                    </Group>
                  ),
              )}
            {!exporting && !model.original && (
              <Group listening={false}>
                {model.pathDraft && !model.gesture?.path && (
                  <DrawingMark
                    mark={model.pathDraft}
                    model={model}
                    measure={measure}
                  />
                )}
                {model.gesture && (
                  <DrawingMark
                    mark={model.gesture.mark}
                    model={model}
                    measure={measure}
                  />
                )}
              </Group>
            )}
          </Layer>
          {!exporting && !model.original && (
            <Guides model={model} measure={measure} />
          )}
        </Stage>,
      ),
    );
    // Konva normally batches to the next frame. Pointer selection and export need the current hit graph now.
    stage!.draw();
  }
  return {
    measure,
    render,
    hit(at: AnnotationPoint) {
      let node: Konva.Node | null = stage?.getIntersection(at) ?? null;
      while (node) {
        const index = node.getAttr("markIndex");
        if (typeof index === "number") return index;
        node = node.getParent();
      }
      return -1;
    },
    async export(model: AnnotationSceneModel): Promise<Blob> {
      try {
        render(model, true);
        const blob = await stage!.toBlob({
          pixelRatio: 1,
          mimeType: "image/png",
          imageSmoothingEnabled: false,
        });
        if (!blob)
          throw new Error("The browser could not encode this drawing as PNG.");
        return blob;
      } finally {
        render(model);
      }
    },
    destroy() {
      root.unmount();
      ruler.destroy();
    },
  };
}
