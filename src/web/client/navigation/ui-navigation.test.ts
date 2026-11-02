import { expect, test } from "bun:test";
import { createUiNavigation, type UiNavigation } from "./ui-navigation.ts";

class BrowserHistory {
  entries: { href: string; state: Record<string, unknown> | null }[];
  at = 0;
  pushes = 0;
  moves: number[] = [];
  pending: number[] = [];
  listeners = new Map<string, (() => void)[]>();

  constructor(
    href = "https://review.test/review?session=a",
    state: Record<string, unknown> | null = { unrelated: true },
  ) {
    this.entries = [{ href, state }];
  }

  get location() {
    return { href: this.entries[this.at].href };
  }

  get history() {
    const browser = this;
    return {
      get state() {
        return browser.entries[browser.at].state;
      },
      pushState(
        state: Record<string, unknown> | null,
        _title: string,
        url?: string | URL | null,
      ) {
        browser.pushes++;
        browser.entries.splice(++browser.at);
        browser.entries.push({
          href: String(url ?? browser.location.href),
          state,
        });
      },
      replaceState(
        state: Record<string, unknown> | null,
        _title: string,
        url?: string | URL | null,
      ) {
        browser.entries[browser.at] = {
          href: String(url ?? browser.location.href),
          state,
        };
      },
      go(delta = 0) {
        browser.moves.push(delta);
        browser.pending.push(delta);
      },
    };
  }

