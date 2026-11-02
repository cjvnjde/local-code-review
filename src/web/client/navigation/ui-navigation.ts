export type ViewHandler = {
  restore(value: string | null): boolean | void;
  canLeave?(next: string | null): boolean;
  dependencies?: string[];
};

type ViewOptions = { replace?: boolean; close?: boolean };
type NavigationHost = {
  readonly location: { readonly href: string };
  readonly history: Pick<
    History,
    "state" | "pushState" | "replaceState" | "go"
  >;
  addEventListener(type: "popstate" | "hashchange", listener: () => void): void;
};

export type UiNavigation = {
  registerView(key: string, handler: ViewHandler, priority?: number): void;
  setView(key: string, value: string | null, options?: ViewOptions): void;
  setViews(values: Record<string, string | null>, options?: ViewOptions): void;
  viewValue(key: string): string | null;
  startNavigation(): void;
};
type Entry = {
  session: string;
  index: number;
  previous?: { href: string; index: number };
};

// Keep this separate from feature state and preserve all other history.state keys.
const STATE_KEY = "lcrUiNavigation";

function entry(state: unknown): Entry | null {
  if (!state || typeof state !== "object" || !(STATE_KEY in state)) return null;
  const value = state[STATE_KEY];
  if (
    !value ||
    typeof value !== "object" ||
    !("session" in value) ||
    typeof value.session !== "string" ||
    !("index" in value) ||
    typeof value.index !== "number" ||
    !Number.isSafeInteger(value.index) ||
    value.index < 0
  )
    return null;
  const result: Entry = { session: value.session, index: value.index };
  if (
    "previous" in value &&
    value.previous &&
    typeof value.previous === "object" &&
    "href" in value.previous &&
    typeof value.previous.href === "string" &&
    "index" in value.previous &&
    value.previous.index === value.index - 1
  )
    result.previous = { href: value.previous.href, index: value.index - 1 };
  return result;
}

function parameters(href: string): URLSearchParams {
  return new URLSearchParams(new URL(href).hash.slice(1));
}

function withValues(
  href: string,
  updates: Record<string, string | null>,
): string {
  const url = new URL(href);
  const values = parameters(href);
  let changed = false;
  for (const [key, value] of Object.entries(updates)) {
    if (values.get(key) === value) continue;
    changed = true;
    if (value === null) values.delete(key);
    else values.set(key, value);
  }
  if (!changed) return href;
  url.hash = values.toString();
  return url.href;
}

