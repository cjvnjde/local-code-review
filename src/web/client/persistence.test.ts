import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  clearBookmarks,
  clearNotes,
  loadCfg,
  persistCfg,
  pruneViewed,
  restore,
  restoreBookmarks,
  save,
  saveBookmarks,
  saveCfg,
  unviewCommented,
} from "./persistence.ts";
import { isMinted, state } from "./state.ts";

class MemoryStorage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, String(value));
  }
}

const localDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage",
);
const sessionDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "sessionStorage",
);
const documentDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "document",
);
const savedCfg = { ...state.cfg };
const savedState = {
  repo: state.repo,
  range: state.range,
  reviewId: state.reviewId,
  files: state.files,
  byPath: state.byPath,
  notes: state.notes,
  hidden: state.hidden,
  shown: state.shown,
  collapsed: state.collapsed,
  folded: state.folded,
  viewed: state.viewed,
  delFold: state.delFold,
  bookmarks: state.bookmarks,
  bmCur: state.bmCur,
  msgs: state.msgs,
  seen: state.seen,
  place: state.place,
  hideRx: state.hideRx,
  soloKeys: state.soloKeys,
  cfg: state.cfg,
};
let local: MemoryStorage;
let session: MemoryStorage;
type Control = {
  checked: boolean;
  disabled: boolean;
  value: string;
};

let controls: Record<string, Control>;

const note = (file: string, id = `${file}|n1|n1|#a`) => ({
  id,
  file,
  body: "x",
  a: "n1",
  b: "n1",
  start: 1,
  end: 1,
});

const storeKey = () => (
  `gitreview:${state.repo}:${state.reviewId ? `#${state.reviewId}` : state.range}`
);

const putStored = (value: unknown) => {
  local.setItem(storeKey(), JSON.stringify(value));
};

const restoreProperty = (
  name: "document" | "localStorage" | "sessionStorage",
  descriptor: PropertyDescriptor | undefined,
) => {
  if (descriptor) {
    Object.defineProperty(globalThis, name, descriptor);
  } else {
    Reflect.deleteProperty(globalThis, name);
  }
};

beforeEach(() => {
  local = new MemoryStorage();
  session = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: local,
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: session,
  });

  state.repo = "repo-a";
  state.range = "main..HEAD";
  state.reviewId = "";
  state.files = [];
  state.byPath = new Map();
  state.notes = new Map();
  state.hidden = new Set();
  state.shown = new Set();
  state.collapsed = new Set();
  state.folded = new Set();
  state.viewed = new Map();
  state.delFold = new Map();
  state.bookmarks = new Map();
  state.bmCur = "";
  state.msgs = new Map();
  state.seen = new Map();
  state.place = new Map();

  controls = {
    cfgAuto: { checked: state.cfg.auto, disabled: false, value: "" },
    cfgBack: { checked: state.cfg.back, disabled: false, value: "" },
    cfgToast: { checked: state.cfg.toast, disabled: false, value: "" },
    cfgLimit: { checked: false, disabled: false, value: String(state.cfg.limit) },
    cfgExpand: { checked: false, disabled: false, value: String(state.cfg.expand) },
    cfgHide: { checked: false, disabled: false, value: state.cfg.hide },
    cfgDeleted: { checked: state.cfg.hideDeleted, disabled: false, value: "" },
    cfgEnter: { checked: state.cfg.enterSaves, disabled: false, value: "" },
    cfgSingle: { checked: state.cfg.single, disabled: false, value: "" },
    cfgGhosts: { checked: state.cfg.ghosts, disabled: false, value: "" },
    cfgEditor: { checked: false, disabled: false, value: state.cfg.editor },
  };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      getElementById(id: string) {
        return controls[id] ?? null;
      },
    },
  });
});

afterEach(() => {
  Object.assign(state, savedState);
  Object.assign(state.cfg, savedCfg);
  restoreProperty("localStorage", localDescriptor);
  restoreProperty("sessionStorage", sessionDescriptor);
  restoreProperty("document", documentDescriptor);
});

