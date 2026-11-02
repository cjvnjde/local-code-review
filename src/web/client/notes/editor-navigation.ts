import {
  registerView,
  setView,
  setViews,
  viewValue,
} from "../navigation/ui-navigation.ts";
import { state } from "../app/state.ts";

type Editor = {
  route: string;
  textarea: HTMLTextAreaElement;
  close: () => void;
  busy: () => boolean;
};
type Draft = {
  body: string;
  start: number;
  end: number;
  direction: "forward" | "backward" | "none";
};
let current: Editor | null = null;
let suspending = false;
const drafts = new Map<string, Draft>();
const restorers: ((route: string) => boolean)[] = [];

/** Only navigation metadata is public. Unsent wording and caret positions stay in this page. */
export function registerEditor(restore: (route: string) => boolean) {
  restorers.push(restore);
}

function suspend() {
  const editor = current;
  if (!editor) return;
  const ta = editor.textarea;
  drafts.set(editor.route, {
    body: ta.value,
    start: ta.selectionStart,
    end: ta.selectionEnd,
    direction: ta.selectionDirection,
  });
  current = null;
  suspending = true;
  try {
    editor.close();
  } finally {
    suspending = false;
  }
}

registerView(
  "editor",
  {
    dependencies: ["notes", "note"],
    canLeave() {
      // The higher-priority drawing view guards its own asynchronous save.
      return (
        !current?.textarea.isConnected ||
        !!document.querySelector("[data-annotation-editor]") ||
        !current.busy()
      );
    },
    restore(route) {
      if (
        current?.route === route &&
        current.textarea.isConnected &&
        !current.textarea.closest("[hidden]")
      )
        return;
      suspend();
      if (!route) return;
      return restorers.some((restore) => restore(route));
    },
  },
  20,
);

export function trackEditor(
  route: string,
  textarea: HTMLTextAreaElement,
  close: () => void,
  busy: () => boolean = () => textarea.disabled,
) {
  if (state.uiEmbed) return;
  if (current?.textarea === textarea) return;
  current = { route, textarea, close, busy };
  const navigable = textarea as HTMLTextAreaElement & {
    __navigationClose?: () => void;
  };
  navigable.__navigationClose = suspend;
  const draft = drafts.get(route);
  if (draft) {
    textarea.value = draft.body;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.setSelectionRange(draft.start, draft.end, draft.direction);
  }
  setViews({
    editor: route,
    ...(state.reader ? {} : { notes: null }),
  });
}

/** Save and explicit Cancel finish the draft; traversal instead suspends it for Forward. */
export function finishEditor(textarea: HTMLTextAreaElement, replace = false) {
  if (suspending || current?.textarea !== textarea) return;
  const route = current.route;
  current = null;
  drafts.delete(route);
  if (viewValue("editor") === route)
    setView("editor", null, { close: !replace, replace });
}
