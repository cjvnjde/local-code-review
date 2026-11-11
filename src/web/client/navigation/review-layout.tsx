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
  const filesPanel = useRef<PanelImperativeHandle>(null);
  const notesPanel = useRef<PanelImperativeHandle>(null);
  const defaultFiles = useRef(settings.navWidth || 256);
  const defaultNotes = useRef(notesWidth);
  const persistFrame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(persistFrame.current), []);
  useEffect(() => {
    // Let the Group's ResizeObserver measure a new viewport before restoring pixel sizes.
    let restore = 0;
    const measure = requestAnimationFrame(() => {
      restore = requestAnimationFrame(() => {
        filesPanel.current?.resize(
          showFiles ? `${settings.navWidth || 256}px` : "0px",
        );
        notesPanel.current?.resize(showNotes ? `${notesWidth}px` : "0px");
      });
    });
    return () => {
      cancelAnimationFrame(measure);
      cancelAnimationFrame(restore);
    };
  }, [showFiles, showNotes, settings.navWidth, notesWidth]);
  return (
    <ResizablePanelGroup
      orientation="horizontal"
      id="review-panes"
      className="min-h-0 flex-1"
      onLayoutChanged={(_layout, meta) => {
        if (!meta.isUserInteraction) return;
        // Keyboard layout callbacks can precede React's DOM update. Read committed pixels.
        cancelAnimationFrame(persistFrame.current);
        persistFrame.current = requestAnimationFrame(() => {
          if (showFiles) {
            const width = Math.round(
              filesPanel.current?.getSize().inPixels || 0,
            );
            if (width && width !== (settings.navWidth || 256))
              update({ navWidth: width });
          }
          if (showNotes) {
            const width = Math.round(
              notesPanel.current?.getSize().inPixels || 0,
            );
            if (width && width !== notesWidth) setNotesWidth(width);
          }
        });
      }}
    >
      <ResizablePanel
        id="files-pane"
        aria-hidden={!showFiles}
        inert={!showFiles}
        panelRef={filesPanel}
        defaultSize={`${defaultFiles.current}px`}
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
          filesPanel.current?.resize("256px");
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
          notesPanel.current?.resize("390px");
          setNotesWidth(390);
        }}
      />
      <ResizablePanel
        id="notes-pane"
        aria-hidden={!notesOpen}
        inert={!notesOpen}
        panelRef={notesPanel}
        defaultSize={`${defaultNotes.current}px`}
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