  addEventListener(type: "popstate" | "hashchange", listener: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emit(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }

  move(delta: number) {
    const before = this.location.href;
    this.at = Math.max(0, Math.min(this.entries.length - 1, this.at + delta));
    this.emit("popstate");
    if (new URL(before).hash !== new URL(this.location.href).hash)
      this.emit("hashchange");
  }

  flush() {
    for (let count = 0; this.pending.length; count++) {
      if (count > 20) throw new Error("Navigation did not settle");
      this.move(this.pending.shift()!);
    }
  }

  hash(hash: string) {
    const url = new URL(this.location.href);
    url.hash = hash;
    this.entries.splice(++this.at);
    this.entries.push({ href: url.href, state: null });
    this.emit("popstate");
    this.emit("hashchange");
  }
}

function fixture(href?: string) {
  const browser = new BrowserHistory(href);
  const route = createUiNavigation(browser);
  const shown = new Map<string, string | null>();
  const calls: string[] = [];
  for (const [key, priority] of [
    ["notes", 0],
    ["note", 10],
    ["editor", 20],
    ["annotation", 30],
  ] as const) {
    route.registerView(
      key,
      {
        restore(value) {
          shown.set(key, value);
          calls.push(`${key}:${value}`);
        },
      },
      priority,
    );
  }
  route.startNavigation();
  calls.length = 0;
  return { browser, route, shown, calls };
}

function apply(
  route: UiNavigation,
  shown: Map<string, string | null>,
  key: string,
  value: string | null,
) {
  shown.set(key, value);
  route.setView(key, value);
}

test("startup restores all views in priority order and preserves unknown URL/state data", () => {
  const browser = new BrowserHistory(
    "https://review.test/review?session=a#unknown=keep&editor=draft&notes=open&note=stable",
  );
  const route = createUiNavigation(browser);
  const calls: string[] = [];
  route.registerView(
    "editor",
    {
      restore: (value) => {
        calls.push(`editor:${value}`);
      },
    },
    20,
  );
  route.registerView(
    "note",
    {
      restore: (value) => {
        calls.push(`note:${value}`);
      },
    },
    10,
  );
  route.registerView("notes", {
    restore: (value) => {
      calls.push(`notes:${value}`);
    },
  });
  route.startNavigation();
  route.startNavigation();
  expect(calls).toEqual(["notes:open", "note:stable", "editor:draft"]);
  route.setView("settings", "1");
  const url = new URL(browser.location.href);
  expect(url.pathname + url.search).toBe("/review?session=a");
  expect(new URLSearchParams(url.hash.slice(1)).get("unknown")).toBe("keep");
  expect(route.viewValue("editor")).toBe("draft");
  expect(browser.history.state?.unrelated).toBe(true);
  expect(browser.pushes).toBe(1);
});

test("Back and Forward replay composite views once without pushing routes", () => {
  const f = fixture();
  apply(f.route, f.shown, "notes", "open");
  apply(f.route, f.shown, "note", "note-a");
  apply(f.route, f.shown, "editor", '{"note":"note-a"}');
  f.browser.move(-3);
  expect(f.calls).toEqual(["notes:null", "note:null", "editor:null"]);
  expect(f.browser.pushes).toBe(3);
  f.calls.length = 0;
  f.browser.move(3);
  expect(f.calls).toEqual([
    "notes:open",
    "note:note-a",
    'editor:{"note":"note-a"}',
  ]);
  expect(f.browser.entries.length).toBe(4);
  expect(f.browser.pushes).toBe(3);
});

test("repeated routes deduplicate and internal controls replace their entry", () => {
  const f = fixture();
  f.route.setView("notes", "all");
  f.route.setView("notes", "all");
  f.route.setView("note", null);
  f.route.setView("notes", "open", { replace: true });
  expect(f.browser.entries.length).toBe(2);
  expect(f.browser.pushes).toBe(1);
  f.browser.move(-1);
  expect(f.route.viewValue("notes")).toBeNull();
  f.browser.move(1);
  expect(f.route.viewValue("notes")).toBe("open");
});

test("dirty Back cancellation restores the current entry without losing Forward", () => {
  const f = fixture();
  f.route.setView("notes", "all");
  f.route.setView("editor", "draft");
  f.route.setView("annotation", "capture.area");
  f.browser.move(-1);
  let dirty = true;
  const guards: string[] = [];
  f.route.registerView(
    "editor",
    {
      restore() {
        throw new Error("Canceled traversal must not restore");
      },
      canLeave() {
        guards.push("editor");
        return !dirty;
      },
    },
    20,
  );
  f.route.registerView("notes", {
    restore() {
      throw new Error("Canceled traversal must not restore");
    },
    canLeave() {
      guards.push("notes");
      return true;
    },
  });
  const href = f.browser.location.href;
  f.calls.length = 0;
  f.browser.move(-1);
  expect(guards).toEqual(["editor"]);
  expect(f.calls).toEqual([]);
  f.browser.flush();
  expect(f.browser.at).toBe(2);
  expect(f.browser.location.href).toBe(href);
  expect(f.browser.entries.length).toBe(4);
  expect(f.browser.pushes).toBe(3);
  dirty = false;
  f.browser.move(1);
  expect(f.route.viewValue("annotation")).toBe("capture.area");
  expect(f.browser.at).toBe(3);
});

test("dirty Forward cancellation returns backwards and keeps the forward entry", () => {
  const f = fixture();
  f.route.setView("notes", "all");
  f.route.setView("note", "note-a");
  f.browser.move(-1);
  let dirty = true;
  f.route.registerView(
    "editor",
    {
      restore() {},
      canLeave() {
        return !dirty;
      },
    },
    20,
  );
  const href = f.browser.location.href;
  f.browser.move(1);
  f.browser.flush();
  expect(f.browser.at).toBe(1);
  expect(f.browser.location.href).toBe(href);
  expect(f.browser.moves).toEqual([-1]);
  dirty = false;
  f.browser.move(1);
  expect(f.route.viewValue("note")).toBe("note-a");
});

test("all guards run reverse-priority even when their own route key is unchanged", () => {
  const f = fixture();
  const calls: string[] = [];
  for (const [key, priority] of [
    ["notes", 0],
    ["editor", 20],
    ["annotation", 30],
  ] as const) {
    f.route.registerView(
      key,
      {
        restore() {
          calls.push(`restore:${key}`);
        },
        canLeave() {
          calls.push(`guard:${key}`);
          return true;
        },
      },
      priority,
    );
  }
  f.route.setView("notes", "open");
  f.browser.move(-1);
  expect(calls).toEqual([
    "guard:annotation",
    "guard:editor",
    "guard:notes",
    "restore:notes",
  ]);
});

test("declared dependencies restore an unchanged editor after its underlying panel", () => {
  const f = fixture("https://review.test/review#notes=all&editor=draft");
  f.route.registerView(
    "editor",
    {
      dependencies: ["notes", "note"],
      restore(value) {
        f.calls.push(`editor:${value}`);
      },
    },
    20,
  );
  f.route.setView("notes", "open");
  f.browser.move(-1);
  expect(f.calls).toEqual(["notes:all", "editor:draft"]);
});

test("explicit close consumes only a known matching predecessor, with no repeated guard", () => {
  const f = fixture();
  f.route.setView("notes", "all");
  f.route.registerView("notes", {
    restore() {},
    canLeave() {
      throw new Error("Already closed");
    },
  });
  f.route.setView("notes", null, { close: true });
  f.route.setView("notes", null, { close: true });
  f.browser.flush();
  expect(f.browser.at).toBe(0);
  expect(f.browser.moves).toEqual([-1]);
  expect(f.browser.entries.length).toBe(2);
  f.route.registerView("notes", { restore() {} });
  f.browser.move(1);
  expect(f.route.viewValue("notes")).toBe("all");
});

test("direct-load close pushes a safe route instead of leaving the review", () => {
  const f = fixture("https://review.test/review#notes=open&unknown=keep");
  f.route.setView("notes", null, { close: true });
  expect(f.browser.moves).toEqual([]);
  expect(f.browser.entries.length).toBe(2);
  expect(f.route.viewValue("notes")).toBeNull();
  expect(f.route.viewValue("unknown")).toBe("keep");
  f.browser.move(-1);
  expect(f.route.viewValue("notes")).toBe("open");
});

test("close pushes when the preceding route differs in other view keys", () => {
  const f = fixture();
  f.route.setView("notes", "all");
  f.route.setView("note", "note-a");
  f.route.setView("notes", null, { close: true });
  expect(f.browser.moves).toEqual([]);
  expect(f.browser.entries.length).toBe(4);
  expect(f.route.viewValue("note")).toBe("note-a");
});

test("reload retains known predecessor metadata for safe explicit close", () => {
  const f = fixture();
  f.route.setView("notes", "all");
  f.browser.listeners.clear();
  const reloaded = createUiNavigation(f.browser);
  const restored: (string | null)[] = [];
  reloaded.registerView("notes", {
    restore(value) {
      restored.push(value);
    },
  });
  reloaded.startNavigation();
  expect(restored).toEqual(["all"]);
  reloaded.setView("notes", null, { close: true });
  f.browser.flush();
  expect(f.browser.at).toBe(0);
  expect(f.browser.moves).toEqual([-1]);
  f.browser.move(1);
  expect(restored.at(-1)).toBe("all");
});

test("invalid and throwing routes are removed without blocking valid views or recording replay", () => {
  const browser = new BrowserHistory(
    "https://review.test/review#history=%7Bbad&note=stale&settings=1&unknown=keep",
    { lcrHistory: { legacy: true }, other: 42 },
  );
  const route = createUiNavigation(browser);
  const shown: (string | null)[] = [];
  route.registerView("history", {
    restore(value) {
      if (value) JSON.parse(value);
    },
  });
  route.registerView(
    "note",
    {
      restore(value) {
        return value === null;
      },
    },
    10,
  );
  route.registerView("settings", {
    restore(value) {
      shown.push(value);
      route.setView("notes", "all");
    },
  });
  route.startNavigation();
  expect(route.viewValue("history")).toBeNull();
  expect(route.viewValue("note")).toBeNull();
  expect(route.viewValue("unknown")).toBe("keep");
  expect(route.viewValue("notes")).toBeNull();
  expect(shown).toEqual(["1"]);
  expect(browser.pushes).toBe(0);
  expect(browser.history.state?.lcrHistory).toEqual({ legacy: true });
  expect(browser.history.state?.other).toBe(42);
});

test("manual hash navigation restores once and subsequent Back and Forward remain usable", () => {
  const f = fixture();
  f.browser.hash("notes=open&note=note-a&unknown=keep");
  expect(f.calls).toEqual(["notes:open", "note:note-a"]);
  expect(f.browser.pushes).toBe(0);
  f.calls.length = 0;
  f.browser.move(-1);
  expect(f.calls).toEqual(["notes:null", "note:null"]);
  f.browser.move(1);
  expect(f.route.viewValue("notes")).toBe("open");
  expect(f.route.viewValue("unknown")).toBe("keep");
});

test("dirty foreign fragment changes are conservatively replaced, never pushed or guessed", () => {
  const f = fixture();
  f.route.registerView(
    "editor",
    {
      restore() {},
      canLeave() {
        return false;
      },
    },
    20,
  );
  const href = f.browser.location.href;
  f.browser.hash("notes=done");
  expect(f.browser.location.href).toBe(href);
  expect(f.route.viewValue("notes")).toBeNull();
  expect(f.browser.moves).toEqual([]);
  expect(f.browser.pushes).toBe(0);
});

test("malformed controller state is replaced without clobbering independent state", () => {
  const browser = new BrowserHistory("https://review.test/review#notes=open", {
    lcrUiNavigation: { index: "bad" },
    other: "kept",
  });
  const route = createUiNavigation(browser);
  route.registerView("notes", { restore() {} });
  route.startNavigation();
  route.setView("notes", null, { close: true });
  expect(browser.moves).toEqual([]);
  expect(browser.history.state?.other).toBe("kept");
  expect(browser.entries.length).toBe(2);
});

test("atomic multi-view transitions produce one merged route and replay in priority order", () => {
  const f = fixture(
    "https://review.test/review#notes=open&editor=draft&unknown=keep",
  );
  f.route.setViews({ notes: null, editor: null, note: "note-a" });
  expect(f.browser.pushes).toBe(1);
  expect(f.route.viewValue("notes")).toBeNull();
  expect(f.route.viewValue("editor")).toBeNull();
  expect(f.route.viewValue("note")).toBe("note-a");
  expect(f.route.viewValue("unknown")).toBe("keep");
  f.route.setViews({ editor: null, note: "note-a", notes: null });
  expect(f.browser.pushes).toBe(1);
  f.browser.move(-1);
  expect(f.calls).toEqual(["notes:open", "note:null", "editor:draft"]);
  f.calls.length = 0;
  f.browser.move(1);
  expect(f.calls).toEqual(["notes:null", "note:note-a", "editor:null"]);
});

test("later dependent restorers see invalid routes already removed from the target", () => {
  const browser = new BrowserHistory(
    "https://review.test/review#notes=invalid&editor=draft",
  );
  const route = createUiNavigation(browser);
  const values: (string | null)[] = [];
  route.registerView("notes", {
    restore(value) {
      return value === null;
    },
  });
  route.registerView(
    "editor",
    {
      restore() {
        values.push(route.viewValue("notes"));
      },
    },
    20,
  );
  route.startNavigation();
  expect(values).toEqual([null]);
  expect(route.viewValue("notes")).toBeNull();
});
