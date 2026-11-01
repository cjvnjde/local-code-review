import { afterEach, expect, test } from "bun:test";
import { watchPaths } from "./path.ts";

const names = [
  "document",
  "Element",
  "HTMLElement",
  "ResizeObserver",
  "MutationObserver",
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
  textContent = "";
  children: LayoutElement[] = [];
  parentElement: LayoutElement | null = null;
  constructor(
    readonly classes: string[],
    public width = 0,
  ) {}
  classList = { contains: (name: string) => this.classes.includes(name) };
  append(...children: LayoutElement[]) {
    for (const child of children) {
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
  body.append(...initial);
  const observed = new Set<LayoutElement>();
  let resize: (entries: { target: LayoutElement }[]) => void;
  let mutate: (
    entries: { addedNodes: unknown[]; removedNodes: unknown[] }[],
  ) => void;
  let mutationOptions: { childList?: boolean; subtree?: boolean } = {};
  const globals = {
    Element: LayoutElement,
    HTMLElement: LayoutElement,
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
    resize: () => resize([...observed].map((target) => ({ target }))),
    add: (element: LayoutElement, parent = body) => {
      parent.append(element);
      if (
        mutationOptions.childList &&
        (parent === body || mutationOptions.subtree)
      )
        mutate([{ addedNodes: [element, {}], removedNodes: [] }]);
    },
    remove: (element: LayoutElement) => {
      body.children = body.children.filter((child) => child !== element);
      if (mutationOptions.childList)
        mutate([{ addedNodes: [], removedNodes: [element, {}] }]);
    },
  };
}

test("resizing a mounted path elides its directory and restores it when space returns", () => {
  const { container, text } = label("abc/file.ts", 90);
  const page = layout(container);
  page.resize();
  expect(text.textContent).toBe("a…/file.ts");
  expect(container.style.minWidth).toBe("100px");
  container.width = 109.5;
  page.resize();
  expect(text.textContent).toBe("abc/file.ts");
  container.width = 100;
  page.resize();
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
  page.resize();
  expect(text.textContent).toBe("f…/file.ts");
  page.remove(wrapper);
  container.width = 300;
  page.resize();
  expect(text.textContent).toBe("f…/file.ts");
});

test("a directly inserted path keeps Unicode characters intact at the minimum width", () => {
  const page = layout();
  const { container, text } = label("📁目录/file.ts", 90);
  page.add(container);
  page.resize();
  expect(text.textContent).toBe("📁…/file.ts");
  expect(container.style.minWidth).toBe("100px");
});

test("a path without a label does not prevent neighboring paths from fitting", () => {
  const incomplete = new LayoutElement(["pth"]);
  incomplete.dataset.path = "unfinished/path.ts";
  const { container, text } = label("folder/file.ts", 90);
  const page = layout(incomplete, container);
  page.resize();
  expect(text.textContent).toBe("f…/file.ts");
});

test("paths inserted into an existing nested panel are fitted without constraining the panel width", () => {
  const panel = new LayoutElement(["pane"]);
  const page = layout(panel);
  const { container, text } = label("folder/file.ts", 100);
  page.add(container, panel);
  page.resize();
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
    expect(text.textContent).toBe(path);
    expect(container.style.minWidth).toBe(minWidth);
  },
);
