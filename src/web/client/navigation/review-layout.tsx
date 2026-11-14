import {
  useCallback,
  useEffect,
  useRef,
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

function useMedia(query: string) {
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
    // Wait for the Group's ResizeObserver after a visibility/breakpoint change.
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
  notesOpen,
}: {
  files: ReactNode;
  children: ReactNode;
  notes: ReactNode;
  navOpen: boolean;
  notesOpen: boolean;
}) {
  const { settings, update } = useUi();
  const [notesWidth, setNotesWidth] = useStored("lcr:v2:notes-width", 390);
  const wide = useMedia("(min-width: 768px)");
  const inlineNotes = useMedia("(min-width: 640px)");
  const showFiles = wide && navOpen;
  const showNotes = inlineNotes && notesOpen;
  const filesSize = usePanelWidth(
    settings.navWidth || 256,
    showFiles,
    showNotes,
  );
  const notesSize = usePanelWidth(notesWidth, showNotes, showFiles);
  const persistFrame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(persistFrame.current), []);
  const persistWidths = () => {
    persistFrame.current = 0;
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
    filesSize.beginResize();
    notesSize.beginResize();
    // Flush a preceding keyboard resize before the next gesture can change its pixels.
    if (persistFrame.current) {
      cancelAnimationFrame(persistFrame.current);
      persistWidths();
    }
  };
  return (
    <ResizablePanelGroup
      orientation="horizontal"
      id="review-panes"
      className="min-h-0 flex-1"
      resizeTargetMinimumSize={{ fine: 20, coarse: 28 }}
      onPointerDownCapture={(event) => {
        // The library handles expanded divider hit targets on document capture.
        if (event.defaultPrevented) beginResize();
      }}
      onKeyDownCapture={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest("[data-separator]") &&
          ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
        )
          beginResize();
      }}
      onLayoutChanged={(_layout, meta) => {
        if (!meta.isUserInteraction) return;
        // Keyboard layout callbacks can precede React's DOM update. Read committed pixels.
        cancelAnimationFrame(persistFrame.current);
        persistFrame.current = requestAnimationFrame(persistWidths);
      }}
    >
      <ResizablePanel
        id="files-pane"
        aria-hidden={!showFiles}
        inert={!showFiles}
        panelRef={filesSize.panel}
        defaultSize={filesSize.defaultSize}
        minSize={showFiles ? "180px" : "0px"}
        maxSize={showFiles ? "60%" : "0px"}
        groupResizeBehavior="preserve-pixel-size"
        className="h-full"
        style={{ overflow: "hidden" }}
      >
        {files}
      </ResizablePanel>
      <ResizableHandle
        id="files-resize"
        aria-label="Resize file sidebar"
        hidden={!showFiles}
        disabled={!showFiles}
        disableDoubleClick
        title="Drag or use arrow keys to resize; double-click to reset"
        onDoubleClick={() => {
          cancelAnimationFrame(persistFrame.current);
          persistFrame.current = 0;
          filesSize.reset(256);
          update({ navWidth: 0 });
        }}
      />
      <ResizablePanel
        id="diff-pane"
        minSize={inlineNotes ? "240px" : "0px"}
        className="h-full"
        style={{ overflow: "hidden" }}
      >
        {children}
      </ResizablePanel>
      <ResizableHandle
        id="notes-resize"
        aria-label="Resize conversation pane"
        hidden={!showNotes}
        disabled={!showNotes}
        disableDoubleClick
        title="Drag or use arrow keys to resize; double-click to reset"
        onDoubleClick={() => {
          cancelAnimationFrame(persistFrame.current);
          persistFrame.current = 0;
          notesSize.reset(390);
          setNotesWidth(390);
        }}
      />
      <ResizablePanel
        id="notes-pane"
        aria-hidden={!notesOpen}
        inert={!notesOpen}
        panelRef={notesSize.panel}
        defaultSize={notesSize.defaultSize}
        minSize={showNotes ? "280px" : "0px"}
        maxSize={showNotes ? "65%" : "0px"}
        groupResizeBehavior="preserve-pixel-size"
        className="h-full"
        style={{ overflow: inlineNotes ? "hidden" : "visible" }}
      >
        {notes}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
