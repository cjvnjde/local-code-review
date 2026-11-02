import { afterEach, expect, test } from "bun:test";
import { watchPaths } from "./path.ts";

const names = [
  "document",
  "Element",
  "HTMLElement",
  "ResizeObserver",
  "MutationObserver",
  "requestAnimationFrame",
] as const;
const descriptors = new Map(
  names.map((name) => [
    name,
    Object.getOwnPropertyDescriptor(globalThis, name),
  ]),
);
afterEach(() => {
  for (const name of names) {
    const descriptor = descriptors.get(name);
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

class LayoutElement {
  style = { minWidth: "" };
  dataset: { path?: string } = {};
  private text = "";
  textWrites = 0;
  get textContent() {
    return this.text;
  }
  set textContent(value: string) {
    this.text = value;
    this.textWrites++;
  }
  children: LayoutElement[] = [];
  parentElement: LayoutElement | null = null;
  connected = false;
  get isConnected(): boolean {
    return this.parentElement?.isConnected ?? this.connected;
  }
  constructor(
    readonly classes: string[],
    public width = 0,
  ) {}
  classList = { contains: (name: string) => this.classes.includes(name) };
  append(...children: LayoutElement[]) {
    for (const child of children) {
      if (child.parentElement)
        child.parentElement.children = child.parentElement.children.filter(
          (sibling) => sibling !== child,
        );
      this.children.push(child);
      child.parentElement = this;
    }
  }
  matches(selector: string) {
    if (selector === ".pth[data-path]")
      return this.classes.includes("pth") && this.dataset.path !== undefined;
    return selector.startsWith(".") && this.classes.includes(selector.slice(1));
  }
  querySelectorAll(selector: string): LayoutElement[] {
    return this.children.flatMap((child) => [
      ...(child.matches(selector) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  getBoundingClientRect() {
    return { width: this.width };
  }
}

function label(path: string, width: number) {
  const container = new LayoutElement(["pth"], width);
  container.dataset.path = path;
  const text = new LayoutElement(["ptx"]);
  container.append(text);
  return { container, text };
}

function layout(...initial: LayoutElement[]) {
  const body = new LayoutElement([]);
  body.connected = true;
  body.append(...initial);
  const observed = new Set<LayoutElement>();
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  let resize: (entries: { target: LayoutElement }[]) => void;
  let mutate: (
    entries: { addedNodes: unknown[]; removedNodes: unknown[] }[],
  ) => void;
  let mutationOptions: { childList?: boolean; subtree?: boolean } = {};
  const globals = {
    Element: LayoutElement,
    HTMLElement: LayoutElement,
    requestAnimationFrame(callback: FrameRequestCallback) {
      const id = ++nextFrame;
      frames.set(id, callback);
      return id;
    },
    ResizeObserver: class {
      constructor(callback: typeof resize) {
        resize = callback;
      }
      observe(element: LayoutElement) {
        observed.add(element);
      }
      unobserve(element: LayoutElement) {
        observed.delete(element);
      }
    },
    MutationObserver: class {
      constructor(callback: typeof mutate) {
        mutate = callback;
      }
      observe(
        _target: LayoutElement,
        options: { childList?: boolean; subtree?: boolean },
      ) {
        mutationOptions = options;
      }
    },
    document: {
      body,
      querySelectorAll: (selector: string) => body.querySelectorAll(selector),
      createRange: () => {
        let selected: LayoutElement;
        return {
          selectNodeContents(element: LayoutElement) {
            selected = element;
          },
          getBoundingClientRect: () => ({
            width: Array.from(selected.textContent).length * 10,
          }),
        };
      },
    },
  };
  for (const [name, value] of Object.entries(globals))
    Object.defineProperty(globalThis, name, { configurable: true, value });
  watchPaths();
  return {
    resize: (targets = [...observed]) =>
      resize(targets.map((target) => ({ target }))),
    frame: () => {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback(0));
    },
    get pendingFrames() {
      return frames.size;
    },
    add: (element: LayoutElement, parent = body) => {
      parent.append(element);
      if (
        mutationOptions.childList &&
        (parent === body || mutationOptions.subtree)
      )
        mutate([{ addedNodes: [element, {}], removedNodes: [] }]);
    },
    remove: (element: LayoutElement, notify = true) => {
      const parent = element.parentElement;
      if (parent)
        parent.children = parent.children.filter((child) => child !== element);
      element.parentElement = null;
      if (notify && mutationOptions.childList)
        mutate([{ addedNodes: [], removedNodes: [element, {}] }]);
    },
  };
}

test("resizing a mounted path elides its directory and restores it when space returns", () => {
  const { container, text } = label("abc/file.ts", 90);
  const page = layout(container);
  page.resize();
  expect(text.textContent).toBe("");
  expect(container.style.minWidth).toBe("");
  page.frame();
  expect(text.textContent).toBe("a…/file.ts");
  expect(container.style.minWidth).toBe("100px");
  container.width = 109.5;
  page.resize();
  page.frame();
  expect(text.textContent).toBe("abc/file.ts");
  container.width = 100;
  page.resize();
  page.frame();
  expect(text.textContent).toBe("a…/file.ts");
});

test("rename labels reserve both complete filenames and the separator", () => {
  const from = label("source/old.ts", 90);
  const to = label("target/new.ts", 90);
  const arrow = new LayoutElement(["arrow"], 15.2);
  const group = new LayoutElement(["file-path"]);
  group.append(from.container, arrow, to.container);
  const page = layout(group);
  page.resize();
  page.frame();
  expect(from.text.textContent).toBe("s…/old.ts");
  expect(to.text.textContent).toBe("t…/new.ts");
  expect(group.style.minWidth).toBe("196px");
  expect(from.container.style.minWidth).toBe("90px");
  expect(to.container.style.minWidth).toBe("90px");
});

test("new nested paths are fitted and removed paths stop changing", () => {
  const page = layout();
  const wrapper = new LayoutElement([]);
  const { container, text } = label("folder/file.ts", 90);
  wrapper.append(container);
  page.add(wrapper);
  expect(page.pendingFrames).toBe(1);
  page.frame();
  expect(text.textContent).toBe("f…/file.ts");
  page.remove(wrapper);
  container.width = 300;
  page.resize();
  page.frame();
  expect(text.textContent).toBe("f…/file.ts");
});

test("a directly inserted path keeps Unicode characters intact at the minimum width", () => {
  const page = layout();
  const { container, text } = label("📁目录/file.ts", 90);
  page.add(container);
  expect(page.pendingFrames).toBe(1);
  page.frame();
  expect(text.textContent).toBe("📁…/file.ts");
  expect(container.style.minWidth).toBe("100px");
});

test("a path without a label does not prevent neighboring paths from fitting", () => {
  const incomplete = new LayoutElement(["pth"]);
  incomplete.dataset.path = "unfinished/path.ts";
  const { container, text } = label("folder/file.ts", 90);
  const page = layout(incomplete, container);
  page.resize();
  page.frame();
  expect(text.textContent).toBe("f…/file.ts");
});

test("paths inserted into an existing nested panel are fitted without constraining the panel width", () => {
  const panel = new LayoutElement(["pane"]);
  const page = layout(panel);
  const { container, text } = label("folder/file.ts", 100);
  page.add(container, panel);
  expect(page.pendingFrames).toBe(1);
  page.frame();
  expect(text.textContent).toBe("f…/file.ts");
  expect(panel.style.minWidth).toBe("");
});

test.each([
  ["a/x.ts", "60px"],
  ["README.md", "90px"],
])(
  "a shallow path %s reserves its complete name rather than adding an ellipsis",
  (path, minWidth) => {
    const { container, text } = label(path, 1);
    const page = layout(container);
    page.resize();
    page.frame();
    expect(text.textContent).toBe(path);
    expect(container.style.minWidth).toBe(minWidth);
  },
);

test("initial mount and repeated resize notifications share one deferred fit per path", () => {
  const first = label("folder/file.ts", 100);
  const second = label("source/other.ts", 110);
  const page = layout(first.container, second.container);
  expect(page.pendingFrames).toBe(1);
  expect(first.text.textWrites).toBe(0);
  page.frame();
  expect(first.text.textContent).toBe("f…/file.ts");
  expect(second.text.textContent).toBe("s…/other.ts");
  expect(page.pendingFrames).toBe(0);
  const firstWrites = first.text.textWrites;
  const secondWrites = second.text.textWrites;

  page.resize();
  page.resize([first.container, first.container]);
  page.resize();
  expect(page.pendingFrames).toBe(1);
  expect(first.text.textWrites).toBe(firstWrites);
  expect(second.text.textWrites).toBe(secondWrites);
  page.frame();
  expect(first.text.textWrites).toBe(firstWrites * 2);
  expect(second.text.textWrites).toBe(secondWrites * 2);
  expect(page.pendingFrames).toBe(0);
});

test("a resize caused by reserving the filename minimum settles without another frame", () => {
  const { container, text } = label("abc/file.ts", 90);
  const page = layout(container);
  page.frame();
  expect(container.style.minWidth).toBe("100px");
  expect(text.textContent).toBe("a…/file.ts");

  container.width = 100;
  page.resize();
  expect(page.pendingFrames).toBe(1);
  page.frame();
  expect(container.style.minWidth).toBe("100px");
  expect(text.textContent).toBe("a…/file.ts");
  expect(page.pendingFrames).toBe(0);
  const writes = text.textWrites;
  page.frame();
  expect(text.textWrites).toBe(writes);
});

test.each([true, false])(
  "detached paths are not fitted even when removal delivery is %s",
  (notify) => {
    const { container, text } = label("folder/file.ts", 90);
    const page = layout(container);
    page.resize();
    page.remove(container, notify);
    // A queued resize entry may outlive removal, or arrive before mutation delivery.
    page.resize([container]);
    page.frame();
    expect(text.textWrites).toBe(0);
    expect(container.style.minWidth).toBe("");
    expect(page.pendingFrames).toBe(0);

    page.add(container);
    page.frame();
    expect(text.textContent).toBe("f…/file.ts");
    expect(container.style.minWidth).toBe("100px");
  },
);