describe("settings persistence", () => {
  test("loadCfg hydrates state and every settings control", () => {
    local.setItem("gitreview:settings", JSON.stringify({
      auto: false,
      back: true,
      toast: false,
      limit: 240,
      expand: 12,
      hide: "*.snap",
      hideDeleted: true,
      enterSaves: true,
      single: true,
      ghosts: false,
      editor: "code",
    }));

    loadCfg();

    expect(state.cfg).toMatchObject({
      auto: false,
      back: true,
      toast: false,
      limit: 240,
      expand: 12,
      hide: "*.snap",
      hideDeleted: true,
      enterSaves: true,
      single: true,
      ghosts: false,
      editor: "code",
    });
    expect(controls).toMatchObject({
      cfgAuto: { checked: false },
      cfgBack: { checked: true, disabled: true },
      cfgToast: { checked: false },
      cfgLimit: { value: "240" },
      cfgExpand: { value: "12" },
      cfgHide: { value: "*.snap" },
      cfgDeleted: { checked: true },
      cfgEnter: { checked: true },
      cfgSingle: { checked: true },
      cfgGhosts: { checked: false },
      cfgEditor: { value: "code" },
    });
    expect(state.hideRx.some((pattern: RegExp) => (
      pattern.test("src/app.snap")
    ))).toBe(true);
  });

  test("saveCfg persists controls and reports a display-affecting change", () => {
    controls.cfgAuto.checked = false;
    controls.cfgBack.checked = false;
    controls.cfgToast.checked = false;
    controls.cfgLimit.value = "320";
    controls.cfgEnter.checked = true;
    controls.cfgSingle.checked = true;
    controls.cfgEditor.value = "  code  ";
    controls.cfgHide.value = "dist/";
    controls.cfgDeleted.checked = true;
    controls.cfgExpand.value = "12";
    controls.cfgGhosts.checked = false;

    expect(saveCfg()).toBe(true);

    expect(state.cfg).toMatchObject({
      auto: false,
      back: false,
      toast: false,
      limit: 320,
      enterSaves: true,
      single: true,
      editor: "code",
      hide: "dist/",
      hideDeleted: true,
      expand: 12,
      ghosts: false,
    });
    expect(controls.cfgBack.disabled).toBe(true);
    expect(JSON.parse(local.getItem("gitreview:settings") ?? "null"))
      .toMatchObject({
        editor: "code",
        hide: "dist/",
        hideDeleted: true,
        expand: 12,
        ghosts: false,
      });
  });

  test("saveCfg does not request a redraw for non-rendering settings", () => {
    controls.cfgAuto.checked = false;
    controls.cfgBack.checked = false;
    controls.cfgToast.checked = false;
    controls.cfgLimit.value = "500";
    controls.cfgEnter.checked = true;
    controls.cfgSingle.checked = true;
    controls.cfgEditor.value = "code";

    expect(saveCfg()).toBe(false);

    expect(state.cfg).toMatchObject({
      auto: false,
      back: false,
      toast: false,
      limit: 500,
      enterSaves: true,
      single: true,
      editor: "code",
    });
    expect(controls.cfgBack.disabled).toBe(true);
  });
});