/** A synchronous route coordinator; the host is injectable for browser-free tests. */
export function createUiNavigation(host: NavigationHost): UiNavigation {
  const views = new Map<string, { handler: ViewHandler; priority: number }>();
  let started = false;
  let restoring = false;
  let restoringValues: URLSearchParams | null = null;
  let returning = false;
  let closing = false;
  let appliedHref = host.location.href;
  let currentHref = appliedHref;
  let currentEntry: Entry | null = null;

  function freshEntry(): Entry {
    return {
      session: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
      index: 0,
    };
  }

  function state(value: Entry) {
    const other = host.history.state;
    return {
      ...(other && typeof other === "object" ? other : {}),
      [STATE_KEY]: value,
    };
  }

  function replace(href: string, value: Entry) {
    host.history.replaceState(state(value), "", href);
  }

  function restore(href: string, all = false) {
    const before = parameters(appliedHref);
    const after = parameters(href);
    restoring = true;
    restoringValues = after;
    try {
      for (const [key, { handler }] of [...views.entries()].sort(
        (a, b) => a[1].priority - b[1].priority,
      )) {
        const value = after.get(key);
        if (
          !all &&
          before.get(key) === value &&
          !handler.dependencies?.some(
            (dependency) => before.get(dependency) !== after.get(dependency),
          )
        )
          continue;
        let valid: boolean | void;
        try {
          valid = handler.restore(value);
        } catch {
          // Bad/stale route data must not strand the rest of the interface.
          valid = false;
        }
        if (valid === false) {
          after.delete(key);
          if (value !== null) {
            try {
              handler.restore(null);
            } catch {
              // Continue restoring independent views even if cleanup fails.
            }
          }
        }
      }
    } finally {
      restoring = false;
      restoringValues = null;
    }
    const url = new URL(href);
    url.hash = after.toString();
    appliedHref = url.href;
    currentHref = appliedHref;
    if (currentEntry && currentHref !== host.location.href)
      replace(currentHref, currentEntry);
  }

  function canLeave(href: string) {
    const after = parameters(href);
    for (const [key, { handler }] of [...views.entries()].sort(
      (a, b) => b[1].priority - a[1].priority,
    )) {
      if (!handler.canLeave) continue;
      try {
        if (!handler.canLeave(after.get(key))) return false;
      } catch {
        return false;
      }
    }
    return true;
  }

  function traversal() {
    const href = host.location.href;
    const next = entry(host.history.state);
    const sameEntry =
      next?.session === currentEntry?.session &&
      next?.index === currentEntry?.index;
    if (returning) {
      if (sameEntry) {
        returning = false;
        // A canceled traversal never replays handlers or records a new entry.
        if (href !== currentHref && currentEntry)
          replace(currentHref, currentEntry);
      }
      return;
    }
    // A traversal between fragment entries emits both popstate and hashchange.
    if (sameEntry && href === currentHref) return;
    if (!(closing && href === appliedHref) && !canLeave(href)) {
      closing = false;
      if (
        next &&
        currentEntry &&
        next.session === currentEntry.session &&
        !sameEntry
      ) {
        returning = true;
        host.history.go(currentEntry.index - next.index);
      } else if (currentEntry) {
        // Foreign entries have no trustworthy direction/distance. Do not guess
        // with go(), leave the document, or push and destroy Forward history.
        replace(currentHref, currentEntry);
      }
      return;
    }
    closing = false;
    currentEntry = next && !sameEntry ? next : freshEntry();
    replace(href, currentEntry);
    restore(href);
  }

  const controller: UiNavigation = {
    registerView(key: string, handler: ViewHandler, priority = 0) {
      views.set(key, { handler, priority });
    },
    setView(key: string, value: string | null, options?: ViewOptions) {
      controller.setViews({ [key]: value }, options);
    },
    setViews(values: Record<string, string | null>, options: ViewOptions = {}) {
      if (restoring || returning || closing) return;
      const href = withValues(appliedHref, values);
      if (href === appliedHref) return;
      if (!currentEntry) {
        currentEntry = entry(host.history.state) ?? freshEntry();
        replace(currentHref, currentEntry);
      }
      const previous = currentEntry;
      appliedHref = href; // The caller already applied the UI, including guards.
      if (
        options.close &&
        !options.replace &&
        previous.previous?.href === href &&
        previous.previous.index === previous.index - 1
      ) {
        closing = true;
        host.history.go(-1);
        return;
      }
      const next = options.replace
        ? previous
        : {
            session: previous.session,
            index: previous.index + 1,
            previous: { href: currentHref, index: previous.index },
          };
      if (options.replace) replace(href, next);
      else host.history.pushState(state(next), "", href);
      currentEntry = next;
      currentHref = href;
    },
    viewValue(key: string) {
      return (restoringValues ?? parameters(appliedHref)).get(key);
    },
    startNavigation() {
      if (started) return;
      started = true;
      currentHref = host.location.href;
      appliedHref = currentHref;
      currentEntry = entry(host.history.state) ?? freshEntry();
      replace(currentHref, currentEntry);
      host.addEventListener("popstate", traversal);
      host.addEventListener("hashchange", traversal);
      restore(currentHref, true);
    },
  };
  return controller;
}

let browserNavigation: UiNavigation | undefined;
const pendingViews = new Map<
  string,
  { handler: ViewHandler; priority: number }
>();

export function registerView(
  key: string,
  handler: ViewHandler,
  priority = 0,
): void {
  if (browserNavigation) browserNavigation.registerView(key, handler, priority);
  else pendingViews.set(key, { handler, priority });
}

export function setView(
  key: string,
  value: string | null,
  options?: ViewOptions,
): void {
  browserNavigation?.setView(key, value, options);
}

export function setViews(
  values: Record<string, string | null>,
  options?: ViewOptions,
): void {
  browserNavigation?.setViews(values, options);
}

export function viewValue(key: string): string | null {
  if (browserNavigation) return browserNavigation.viewValue(key);
  return typeof window === "undefined"
    ? null
    : parameters(window.location.href).get(key);
}

export function startNavigation(): void {
  if (!browserNavigation) {
    if (typeof window === "undefined") return;
    browserNavigation = createUiNavigation(window);
    for (const [key, { handler, priority }] of pendingViews)
      browserNavigation.registerView(key, handler, priority);
    pendingViews.clear();
  }
  browserNavigation.startNavigation();
}
