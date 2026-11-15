import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { type PanelImperativeHandle } from "react-resizable-panels";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "../components/ui/resizable.tsx";
import { useUi } from "../app/ui-preferences.tsx";
import { useStored } from "../app/preferences.ts";

export function useMedia(query: string) {
  const subscribe = useCallback(
    (notify: () => void) => {
      const media = matchMedia(query);
      media.addEventListener("change", notify);
      return () => media.removeEventListener("change", notify);
    },
    [query],
  );
  const snapshot = useCallback(() => matchMedia(query).matches, [query]);
  return useSyncExternalStore(subscribe, snapshot, () => false);
}

/** Keep exiting content mounted and at its expanded width while the pane clips it. */
function usePanelMotion(visible: boolean, reducedMotion: boolean) {
  const [retained, setRetained] = useState(visible);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (visible) {
      setRetained(true);
      return;
    }
    if (reducedMotion) {
      setRetained(false);
      return;
    }
    const timer = setTimeout(() => setRetained(false), 180);
    return () => clearTimeout(timer);
  }, [visible, reducedMotion]);
  const onResize = useCallback(({ inPixels }: { inPixels: number }) => {
    const element = content.current;
    const pane = element?.parentElement?.parentElement;
    // ResizeObserver sees animated widths too; don't rewrap content on those frames.
    if (inPixels > 0 && element && !pane?.getAnimations().length)
      element.style.width = `${inPixels}px`;
  }, []);
  return {
    content,
    present: visible || retained,
    onResize,
  };
}

/** Persisted sizes hydrate a pane; after input, its live size owns the session. */
function usePanelWidth(
  storedWidth: number,
  visible: boolean,
  peerVisible: boolean,
) {
  const panel = useRef<PanelImperativeHandle>(null);
  const defaultWidth = useRef(storedWidth);
  const width = useRef(storedWidth);
  const userSized = useRef(false);
  const previousVisible = useRef<boolean | undefined>(undefined);
  const previousPeerVisible = useRef<boolean | undefined>(undefined);
  const measureFrame = useRef(0);
  const restoreFrame = useRef(0);
  const cancelRestore = useCallback(() => {
    cancelAnimationFrame(measureFrame.current);
    cancelAnimationFrame(restoreFrame.current);
  }, []);
  useEffect(() => cancelRestore, [cancelRestore]);
  useEffect(() => {
    const visibilityChanged =
      previousVisible.current !== visible ||
      previousPeerVisible.current !== peerVisible;
    previousVisible.current = visible;
    previousPeerVisible.current = peerVisible;
    if (!userSized.current) width.current = storedWidth;
    else if (!visibilityChanged) return;
    cancelRestore();
    // Restore after the library registers the new constraints and separators.
    measureFrame.current = requestAnimationFrame(() => {
      restoreFrame.current = requestAnimationFrame(() => {
        panel.current?.resize(visible ? `${width.current}px` : "0px");
      });
    });
  }, [storedWidth, visible, peerVisible, cancelRestore]);
  const readWidth = () => {
    if (visible) {
      const next = Math.round(panel.current?.getSize().inPixels || 0);
      if (next) width.current = next;
    }
    return width.current;
  };
  return {
    panel,
    defaultSize: `${defaultWidth.current}px`,
    readWidth,
    beginResize: () => {
      cancelRestore();
      if (visible) {
        userSized.current = true;
        readWidth();
      }
    },
    reset: (next: number) => {
      cancelRestore();
      userSized.current = true;
      width.current = next;
      panel.current?.resize(`${next}px`);
    },
  };
}

