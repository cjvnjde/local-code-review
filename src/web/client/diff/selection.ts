import { useEffect, useRef, useState, type RefObject } from "react";
import type { DiffFile, ReviewComment } from "../../../shared/review-types.ts";
import { atStart, charRange } from "./drag.ts";
import { makeComment } from "./model.ts";
import { itemKey } from "./reading-model.ts";

export interface CodeSelection {
  path: string;
  hash: string;
  from: number;
  to: number;
  ca?: number;
  cb?: number;
}
interface Press {
  id: number;
  file: DiffFile;
  from: number;
  origin: number;
  to: number;
  x: number;
  y: number;
  px: number;
  py: number;
  cell: HTMLElement | null;
  off: number | null;
  extended: boolean;
  wandered: boolean;
  previous: CodeSelection | null;
}
function offsetAt(cell: HTMLElement, node: Node, offset: number) {
  if (!cell.contains(node)) return null;
  const range = document.createRange();
  range.setStart(cell, 0);
  range.setEnd(node, offset);
  return range.toString().length;
}
function caretAt(cell: HTMLElement, x: number, y: number) {
  const documentWithCaret = document as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const caret = documentWithCaret.caretPositionFromPoint?.(x, y);
  if (caret) return offsetAt(cell, caret.offsetNode, caret.offset);
  const range = documentWithCaret.caretRangeFromPoint?.(x, y);
  return range ? offsetAt(cell, range.startContainer, range.startOffset) : null;
}
function nativeRange(press: Press) {
  const selected = window.getSelection();
  if (
    !press.cell ||
    !selected ||
    selected.isCollapsed ||
    selected.rangeCount !== 1
  )
    return null;
  const range = selected.getRangeAt(0);
  const from = offsetAt(press.cell, range.startContainer, range.startOffset),
    to = offsetAt(press.cell, range.endContainer, range.endOffset);
  return from == null || to == null
    ? null
    : charRange(press.file.rows[press.origin]!.text, from, to);
}