describe("note persistence", () => {
  test("saves the durable review state under the repository and range", () => {
    const savedNote = note("src/app.ts");
    state.notes = new Map([[savedNote.id, savedNote]]);
    state.hidden = new Set(["src/hidden.ts"]);
    state.shown = new Set(["src/shown.ts"]);
    state.collapsed = new Set(["src/folded.ts"]);
    state.folded = new Set(["src/viewed.ts"]);
    state.viewed = new Map([
      ["src/viewed.ts", { h: "diff-hash", auto: false }],
    ]);
    state.delFold = new Map([["src/app.ts", true]]);
    state.msgs = new Map([
      [savedNote.id, [{ role: "agent", body: "Done." }]],
    ]);
    state.seen = new Map([[savedNote.id, 1]]);

    save();

    expect(JSON.parse(local.getItem(storeKey()) ?? "null")).toEqual({
      notes: [savedNote],
      hidden: ["src/hidden.ts"],
      shown: ["src/shown.ts"],
      collapsed: ["src/folded.ts"],
      folded: ["src/viewed.ts"],
      viewed: [["src/viewed.ts", { h: "diff-hash", auto: false }]],
      delFold: [["src/app.ts", true]],
      msgs: [[savedNote.id, [{ role: "agent", body: "Done." }]]],
      seen: [[savedNote.id, 1]],
    });
  });

  test("a named review is keyed by its id instead of its moving range", () => {
    state.reviewId = "auth-cleanup";
    state.notes = new Map([["a", note("src/app.ts")]]);

    save();

    expect(local.getItem("gitreview:repo-a:#auth-cleanup")).not.toBeNull();
    expect(local.getItem("gitreview:repo-a:main..HEAD")).toBeNull();
  });

  test("restores notes, display preferences, threads, and read state", () => {
    const savedNote = note("src/app.ts");
    putStored({
      notes: [savedNote],
      hidden: ["src/hidden.ts"],
      shown: ["src/shown.ts"],
      collapsed: ["src/collapsed.ts"],
      folded: ["src/folded.ts"],
      viewed: [
        ["src/app.ts", "legacy-hash"],
        ["src/other.ts", { h: "new-hash", auto: true }],
      ],
      delFold: [
        ["src/app.ts", 1],
        [42, true],
      ],
      msgs: [
        [savedNote.id, [{ role: "agent", body: "Done." }]],
        ["invalid", "not-an-array"],
      ],
      seen: [
        [savedNote.id, 1],
        ["", 2],
      ],
    });

    restore();

    expect([...state.notes.values()]).toEqual([savedNote]);
    expect([...state.hidden]).toEqual(["src/hidden.ts"]);
    expect([...state.shown]).toEqual(["src/shown.ts"]);
    expect([...state.collapsed]).toEqual(["src/collapsed.ts"]);
    expect([...state.folded]).toEqual(["src/folded.ts"]);
    expect([...state.viewed]).toEqual([
      ["src/app.ts", { h: "legacy-hash", auto: false }],
      ["src/other.ts", { h: "new-hash", auto: true }],
    ]);
    expect([...state.delFold]).toEqual([["src/app.ts", true]]);
    expect([...state.msgs]).toEqual([
      [savedNote.id, [{ role: "agent", body: "Done." }]],
    ]);
    expect([...state.seen]).toEqual([[savedNote.id, 1]]);
  });

  test("re-mints legacy location-derived ids as fresh unsubmitted notes", () => {
    putStored({
      notes: [{
        ...note("src/app.ts", "src/app.ts|n1|n1"),
        sentAt: 1234,
      }],
    });

    restore();

    const restored = [...state.notes.values()][0];
    expect(isMinted(restored.id)).toBe(true);
    expect(restored.id).not.toBe("src/app.ts|n1|n1");
    expect(restored.sentAt).toBe(0);
    expect(restored.file).toBe("src/app.ts");
  });

  test("migrates the legacy overall field into a global note", () => {
    putStored({ general: "  Check the whole review.  ", notes: [] });

    restore();

    const restored = [...state.notes.values()];
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({
      file: "",
      body: "Check the whole review.",
      a: "@",
      b: "@",
      scope: "global",
      start: 0,
      end: 0,
    });
    expect(isMinted(restored[0].id)).toBe(true);
  });

  test("malformed durable state is ignored without replacing current notes", () => {
    const current = note("src/current.ts");
    state.notes = new Map([[current.id, current]]);
    local.setItem(storeKey(), "{broken");

    restore();

    expect([...state.notes.values()]).toEqual([current]);
  });

  test("persistCfg writes quick settings that have no settings-panel field", () => {
    state.cfg.foldDel = true;
    state.cfg.navHidden = true;
    state.cfg.editor = "code";

    persistCfg();

    expect(JSON.parse(local.getItem("gitreview:settings") ?? "null"))
      .toMatchObject({
        foldDel: true,
        navHidden: true,
        editor: "code",
      });
  });
});

describe("bookmark persistence", () => {
  test("saves bookmarks in session storage with the current read stamp", () => {
    state.bookmarks = new Map([
      [
        "src/app.ts|n4",
        { key: "src/app.ts|n4", file: "src/app.ts", a: "n4" },
      ],
    ]);

    saveBookmarks();

    expect(JSON.parse(
      session.getItem("gitreview:bookmarks") ?? "null",
    )).toEqual({
      scope: "repo-a:main..HEAD",
      list: [{ key: "src/app.ts|n4", file: "src/app.ts", a: "n4" }],
    });
  });

  test("restores bookmarks only into the read that created them", () => {
    session.setItem("gitreview:bookmarks", JSON.stringify({
      scope: "repo-a:main..HEAD",
      list: [{ key: "src/app.ts|n4", file: "src/app.ts", a: "n4" }],
    }));
    state.bmCur = "src/old.ts|n1";

    restoreBookmarks();

    expect([...state.bookmarks.keys()]).toEqual(["src/app.ts|n4"]);
    expect(state.bmCur).toBe("");

    state.range = "other..HEAD";
    restoreBookmarks();
    expect(state.bookmarks.size).toBe(0);
  });

  test("restore reads session bookmarks even when no durable notes exist", () => {
    session.setItem("gitreview:bookmarks", JSON.stringify({
      scope: "repo-a:main..HEAD",
      list: [{ key: "src/app.ts|n4", file: "src/app.ts", a: "n4" }],
    }));

    restore();

    expect([...state.bookmarks.keys()]).toEqual(["src/app.ts|n4"]);
  });

  test("clearBookmarks clears both memory and the session record", () => {
    state.bookmarks = new Map([
      [
        "src/app.ts|n4",
        { key: "src/app.ts|n4", file: "src/app.ts", a: "n4" },
      ],
    ]);
    state.bmCur = "src/app.ts|n4";

    clearBookmarks();

    expect(state.bookmarks.size).toBe(0);
    expect(state.bmCur).toBe("");
    expect(JSON.parse(
      session.getItem("gitreview:bookmarks") ?? "null",
    )).toEqual({
      scope: "repo-a:main..HEAD",
      list: [],
    });
  });
});