/** Keep every pane mounted across resizing, hiding and mobile drawer transitions. */
export function ReviewLayout({
  files,
  children,
  notes,
  navOpen,
  fileDrawerOpen,
  notesOpen,
}: {
  files: ReactNode;
  children: ReactNode;
  notes: ReactNode;
  navOpen: boolean;
  fileDrawerOpen: boolean;
  notesOpen: boolean;
}) {
  const { settings, update } = useUi();
  const [notesWidth, setNotesWidth] = useStored("lcr:v2:notes-width", 390);
  const wide = useMedia("(min-width: 1280px)");
  const inlineNotes = useMedia("(min-width: 960px)");
  const reducedMotion = useMedia("(prefers-reduced-motion: reduce)");
  const filesVisible = wide ? navOpen : fileDrawerOpen;
  const filesMotion = usePanelMotion(filesVisible, reducedMotion);
  const notesMotion = usePanelMotion(notesOpen, reducedMotion);
  const showFiles = wide && navOpen;
  const showNotes = inlineNotes && notesOpen;
  const [motion, setMotion] = useState({
    files: showFiles,
    notes: showNotes,
    wide,
    inlineNotes,
    enabled: false,
  });
  if (
    motion.files !== showFiles ||
    motion.notes !== showNotes ||
    motion.wide !== wide ||
    motion.inlineNotes !== inlineNotes
  )
    setMotion({
      files: showFiles,
      notes: showNotes,
      wide,
      inlineNotes,
      // Intermediate breakpoint widths reflow virtual rows and move the reading anchor.
      enabled: motion.wide === wide && motion.inlineNotes === inlineNotes,
    });
  const filesSize = usePanelWidth(
    settings.navWidth || 256,
    showFiles,
    showNotes,
  );
  const notesSize = usePanelWidth(notesWidth, showNotes, showFiles);
  const group = useRef<HTMLDivElement>(null);
  const persistFrame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(persistFrame.current), []);
  const persistWidths = () => {
    persistFrame.current = 0;
    group.current?.removeAttribute("data-resizing");
    if (showFiles) {
      const width = filesSize.readWidth();
      if (width !== (settings.navWidth || 256)) update({ navWidth: width });
    }
    if (showNotes) {
      const width = notesSize.readWidth();
      if (width !== notesWidth) setNotesWidth(width);
    }
  };
  const beginResize = () => {
    // Never ease pointer or keyboard input; only programmatic pane changes animate.
    filesSize.beginResize();
    notesSize.beginResize();
    // Flush a preceding keyboard resize before the next gesture can change its pixels.
    if (persistFrame.current) {
      cancelAnimationFrame(persistFrame.current);
      persistWidths();
    }
    group.current?.setAttribute("data-resizing", "");
  };
  const queuePersist = () => {
    if (!group.current?.hasAttribute("data-resizing")) return;
    cancelAnimationFrame(persistFrame.current);
    persistFrame.current = requestAnimationFrame(persistWidths);
  };
  return (
    <ResizablePanelGroup
      orientation="horizontal"
      id="review-panes"
      className="review-panes min-h-0 flex-1"
      elementRef={group}
      data-panel-motion={motion.enabled || undefined}
      resizeTargetMinimumSize={{ fine: 20, coarse: 28 }}
      onPointerDownCapture={(event) => {
        if (event.button !== 0) return;
        // Expanded library hit targets can start on pane content, not the separator.
        // Claim local width intent directly instead of relying on native cancellation.
        const minimum = matchMedia("(pointer: coarse)").matches ? 28 : 20;
        const hitsHandle = [
          ...event.currentTarget.querySelectorAll<HTMLElement>(
            '[data-separator]:not([aria-disabled="true"])',
          ),
        ].some((handle) => {
          const rect = handle.getBoundingClientRect();
          const halfWidth = Math.max(rect.width, minimum) / 2;
          return (
            rect.height > 0 &&
            Math.abs(event.clientX - (rect.left + rect.width / 2)) <=
              halfWidth &&
            event.clientY >= rect.top &&
            event.clientY <= rect.bottom
          );
        });
        if (hitsHandle) beginResize();
      }}
      onPointerUpCapture={queuePersist}
      onPointerCancelCapture={queuePersist}
      onKeyDownCapture={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest("[data-separator]") &&
          ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
        )
          beginResize();
      }}
      onKeyUpCapture={queuePersist}
      onLayoutChanged={(_layout, meta) => {
        if (!meta.isUserInteraction) return;
        // The library is also authoritative when a gesture began outside the divider.
        filesSize.beginResize();
        notesSize.beginResize();
        // Keyboard layout callbacks can precede React's DOM update. Read committed pixels.
        queuePersist();
      }}
    >
      <ResizablePanel
        id="files-pane"
        aria-hidden={!filesVisible}
        inert={!filesVisible}
        panelRef={filesSize.panel}
        onResize={filesMotion.onResize}
        defaultSize={filesSize.defaultSize}
        minSize={showFiles ? "180px" : "0px"}
        maxSize={showFiles ? "60%" : "0px"}
        groupResizeBehavior="preserve-pixel-size"
        className="h-full"
        style={{ overflow: wide ? "hidden" : "visible" }}
      >
        <div
          ref={filesMotion.content}
          className="h-full transition-[opacity,transform] duration-[180ms] ease-out motion-reduce:transition-none"
          style={{
            opacity: filesVisible ? 1 : 0,
            transform: wide && !filesVisible ? "translateX(-8px)" : "none",
            visibility: filesMotion.present ? "visible" : "hidden",
          }}
        >
          {files}
        </div>
      </ResizablePanel>
      {/* Unmount inactive separators: hidden DOM nodes corrupt library hit ordering. */}
      {showFiles && (
        <ResizableHandle
          id="files-resize"
          aria-label="Resize file sidebar"
          disableDoubleClick
          title="Drag or use arrow keys to resize; double-click to reset"
          onDoubleClick={() => {
            cancelAnimationFrame(persistFrame.current);
            persistFrame.current = 0;
            filesSize.reset(256);
            update({ navWidth: 0 });
          }}
        />
      )}
      {/* Keep code readable; compact layouts move secondary panes out of the flow. */}
      <ResizablePanel
        id="diff-pane"
        minSize={inlineNotes ? "480px" : "0px"}
        className="h-full"
        style={{ overflow: "hidden" }}
      >
        {children}
      </ResizablePanel>
      {showNotes && (
        <ResizableHandle
          id="notes-resize"
          aria-label="Resize conversation pane"
          disableDoubleClick
          title="Drag or use arrow keys to resize; double-click to reset"
          onDoubleClick={() => {
            cancelAnimationFrame(persistFrame.current);
            persistFrame.current = 0;
            notesSize.reset(390);
            setNotesWidth(390);
          }}
        />
      )}
      <ResizablePanel
        id="notes-pane"
        aria-hidden={!notesOpen}
        inert={!notesOpen}
        panelRef={notesSize.panel}
        onResize={notesMotion.onResize}
        defaultSize={notesSize.defaultSize}
        minSize={showNotes ? "320px" : "0px"}
        maxSize={showNotes ? "65%" : "0px"}
        groupResizeBehavior="preserve-pixel-size"
        className="h-full"
        style={{ overflow: inlineNotes ? "hidden" : "visible" }}
      >
        <div
          ref={notesMotion.content}
          className="h-full transition-opacity duration-[180ms] ease-out sm:transition-[opacity,transform] motion-reduce:transition-none"
          style={{
            opacity: notesOpen ? 1 : 0,
            // A transform would make the compact aside's fixed position pane-relative.
            transform: inlineNotes && !notesOpen ? "translateX(8px)" : "none",
            visibility: notesMotion.present ? "visible" : "hidden",
          }}
        >
          {notes}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