export function useCodeSelection(
  pane: RefObject<HTMLDivElement | null>,
  files: DiffFile[],
  submit: (comment: ReviewComment) => boolean | void,
) {
  const [selection, setSelection] = useState<CodeSelection | null>(null);
  const [pressed, setPressed] = useState<string | null>(null);
  const press = useRef<Press | null>(null);
  const latest = useRef({ files, submit, selection });
  latest.current = { files, submit, selection };
  useEffect(() => {
    const root = pane.current;
    if (!root) return;
    let frame = 0;
    function paint(current: Press) {
      setSelection({
        path: current.file.path,
        hash: current.file.hash,
        from: current.from,
        to: current.to,
      });
    }
    function locate(x: number, y: number) {
      const current = press.current;
      if (!current) return;
      current.px = x;
      current.py = y;
      const row = document
        .elementFromPoint(x, y)
        ?.closest<HTMLElement>('[data-diff-kind="row"][data-row-index]');
      if (!row || row.dataset.filePath !== current.file.path) return;
      const index = Number(row.dataset.rowIndex);
      if (current.file.rows[index]?.t === "hunk") return;
      current.to = index;
      if (index !== current.origin) {
        current.wandered = true;
        root!.dataset.selectingRows = "true";
        window.getSelection()?.removeAllRanges();
      }
      paint(current);
    }
    function autoScroll() {
      const current = press.current;
      if (!current || !root) return;
      const bounds = root.getBoundingClientRect();
      const head =
        root.querySelector<HTMLElement>('[data-sticky="true"]')?.offsetHeight ||
        0;
      const delta =
        current.py < bounds.top + head + 24
          ? -Math.min(28, (bounds.top + head + 24 - current.py) / 2)
          : current.py > bounds.bottom - 24
            ? Math.min(28, (current.py - bounds.bottom + 24) / 2)
            : 0;
      if (delta) {
        root.scrollTop += delta;
        locate(
          current.px,
          Math.max(
            bounds.top + head + 2,
            Math.min(bounds.bottom - 2, current.py),
          ),
        );
      }
      frame = requestAnimationFrame(autoScroll);
    }
    function down(event: PointerEvent) {
      if (
        event.button !== 0 ||
        event.altKey ||
        !(event.target instanceof Element) ||
        event.target.closest("[data-row-action]")
      )
        return;
      const row = event.target.closest<HTMLElement>(
        '[data-diff-kind="row"][data-row-index]',
      );
      if (!row || !root?.contains(row)) return;
      const file = latest.current.files.find(
        (file) => file.path === row.dataset.filePath,
      );
      const index = Number(row.dataset.rowIndex);
      if (!file || file.rows[index]?.t === "hunk") return;
      const cell = event.target.closest<HTMLElement>("[data-code-cell]");
      if (!cell) event.preventDefault();
      const previous = latest.current.selection;
      const extended = !!(
        event.shiftKey &&
        previous?.path === file.path &&
        previous.hash === file.hash
      );
      press.current = {
        id: event.pointerId,
        file,
        origin: index,
        from: extended ? previous!.from : index,
        to: index,
        x: event.clientX,
        y: event.clientY,
        px: event.clientX,
        py: event.clientY,
        cell,
        off: cell ? caretAt(cell, event.clientX, event.clientY) : null,
        extended,
        wandered: false,
        previous,
      };
      setPressed(itemKey(file.path, String(index)));
      paint(press.current);
      frame = requestAnimationFrame(autoScroll);
    }
    function move(event: PointerEvent) {
      if (press.current?.id === event.pointerId)
        locate(event.clientX, event.clientY);
    }
    function release(event?: PointerEvent) {
      const current = press.current;
      if (!current || (event && event.pointerId !== current.id)) return;
      press.current = null;
      cancelAnimationFrame(frame);
      delete root!.dataset.selectingRows;
      setPressed(null);
      if (!event) {
        setSelection(current.previous);
        return;
      }
      let chars =
        !current.extended && !current.wandered ? nativeRange(current) : null;
      if (
        current.wandered &&
        current.to === current.origin &&
        current.cell &&
        current.off != null &&
        !atStart(event.clientX, event.clientY, current.x, current.y)
      ) {
        const end = caretAt(current.cell, event.clientX, event.clientY);
        if (end != null)
          chars = charRange(
            current.file.rows[current.origin]!.text,
            current.off,
            end,
          );
      }
      const next = {
        path: current.file.path,
        hash: current.file.hash,
        from: current.from,
        to: current.to,
        ...(chars ? { ca: chars.a, cb: chars.b } : {}),
      };
      const comment = makeComment(
        current.file,
        next.from,
        next.to,
        chars ? { ca: chars.a, cb: chars.b } : undefined,
      );
      if (chars || current.wandered) window.getSelection()?.removeAllRanges();
      const accepted = latest.current.submit(comment);
      if (accepted !== false) setSelection(next);
      else setSelection(current.previous);
    }
    const cancel = () => release();
    root.addEventListener("pointerdown", down);
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", release);
    document.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    return () => {
      cancelAnimationFrame(frame);
      root.removeEventListener("pointerdown", down);
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", release);
      document.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      delete root.dataset.selectingRows;
    };
  }, [pane]);
  return {
    selection,
    pressed,
    select: (file: DiffFile, index: number, extend: boolean) => {
      const previous = latest.current.selection;
      const from =
        extend && previous?.path === file.path ? previous.from : index;
      const accepted = latest.current.submit(makeComment(file, from, index));
      if (accepted !== false)
        setSelection({ path: file.path, hash: file.hash, from, to: index });
      return accepted;
    },
  };
}

const highlightedCode = new Map<string, Map<HTMLElement, Range[]>>();
export function highlightCharacters(
  element: HTMLElement,
  from?: number,
  to?: number,
  group = "lcr-selection",
  others: { ca: number; cb: number }[] = [],
) {
  const selectedCode =
    highlightedCode.get(group) || new Map<HTMLElement, Range[]>();
  highlightedCode.set(group, selectedCode);
  selectedCode.delete(element);
  const spans = [
    ...others,
    ...(from != null && to != null ? [{ ca: from, cb: to }] : []),
  ];
  for (const { ca: from, cb: to } of spans) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let offset = 0,
      start = false;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const length = node.textContent?.length || 0;
      if (!start && from <= offset + length) {
        range.setStart(node, Math.max(0, from - offset));
        start = true;
      }
      if (start && to <= offset + length) {
        range.setEnd(node, Math.max(0, to - offset));
        selectedCode.set(element, [
          ...(selectedCode.get(element) || []),
          range,
        ]);
        break;
      }
      offset += length;
    }
  }
  if (
    typeof CSS !== "undefined" &&
    "highlights" in CSS &&
    typeof Highlight !== "undefined"
  )
    CSS.highlights.set(
      group,
      new Highlight(...[...selectedCode.values()].flat()),
    );
}
