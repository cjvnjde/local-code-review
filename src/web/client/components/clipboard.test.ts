import { afterEach, expect, test } from "bun:test";
import { copyText } from "./clipboard.ts";

const navigation = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const promptDescriptor = Object.getOwnPropertyDescriptor(globalThis, "prompt");
const timerDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "setTimeout",
);
afterEach(() => {
  if (navigation) Object.defineProperty(globalThis, "navigator", navigation);
  else delete (globalThis as any).navigator;
  if (promptDescriptor)
    Object.defineProperty(globalThis, "prompt", promptDescriptor);
  else delete (globalThis as any).prompt;
  if (timerDescriptor)
    Object.defineProperty(globalThis, "setTimeout", timerDescriptor);
});
test("copying a file path preserves its icon and copies the full repository-relative value", async () => {
  let copied = "";
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      clipboard: {
        writeText: async (text: string) => {
          copied = text;
        },
      },
    },
  });
  const classes = new Set();
  const button = {
    dataset: { tooltip: "Copy file path" },
    innerHTML: "<svg></svg>",
    textContent: "",
    isConnected: false,
    classList: {
      add: (value: string) => classes.add(value),
      remove: (value: string) => classes.delete(value),
    },
  };
  await copyText(button, "deep/folder/a file.ts", true);
  expect(copied).toBe("deep/folder/a file.ts");
  expect(button.innerHTML).toBe("<svg></svg>");
  expect(button.dataset.tooltip).toBe("Copied");
  expect(classes.has("copied")).toBe(true);
});
test("a denied clipboard keeps the full path available for manual copying", async () => {
  let offered: any[] = [];
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      clipboard: {
        writeText: async () => {
          throw Error("denied");
        },
      },
    },
  });
  Object.defineProperty(globalThis, "prompt", {
    configurable: true,
    value: (...args: any[]) => {
      offered = args;
    },
  });
  await copyText({}, "src/app.ts", true);
  expect(offered).toEqual(["Copy file path:", "src/app.ts"]);
});

function captureFeedbackTimer() {
  let expire: (() => void) | undefined;
  Object.defineProperty(globalThis, "setTimeout", {
    configurable: true,
    value: (callback: () => void) => {
      expire = callback;
      return 0;
    },
  });
  return () => expire!();
}

function allowClipboard() {
  const copied: string[] = [];
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      clipboard: {
        writeText: async (value: string) => {
          copied.push(value);
        },
      },
    },
  });
  return copied;
}

test("text-button feedback restores its original label without modifying the copied reference", async () => {
  const copied = allowClipboard();
  const expire = captureFeedbackTimer();
  const button = { textContent: "#note-42", isConnected: true };
  await copyText(button, "#note-42");
  expect(copied).toEqual(["#note-42"]);
  expect(button.textContent).not.toBe("#note-42");
  expire();
  expect(button.textContent).toBe("#note-42");
});

test("icon feedback restores the accessible tooltip and removes the temporary state", async () => {
  allowClipboard();
  const expire = captureFeedbackTimer();
  const classes = new Set<string>();
  const button = {
    dataset: { tooltip: "Copy the full path" },
    isConnected: true,
    classList: {
      add: (name: string) => classes.add(name),
      remove: (name: string) => classes.delete(name),
    },
  };
  await copyText(button, "src/space name.ts", true);
  expect(classes.has("copied")).toBe(true);
  expire();
  expect(button.dataset.tooltip).toBe("Copy the full path");
  expect(classes.has("copied")).toBe(false);
});

test("expired feedback does not rewrite a detached button", async () => {
  allowClipboard();
  const expire = captureFeedbackTimer();
  const button = { textContent: "Copy", isConnected: true };
  await copyText(button, "reference");
  button.isConnected = false;
  button.textContent = "Reused elsewhere";
  expire();
  expect(button.textContent).toBe("Reused elsewhere");
});

test("an unavailable clipboard offers the original reference for manual copying", async () => {
  const offered: string[] = [];
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {},
  });
  Object.defineProperty(globalThis, "prompt", {
    configurable: true,
    value: (_label: string, value: string) => offered.push(value),
  });
  await copyText({}, "#first\n#second");
  expect(offered).toEqual(["#first\n#second"]);
});

test("expired icon feedback leaves a detached and repurposed button alone", async () => {
  allowClipboard();
  const expire = captureFeedbackTimer();
  const classes = new Set<string>();
  const button = {
    dataset: { tooltip: "Copy path" },
    isConnected: true,
    classList: {
      add: (name: string) => classes.add(name),
      remove: (name: string) => classes.delete(name),
    },
  };
  await copyText(button, "src/app.ts", true);
  button.isConnected = false;
  button.dataset.tooltip = "Another action";
  expire();
  expect(button.dataset.tooltip).toBe("Another action");
  expect(classes.has("copied")).toBe(true);
});
