import { afterEach, expect, test } from "bun:test";
import { state } from "../app/state.ts";

const globals = ["document", "window", "IntersectionObserver"];
const originals = globals.map(
  (name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
);
function restoreGlobals() {
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as any)[name];
  }
}
// The note module wires the page's controls on import. These inert nodes stand in for the shell;
// each test supplies the actual row and textarea involved in the editing gesture below.
const control = { addEventListener() {} };
Object.assign(globalThis, {
  document: {
    getElementById: () => control,
    querySelector: () => control,
    addEventListener() {},
  },
  window: { addEventListener() {} },
  IntersectionObserver: class {
    observe() {}
  },
});
const { busyEditor } = await import("./notes.ts");
restoreGlobals();
const saved = {
  notes: state.notes,
  draftRow: state.draftRow,
  draftKey: state.draftKey,
  draftAt: state.draftAt,
};
afterEach(() => {
  Object.assign(state, saved);
  restoreGlobals();
});

function fixture(savedNote: boolean, body = "") {
  const id = "a.ts|n1|n1|#saved";
  const reply = { value: body };
  const row = {
    dataset: { nid: id },
    isConnected: true,
    parentElement: { id: "notes" },
    querySelector: () => reply,
    remove() {
      this.isConnected = false;
    },
  };
  state.notes = new Map(
    savedNote ? [[id, { id, body: "Keep this note" }]] : [],
  );
  state.draftRow = row;
  state.draftKey = "draft";
  state.draftAt = { fi: 0, i: 0, j: 0 };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      querySelector: () => null,
      querySelectorAll: () => [],
      getElementById: () => null,
    },
  });
  return { row, id };
}

test("opening an editor never discards a saved note tracked as the last draft", () => {
  const { row, id } = fixture(true);
  // A saved note now has an empty reply textarea. It must not be mistaken for an empty draft.
  expect(busyEditor()).toBe(false);
  expect(row.isConnected).toBe(true);
  expect(state.notes.get(id).body).toBe("Keep this note");
  expect(state.draftRow).toBeNull();
});

test("an untouched unsaved draft still steps aside for another editor", () => {
  const { row } = fixture(false);
  expect(busyEditor()).toBe(false);
  expect(row.isConnected).toBe(false);
});

test("cleanup leaves a draft containing text mounted", () => {
  const { row } = fixture(false, "Still writing");
  busyEditor();
  expect(row.isConnected).toBe(true);
});