describe("review progress cleanup", () => {
  test("only files that carry a note lose the viewed mark", () => {
    state.notes = new Map([
      ["a", note("src/a.ts")],
      ["b", note("src/b.ts")],
    ]);
    state.viewed = new Map([
      ["src/a.ts", { h: "h1", auto: false }],
      ["src/c.ts", { h: "h3", auto: false }],
    ]);
    state.folded = new Set(["src/a.ts", "src/c.ts"]);

    expect([...unviewCommented()].sort()).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
    expect([...state.viewed.keys()]).toEqual(["src/c.ts"]);
    expect([...state.folded]).toEqual(["src/c.ts"]);
  });

  test("two notes on one file unview it once and leave the rest alone", () => {
    state.notes = new Map([
      ["a1", note("src/a.ts", "src/a.ts|n1|n1|#a")],
      ["a2", note("src/a.ts", "src/a.ts|n2|n2|#b")],
    ]);
    state.viewed = new Map([
      ["src/a.ts", { h: "h1", auto: true }],
    ]);
    state.folded = new Set<string>();

    expect([...unviewCommented()]).toEqual(["src/a.ts"]);
    expect(state.viewed.size).toBe(0);
  });

  test("no notes means every viewed mark survives", () => {
    state.notes = new Map();
    state.viewed = new Map([
      ["src/a.ts", { h: "h1", auto: false }],
    ]);
    state.folded = new Set(["src/a.ts"]);

    expect(unviewCommented().size).toBe(0);
    expect(state.viewed.size).toBe(1);
    expect(state.folded.size).toBe(1);
  });

  test("clearNotes drops feedback state but preserves display preferences", () => {
    const commented = note("src/app.ts");
    state.notes = new Map([[commented.id, commented]]);
    state.msgs = new Map([[commented.id, [{ role: "agent", body: "Done." }]]]);
    state.seen = new Map([[commented.id, 1]]);
    state.place = new Map([[commented.id, { fi: 0, i: 1 }]]);
    state.hidden = new Set(["src/hidden.ts"]);
    state.viewed = new Map([
      ["src/app.ts", { h: "h1", auto: false }],
      ["src/other.ts", { h: "h2", auto: false }],
    ]);
    state.folded = new Set(["src/app.ts", "src/other.ts"]);

    expect([...clearNotes()]).toEqual(["src/app.ts"]);

    expect(state.notes.size).toBe(0);
    expect(state.msgs.size).toBe(0);
    expect(state.seen.size).toBe(0);
    expect(state.place.size).toBe(0);
    expect([...state.hidden]).toEqual(["src/hidden.ts"]);
    expect([...state.viewed.keys()]).toEqual(["src/other.ts"]);
    expect([...state.folded]).toEqual(["src/other.ts"]);
    expect(JSON.parse(local.getItem(storeKey()) ?? "null").notes).toEqual([]);
  });

  test("pruneViewed removes changed and missing files but keeps exact matches", () => {
    state.files = [
      { path: "src/current.ts", hash: "same" },
      { path: "src/changed.ts", hash: "new" },
    ];
    state.byPath = new Map([
      ["src/current.ts", 0],
      ["src/changed.ts", 1],
    ]);
    state.viewed = new Map([
      ["src/current.ts", { h: "same", auto: false }],
      ["src/changed.ts", { h: "old", auto: false }],
      ["src/gone.ts", { h: "gone", auto: false }],
    ]);
    state.folded = new Set([
      "src/current.ts",
      "src/changed.ts",
      "src/gone.ts",
    ]);

    expect(pruneViewed()).toEqual(["src/changed.ts", "src/gone.ts"]);
    expect([...state.viewed.keys()]).toEqual(["src/current.ts"]);
    expect([...state.folded]).toEqual(["src/current.ts"]);
  });
});
