/** Runs in the reviewed page. Keep this function self-contained: its compiled source is injected by CDP. */
export function installPageReview(config: {
  key: string;
  binding: string;
  origin: string;
  reviewUrl: string;
  ownerKey?: string;
}) {
  const win = globalThis as any;
  if (
    window !== window.top ||
    location.origin !== config.origin ||
    win[config.key]
  )
    return;
  const ownerKey = config.ownerKey ?? "__lcr_page_review__";
  if (win[ownerKey] && win[ownerKey] !== config.key)
    throw new Error(
      "This tab is already connected to another lcr review. Stop that review or reload the tab before attaching.",
    );
  const lifecycle = new AbortController();
  let suspended = false;
  function listen(
    target: EventTarget,
    type: string,
    handler: (event: any) => void,
    options: boolean | AddEventListenerOptions = false,
  ) {
    const interaction =
      config.ownerKey &&
      /^(pointerdown|pointermove|pointerup|pointercancel|click|dblclick|contextmenu|keydown|blur|focusout|wheel|touchmove)$/.test(
        type,
      );
    target.addEventListener(
      type,
      interaction
        ? (event) => {
            if (!suspended) handler(event);
          }
        : handler,
      {
        ...(typeof options === "boolean" ? { capture: options } : options),
        signal: lifecycle.signal,
      },
    );
  }
  if (document.readyState === "loading") {
    win[ownerKey] = config.key;
    win[config.key] = {
      dispose() {
        lifecycle.abort();
        delete win[config.key];
        if (win[ownerKey] === config.key) delete win[ownerKey];
      },
    };
    listen(
      document,
      "DOMContentLoaded",
      () => {
        delete win[config.key];
        delete win[ownerKey];
        installPageReview(config);
      },
      { once: true },
    );
    return;
  }
  let disposed = false,
    lastReply = Date.now();
  const pending = new Map<
    number,
    {
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  let sequence = 0,
    mode = "element",
    selectionMode = "element",
    notes: any[] = [];
  let start: any = null,
    hovering: Element | null = null,
    busy = false;
  let frame: HTMLIFrameElement | null = null,
    activeToken = "",
    frameDirty = false,
    panelGeneration = 0;
  let frameKind: "draft" | "note" | "" = "",
    pendingWeb: any = undefined,
    draftWeb: any = null,
    capturingSelection: any = null,
    minimized = false,
    frameSaving = false,
    frameEditingOriginal = false,
    replyDraftId = "",
    pendingReply = false;
  let dockPosition = { x: innerWidth - 578, y: 18 },
    dockPress: {
      id: number;
      x: number;
      y: number;
      origin: { x: number; y: number };
    } | null = null;
  let dockSize: { width: number; height: number } | null = null;
  let resizePress: {
    id: number;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null = null;
  let annotationOpen = false,
    imagePreviewOpen = false;
  let expanded = false,
    suppressLauncherClick = false;
  let selected: Element[] = [],
    selectionUrl = location.href,
    multiple = false;
  let inspectBase: Element | null = null,
    inspectDepth = 0;
  type FrozenTarget = {
    selector: string;
    element?: {
      tag: string;
      text: string;
      attributes: Record<string, string>;
      styles: Record<string, string>;
    };
    components?: {
      framework: string;
      name: string;
      file?: string;
      line?: number;
    }[];
    rect: CaptureRect;
    above: string[];
  };
  let freezing = false;
  let frozen: {
    id: string;
    capture: any;
    image: HTMLImageElement;
    mode: string;
    selectionMode: string;
    targets: FrozenTarget[];
  } | null = null;
  let launcherPress: {
    id: number;
    x: number;
    y: number;
    origin: { x: number; y: number };
    moved: boolean;
    held: boolean;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  const reviewOrigin = new URL(config.reviewUrl).origin;
  const host = document.createElement("div");
  host.id = config.key;
  if (config.ownerKey) host.dataset.lcrOwner = config.ownerKey;
  host.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;pointer-events:none";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>
    :host{all:initial;--fs-body:13px;--fs-small:11px;--tap:32px;--tap-lg:30px;--icon:16px;--row:36px;--space-1:4px;--space-2:8px;--space-3:12px;--space-4:16px;--radius-sm:4px;--radius-md:8px;--bar-height:calc(var(--tap-lg) + var(--space-2)*2);--panel:#1e1e2e;--panel2:#181825;--crust:#11111b;--hover:#45475a;--edge:#313244;--ink:#cdd6f4;--ink-dim:#a6adc8;--accent:#89b4fa;--sel:#89b4fa24;--mark:#f9e2af;color:var(--ink);font:var(--fs-body)/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
    *{box-sizing:border-box}button,a{font:inherit}button,.review-link{min-width:var(--tap-lg);min-height:var(--tap-lg);border:0;background:transparent;color:inherit;border-radius:var(--radius-sm);padding:var(--space-1) var(--space-2);cursor:pointer}
    button:hover,.review-link:hover{background:var(--hover)}button:focus-visible,.review-link:focus-visible,.head b:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}button:disabled{opacity:.55;cursor:wait}button[aria-pressed=true]{background:var(--sel);color:var(--accent)}.review-link{text-decoration:none}
    .launcher{pointer-events:auto;position:fixed;left:var(--space-4);bottom:var(--space-4);width:calc(var(--tap) + var(--space-3));height:calc(var(--tap) + var(--space-3));padding:0;border-radius:50%;background:var(--panel2);font-weight:700;touch-action:none;cursor:grab;box-shadow:0 4px 24px #0005}
    .launcher:active{cursor:grabbing}
    .launcher[aria-pressed=true]{background:var(--accent);color:var(--crust);box-shadow:0 0 0 var(--space-1) var(--sel),0 4px 24px #0005}
    .mode-state{position:absolute;bottom:calc(-1 * var(--space-1));left:50%;transform:translateX(-50%);padding:0 var(--space-1);border-radius:var(--radius-sm);background:var(--panel);color:var(--ink-dim);font-size:var(--fs-small);line-height:var(--space-4)}
    .launcher[aria-pressed=true] .mode-state{background:var(--panel);color:var(--accent)}
    .bar{pointer-events:auto;position:fixed;display:flex;gap:var(--space-1);align-items:center;padding:var(--space-2);border:0;border-radius:var(--radius-md);background:var(--panel2);box-shadow:0 4px 24px #0005;max-width:calc(100vw - var(--space-3)*2);max-height:calc(100dvh - var(--space-3)*2);overflow:auto;flex-wrap:wrap}
    .brand{font-weight:700;padding:0 var(--space-2);color:var(--accent)}
    .outline{position:fixed;pointer-events:none;border:2px solid var(--accent);background:var(--sel);border-radius:var(--radius-sm);display:none}
    .label{position:absolute;bottom:100%;left:0;white-space:nowrap;padding:2px var(--space-2);border-radius:var(--radius-sm) var(--radius-sm) 0 0;background:var(--accent);color:var(--crust);font-size:var(--fs-small)}
    .dock{pointer-events:auto;position:fixed;right:var(--space-4);top:var(--space-4);height:calc(100dvh - 96px);width:min(560px,calc(100vw - var(--space-3)*2));max-width:calc(100vw - var(--space-3)*2);max-height:calc(100dvh - var(--space-3)*2);background:var(--panel2);border:0;box-shadow:0 8px 32px #0006;border-radius:var(--radius-md);display:flex;flex-direction:column;overflow:hidden}
    .dock.minimized{height:auto}.dock.minimized .content{position:absolute;top:100%;left:0;right:0;flex:none;height:var(--content-height);visibility:hidden;pointer-events:none}
    .resize{position:absolute;right:0;bottom:0;width:var(--tap-lg);height:var(--tap-lg);padding:0;border:0;border-radius:var(--radius-sm) 0 0 0;background:transparent;cursor:nwse-resize;touch-action:none;display:grid;place-items:center;color:var(--ink-dim)}
    .resize svg{width:var(--icon);height:var(--icon);pointer-events:none}.resize:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}.dock.minimized .resize{display:none}
    .resize:is(:hover,:focus-visible)::before{content:attr(title);position:absolute;right:var(--space-2);bottom:100%;width:calc(var(--tap) * 9);max-width:calc(100vw - var(--space-4)*2);padding:var(--space-2);border:1px solid var(--edge);border-radius:var(--radius-sm);background:var(--panel);color:var(--ink);font-size:var(--fs-small);pointer-events:none;cursor:default}
    .bar[hidden],.dock[hidden],.selection-tools[hidden]{display:none}.head{display:flex;flex:none;align-items:center;gap:var(--space-1);min-height:var(--bar-height);padding:var(--space-2) var(--space-3);background:var(--panel);cursor:move;touch-action:none;user-select:none}.head b{display:flex;align-items:center;flex:1;min-width:0;min-height:var(--tap-lg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-radius:var(--radius-sm)}.head button,.head .review-link{flex:none}.head button{width:var(--tap-lg);padding:0}.head .review-link{display:inline-flex;align-items:center;color:var(--ink-dim)}.content{display:flex;flex-direction:column;flex:1;min-height:0;overflow:auto}.content iframe{width:100%;flex:1;min-height:0;border:0;background:var(--panel2)}.status,.error{padding:var(--space-3) var(--space-4);margin:0}
    .dock.fullscreen .head,.dock.fullscreen .resize{display:none}
    .dock.fullscreen{border:0;border-radius:0;box-shadow:none;max-width:none;max-height:none}
    .dock.fullscreen~.launcher,.dock.fullscreen~.bar{display:none}
    .pin{pointer-events:auto;position:fixed;display:grid;place-items:center;border-radius:50%;background:var(--mark);border:0;box-shadow:0 2px 8px #0007;color:var(--crust);font-weight:700;padding:0;width:var(--tap);height:var(--tap)}.pin:hover{background:var(--mark);color:var(--crust);box-shadow:0 0 0 2px var(--crust),0 2px 8px #0007}.draft-pin{outline:2px dashed var(--accent);outline-offset:2px}
    .selected{position:fixed;pointer-events:none;border:2px solid var(--accent);background:var(--sel);border-radius:var(--radius-sm)}
    .selection-tools{pointer-events:auto;position:fixed;bottom:var(--space-4);left:50%;transform:translateX(-50%);display:flex;flex-wrap:wrap;gap:var(--space-2);align-items:center;padding:var(--space-2);border:0;border-radius:var(--radius-md);background:var(--panel2);box-shadow:0 4px 24px #0005;max-width:calc(100vw - var(--space-3)*2)}[data-write]{background:var(--accent);color:var(--crust)}[data-write]:hover{background:var(--accent);color:var(--crust)}
    .error{color:#f38ba8;white-space:pre-wrap}
    .frozen-page{position:fixed;inset:0;pointer-events:auto;max-width:none!important;max-height:none!important;user-select:none;touch-action:none}
    .freeze-status{pointer-events:auto;position:fixed;top:var(--space-4);left:50%;transform:translateX(-50%);display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2);padding:var(--space-2);border:1px solid var(--accent);border-radius:var(--radius-md);background:var(--panel2);max-width:calc(100vw - var(--space-3)*2);box-shadow:0 4px 24px #0005}.freeze-status[hidden]{display:none}
  </style><div class="outline"><span class="label"></span></div><div class="selections"></div><div class="pins"></div>
  <div class="freeze-status" hidden role="status"><span data-freeze-status></span><button data-resume>Resume · Ctrl+Shift+F</button></div>
  <div class="selection-tools" hidden><span data-selection-count></span><button data-write>Write note</button><button data-clear>Clear</button></div>
  <div class="dock" hidden><div class="head"><b tabindex="0" title="Drag to move; arrow keys move the note window"></b><a class="review-link" data-panel-review target="lcr-review" rel="noopener">Review ↗</a><button type="button" data-minimize aria-label="Minimize note panel" aria-expanded="true">−</button><button type="button" data-close aria-label="Close note panel">×</button></div><div class="content"></div><button type="button" class="resize" data-resize aria-label="Resize note panel" title="Drag to resize; arrow keys resize; Shift moves farther"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 13 13 3M8 13l5-5M12 13l1-1"/></svg></button></div>
  <button class="launcher" data-launcher aria-label="Selection mode" aria-pressed="true" aria-expanded="false"><span>lcr</span><span class="mode-state" aria-hidden="true">ON</span></button>
  <div class="bar" hidden><span class="brand">lcr · UI</span><button data-mode="browse">Browse</button><button data-mode="element" aria-pressed="true" title="Hover for dimensions; click an element to inspect and comment; Alt + wheel picks parents; Shift-click selects multiple; drag selects an area">Element</button><button data-mode="block" title="Click a containing layout block; Shift-click to select multiple; drag to select an area">Block</button><button data-multiple aria-pressed="false" title="Collect elements for one note, then choose Write note">Multiple</button><button data-mode="area">Area</button><button data-mode="point">Point</button><button data-notes>Notes · 0</button><a class="review-link" data-review target="lcr-review" rel="noopener">Review ↗</a></div>`;
  (document.body || document.documentElement).append(host);
  const $ = (s: string) => root.querySelector(s) as HTMLElement;
  const dock = $(".dock"),
    content = $(".content"),
    outline = $(".outline");
  const launcher = $("[data-launcher]"),
    bar = $(".bar");
  const positionKey = "lcr:launcher:" + config.reviewUrl;
  let launcherPosition = { x: 18, y: innerHeight - 62 };
  try {
    const saved = JSON.parse(sessionStorage.getItem(positionKey) || "null");
    if (Number.isFinite(saved?.x) && Number.isFinite(saved?.y))
      launcherPosition = saved;
  } catch {}
  function positionLauncher() {
    const size = launcher.offsetWidth;
    launcherPosition.x = Math.max(
      12,
      Math.min(innerWidth - size - 12, launcherPosition.x),
    );
    launcherPosition.y = Math.max(
      12,
      Math.min(innerHeight - size - 12, launcherPosition.y),
    );
    launcher.style.left = launcherPosition.x + "px";
    launcher.style.top = launcherPosition.y + "px";
    launcher.style.bottom = "auto";
    bar.style.left =
      Math.max(
        12,
        Math.min(innerWidth - bar.offsetWidth - 12, launcherPosition.x),
      ) + "px";
    const above = launcherPosition.y - bar.offsetHeight - 8;
    bar.style.top =
      Math.max(
        12,
        Math.min(
          innerHeight - bar.offsetHeight - 12,
          above >= 12 ? above : launcherPosition.y + size + 8,
        ),
      ) + "px";
  }
  function positionDock() {
    const fullscreen = annotationOpen || imagePreviewOpen;
    dock.classList.toggle("fullscreen", fullscreen);
    if (fullscreen) {
      dock.style.left = "0";
      dock.style.right = "auto";
      dock.style.top = "0";
      dock.style.width = innerWidth + "px";
      dock.style.height = innerHeight + "px";
      return;
    }
    const width = Math.max(
      1,
      Math.min(dockSize?.width ?? 560, innerWidth - 24),
    );
    const expandedHeight = Math.max(
      1,
      Math.min(dockSize?.height ?? innerHeight - 96, innerHeight - 24),
    );
    const height = minimized ? $(".head").offsetHeight || 50 : expandedHeight;
    dockPosition.x = Math.max(
      12,
      Math.min(innerWidth - width - 12, dockPosition.x),
    );
    dockPosition.y = Math.max(
      12,
      Math.min(innerHeight - height - 12, dockPosition.y),
    );
    dock.style.left = dockPosition.x + "px";
    dock.style.right = "auto";
    dock.style.top = dockPosition.y + "px";
    dock.style.width = width + "px";
    dock.style.height = minimized ? "auto" : expandedHeight + "px";
  }
  function resizeDock(width: number, height: number) {
    const maxWidth = Math.max(1, innerWidth - dockPosition.x - 12),
      maxHeight = Math.max(1, innerHeight - dockPosition.y - 12);
    const css = getComputedStyle(host);
    dockSize = {
      width: Math.max(
        Math.min(parseFloat(css.getPropertyValue("--tap")) * 10, maxWidth),
        Math.min(width, maxWidth),
      ),
      height: Math.max(
        Math.min(parseFloat(css.getPropertyValue("--row")) * 10, maxHeight),
        Math.min(height, maxHeight),
      ),
    };
    positionDock();
  }
  function minimize(value: boolean) {
    if (value && !minimized)
      dock.style.setProperty(
        "--content-height",
        content.getBoundingClientRect().height + "px",
      );
    minimized = value;
    dock.classList.toggle("minimized", value);
    const button = $("[data-minimize]");
    button.textContent = value ? "□" : "−";
    button.setAttribute(
      "aria-label",
      value ? "Restore note panel" : "Minimize note panel",
    );
    button.setAttribute("aria-expanded", String(!value));
    positionDock();
  }
  function tellFrame(action: string, value: any = {}) {
    frame?.contentWindow?.postMessage(
      { type: "lcr:ui", token: activeToken, action, ...value },
      reviewOrigin,
    );
  }
  function hideTools() {
    expanded = false;
    bar.hidden = true;
    launcher.setAttribute("aria-expanded", "false");
  }
  function expand(value: boolean) {
    if (value === expanded) return;
    expanded = value;
    bar.hidden = !value;
    launcher.setAttribute("aria-expanded", String(value));
    positionLauncher();
  }
  function rpc(action: string, payload: any = {}): Promise<any> {
    if (disposed)
      return Promise.reject(new Error("The review connection closed."));
    const seq = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pending.delete(seq))
          reject(new Error("lcr did not respond. Check the review server."));
      }, 30000);
      pending.set(seq, { resolve, reject, timer });
      win[config.binding](JSON.stringify({ seq, action, payload }));
    });
  }
  function error(e: any) {
    if (disposed) return;
    if (dock.hidden) {
      dock.hidden = false;
      $(".head b").textContent = "UI review";
    }
    let node = $(".error");
    if (!node) {
      node = document.createElement("p");
      node.className = "error";
      node.setAttribute("role", "alert");
      content.append(node);
    }
    node.textContent = e instanceof Error ? e.message : String(e);
  }
  function close(discard = false) {
    if (!discard && frameDirty) {
      if (!content.querySelector("[data-discard-prompt]")) {
        const prompt = document.createElement("div");
        prompt.className = "error";
        prompt.setAttribute("data-discard-prompt", "");
        const label = document.createElement("span");
        label.textContent = "Discard the open note changes? ";
        const keep = document.createElement("button");
        keep.textContent = "Keep editing";
        keep.onclick = () => prompt.remove();
        const discardButton = document.createElement("button");
        discardButton.textContent = "Discard note";
        discardButton.onclick = () => close(true);
        prompt.append(label, keep, discardButton);
        content.prepend(prompt);
      }
      return false;
    }
    content.querySelector("[data-discard-prompt]")?.remove();
    if (frameKind === "draft" && activeToken)
      void rpc("discard", { draftId: activeToken }).catch(() => {});
    panelGeneration++;
    frame = null;
    activeToken = "";
    frameKind = "";
    pendingWeb = undefined;
    draftWeb = null;
    capturingSelection = null;
    frameDirty = false;
    frameSaving = false;
    frameEditingOriginal = false;
    replyDraftId = "";
    pendingReply = false;
    resizePress = null;
    annotationOpen = false;
    imagePreviewOpen = false;
    dock.hidden = true;
    content.textContent = "";
    minimize(false);
    clearSelections();
    start = null;
    hovering = null;
    outline.style.display = "none";
    pins();
    return true;
  }
  function setMode(value: string) {
    if (freezing) return;
    if (frozen && value !== "area" && value !== "point") {
      if (!busy) resume(value);
      return;
    }
    inspectBase = null;
    inspectDepth = 0;
    mode = value;
    if (mode !== "browse") selectionMode = mode;
    multiple = false;
    $("[data-multiple]").setAttribute("aria-pressed", "false");
    clearSelections();
    hideTools();
    start = null;
    hovering = null;
    outline.style.display = "none";
    launcher.setAttribute("aria-pressed", String(mode !== "browse"));
    $(".mode-state").textContent = mode === "browse" ? "OFF" : "ON";
    launcher.title =
      "Selection " +
      (mode === "browse"
        ? "off — use the page normally"
        : "on — " + mode + " targeting") +
      ". Click to toggle; hold for tools; drag to move. Hold Alt to use the page temporarily. Ctrl+Shift+F freezes a hovered view for annotation.";
    root
      .querySelectorAll("[data-mode]")
      .forEach((b) =>
        b.setAttribute(
          "aria-pressed",
          String((b as HTMLElement).dataset.mode === mode),
        ),
      );
    pins();
  }
  function freezeControls() {
    $(".freeze-status").hidden = !frozen && !freezing;
    $("[data-freeze-status]").textContent = freezing
      ? "Freezing view…"
      : "Frozen view · drag an area to comment";
    ($("[data-resume]") as HTMLButtonElement).disabled = freezing;
    root
      .querySelectorAll<HTMLButtonElement>(
        '[data-mode="element"],[data-mode="block"],[data-multiple]',
      )
      .forEach((button) => {
        button.disabled = !!frozen || freezing;
      });
  }
  function resume(next = frozen?.mode) {
    if (!frozen) return;
    const previous = frozen;
    frozen = null;
    previous.image.remove();
    selectionMode = previous.selectionMode;
    setMode(next || previous.mode);
    freezeControls();
    void rpc("resume", { id: previous.id }).catch(() => {});
  }
  async function toggleFreeze() {
    if (busy || freezing || frameSaving || annotationOpen || imagePreviewOpen)
      return;
    if (frozen) {
      resume();
      return;
    }
    const previousMode = mode,
      previousSelectionMode = selectionMode;
    freezing = true;
    start = null;
    outline.style.display = "none";
    hideTools();
    freezeControls();
    tellFrame("capturing", { busy: true });
    let id = "";
    try {
      const settings = await rpc("context-settings", {});
      // Snapshot DOM hints and optional HTML before inserting the frozen image.
      const capture = captureContext(
        areaCapture({
          x: 0,
          y: 0,
          width: innerWidth,
          height: innerHeight,
        }),
        [],
        settings,
        "frozen viewport",
      );
      const targets = snapshotPointTargets(capture.selections || []);
      const result = await rpc("freeze", { capture });
      id = result.id;
      const image = document.createElement("img");
      image.className = "frozen-page";
      image.alt = "";
      image.draggable = false;
      image.style.width = capture.viewport.width + "px";
      image.style.height = capture.viewport.height + "px";
      image.src = result.data;
      await image.decode();
      if (
        disposed ||
        innerWidth !== capture.viewport.width ||
        innerHeight !== capture.viewport.height
      )
        throw new Error(
          "The viewport changed while freezing. Freeze the page again.",
        );
      frozen = {
        id,
        capture,
        image,
        mode: previousMode,
        selectionMode: previousSelectionMode,
        targets,
      };
      root.insertBefore(image, $(".outline"));
      freezing = false;
      setMode("area");
    } catch (e) {
      if (id) void rpc("resume", { id }).catch(() => {});
      error(e);
    } finally {
      freezing = false;
      freezeControls();
      tellFrame("capturing", { busy: false });
    }
  }
  function frozenCapture(
    r: CaptureRect,
    kind: string,
    point?: { x: number; y: number },
  ) {
    if (kind === "point") {
      const x = point?.x ?? r.x + r.width / 2,
        y = point?.y ?? r.y + r.height / 2;
      const candidates = frozen!.targets.filter(
        (entry) =>
          x >= entry.rect.x &&
          x < entry.rect.x + entry.rect.width &&
          y >= entry.rect.y &&
          y < entry.rect.y + entry.rect.height,
      );
      candidates.sort((a, b) => {
        const ai = a.above.indexOf(b.selector),
          bi = b.above.indexOf(a.selector);
        if (ai >= 0 && ai < a.above.indexOf(a.selector)) return 1;
        if (bi >= 0 && bi < b.above.indexOf(b.selector)) return -1;
        return a.rect.width * a.rect.height - b.rect.width * b.rect.height;
      });
      const hit = candidates[0];
      return {
        ...frozen!.capture,
        mode: kind,
        rect: r,
        selector: hit?.element ? hit.selector : undefined,
        element: hit?.element,
        components: hit?.components || [],
        selections: undefined,
      };
    }
    const selections =
      kind === "area"
        ? (frozen!.capture.selections || []).filter(
            (s: any) =>
              s.rect.x < r.x + r.width &&
              s.rect.x + s.rect.width > r.x &&
              s.rect.y < r.y + r.height &&
              s.rect.y + s.rect.height > r.y,
          )
        : [];
    const components: any[] = [],
      seen = new Set();
    for (const s of selections)
      for (const component of s.components) {
        const key = JSON.stringify(component);
        if (seen.has(key) || components.length >= 30) continue;
        seen.add(key);
        components.push(component);
      }
    return {
      ...frozen!.capture,
      mode: kind,
      rect: r,
      components,
      selections: selections.length ? selections : undefined,
    };
  }
  function snapshotPointTargets(evidence: Omit<FrozenTarget, "above">[]) {
    const bySelector = new Map(
        evidence.map((entry) => [entry.selector, entry]),
      ),
      targets: FrozenTarget[] = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: (node) =>
          node === host ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
      },
    );
    let node: Node | null,
      visited = 0;
    while ((node = walker.nextNode())) {
      // A truncated hit index cannot reliably identify the target: omit rather than invent evidence.
      if (++visited > 2500) return [];
      const el = node as Element,
        b = el.getBoundingClientRect();
      if (
        b.bottom <= 0 ||
        b.right <= 0 ||
        b.top >= innerHeight ||
        b.left >= innerWidth ||
        !b.width ||
        !b.height ||
        getComputedStyle(el).pointerEvents === "none" ||
        !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
      )
        continue;
      const bounds = rect(el),
        key = selector(el);
      // Metadata remains bounded to the existing area snapshot (100 entries). Geometry-only
      // targets stop a missing/truncated leaf from being mistaken for an ancestor.
      targets.push({
        ...bySelector.get(key),
        selector: key,
        rect: bounds,
        above: document
          .elementsFromPoint(
            bounds.x + bounds.width / 2,
            bounds.y + bounds.height / 2,
          )
          .filter((other) => other !== host)
          .slice(0, 100)
          .map(selector),
      });
    }
    return targets;
  }
  function rect(el: Element) {
    const r = el.getBoundingClientRect();
    return clamp({ x: r.x, y: r.y, width: r.width, height: r.height });
  }
  function clamp(r: any) {
    const x = Math.max(0, Math.min(innerWidth - 1, r.x)),
      y = Math.max(0, Math.min(innerHeight - 1, r.y));
    return {
      x,
      y,
      width: Math.max(1, Math.min(innerWidth, r.x + r.width) - x),
      height: Math.max(1, Math.min(innerHeight, r.y + r.height) - y),
    };
  }
  function paint(r: any, label = "") {
    outline.style.cssText =
      "display:block;left:" +
      r.x +
      "px;top:" +
      r.y +
      "px;width:" +
      r.width +
      "px;height:" +
      r.height +
      "px";
    $(".label").textContent = label;
    $(".label").style.top = "";
    $(".label").style.bottom = "";
  }
  function selector(el: Element) {
    const tree = config.ownerKey ? el.getRootNode() : document;
    const scope =
      tree instanceof ShadowRoot && tree.host.hasAttribute("data-lcr-owner")
        ? tree
        : document;
    const prefix =
      scope instanceof ShadowRoot
        ? `[data-lcr-owner="${CSS.escape(scope.host.getAttribute("data-lcr-owner")!)}"] >>> `
        : "";
    const parts: string[] = [];
    for (
      let e: Element | null = el;
      e && parts.length < 12;
      e = e.parentElement
    ) {
      let part = e.localName;
      if (e.id) part += "#" + CSS.escape(e.id);
      else if (e.hasAttribute("data-testid"))
        part +=
          '[data-testid="' + CSS.escape(e.getAttribute("data-testid")!) + '"]';
      else if (scope instanceof ShadowRoot && e.classList.length)
        part += [...e.classList].map((name) => "." + CSS.escape(name)).join("");
      else {
        const siblings = e.parentElement
          ? [...e.parentElement.children].filter(
              (n) => n.localName === e!.localName,
            )
          : [];
        if (siblings.length > 1)
          part += ":nth-of-type(" + (siblings.indexOf(e) + 1) + ")";
      }
      parts.unshift(part);
      const result = parts.join(" > ");
      if (
        scope.querySelectorAll(result).length === 1 &&
        scope.querySelector(result) === el
      )
        return prefix + result;
    }
    return "";
  }
  function queryCapture(value: string): NodeListOf<Element> | Element[] {
    const boundary = config.ownerKey ? value.indexOf(" >>> ") : -1;
    if (boundary < 0) return document.querySelectorAll(value);
    const container = document.querySelector(value.slice(0, boundary));
    if (container === host || !container?.hasAttribute("data-lcr-owner"))
      return [];
    return (
      container.shadowRoot?.querySelectorAll(value.slice(boundary + 5)) ?? []
    );
  }
  function playgroundTarget(x: number, y: number): Element | null {
    for (const container of document.querySelectorAll<HTMLElement>(
      "[data-lcr-owner][inert]",
    )) {
      if (container === host || !container.shadowRoot) continue;
      const scope = container.shadowRoot;
      // Inert suppresses hit testing too. Keep input suspended while querying its
      // real shadow tree, then restore inert before the browser dispatches input.
      container.inert = false;
      try {
        const found = scope.elementFromPoint(x, y);
        if (found?.getRootNode() === scope)
          return found.closest("button,a,.dock") ?? found;
      } finally {
        container.inert = true;
      }
    }
    return null;
  }
  function components(el: any) {
    const found: any[] = [];
    const seen = new Set();
    function add(framework: string, name: any, source?: any) {
      if (typeof name !== "string" || !name || found.length >= 30) return;
      const key = framework + name;
      if (seen.has(key)) return;
      seen.add(key);
      found.push({
        framework,
        name: name.slice(0, 200),
        ...(typeof source?.fileName === "string"
          ? { file: source.fileName.slice(0, 1000) }
          : {}),
        ...(Number.isSafeInteger(source?.lineNumber)
          ? { line: source.lineNumber }
          : {}),
      });
    }
    // Runtime handles are best-effort and read only. Never collect component props or state.
    try {
      let node = el,
        fiber: any;
      for (
        let i = 0;
        node && i < 20 && !fiber;
        i++, node = node.parentElement
      ) {
        const key = Object.keys(node).find(
          (k) =>
            k.startsWith("__reactFiber$") ||
            k.startsWith("__reactInternalInstance$"),
        );
        if (key) fiber = node[key];
      }
      for (let i = 0; fiber && i < 60; i++, fiber = fiber.return) {
        const t = fiber.type;
        if (t && typeof t !== "string")
          add(
            "React",
            t.displayName ||
              t.name ||
              t.render?.displayName ||
              t.render?.name ||
              t.type?.displayName ||
              t.type?.name,
            fiber._debugSource,
          );
      }
    } catch {}
    try {
      let node = el,
        component: any;
      for (
        let i = 0;
        node && i < 20 && !component;
        i++, node = node.parentElement
      )
        component = node.__vueParentComponent || node.__vue__;
      for (
        let i = 0;
        component && i < 30;
        i++, component = component.parent || component.$parent
      ) {
        const t = component.type || component.$options;
        add(
          "Vue",
          t?.name || t?.__name,
          t?.__file ? { fileName: t.__file } : undefined,
        );
      }
    } catch {}
    return found;
  }
  function metadata(el: Element | null, r: any, kind = mode) {
    const attributes: Record<string, string> = {},
      styles: Record<string, string> = {};
    if (el) {
      for (const name of [
        "id",
        "class",
        "role",
        "aria-label",
        "title",
        "data-testid",
        "name",
        "type",
        "placeholder",
        "alt",
      ]) {
        const v = el.getAttribute(name);
        if (v) attributes[name] = v.slice(0, 1000);
      }
      const css = getComputedStyle(el);
      for (const name of [
        "display",
        "position",
        "width",
        "height",
        "color",
        "background-color",
        "font-family",
        "font-size",
        "font-weight",
        "line-height",
        "padding",
        "margin",
        "gap",
        "border",
        "border-radius",
        "align-items",
        "justify-content",
        "row-gap",
        "column-gap",
        "align-self",
        "border-top",
        "border-right",
        "border-bottom",
        "border-left",
      ])
        styles[name] = css.getPropertyValue(name).slice(0, 1000);
    }
    return {
      url: location.href,
      title: document.title,
      at: new Date().toISOString(),
      mode: kind,
      rect: r,
      viewport: {
        width: innerWidth,
        height: innerHeight,
        dpr: devicePixelRatio,
      },
      scroll: { x: scrollX, y: scrollY },
      ...(el
        ? {
            selector: selector(el),
            element: {
              tag: el.localName,
              text: ((el as HTMLElement).innerText || el.textContent || "")
                .trim()
                .slice(0, 2000),
              attributes,
              styles,
            },
          }
        : {}),
      components: el ? components(el) : [],
    };
  }
  function inspectTarget(el: Element | null) {
    if (el !== inspectBase) {
      inspectBase = el;
      inspectDepth = 0;
    }
    for (let i = 0; el && i < inspectDepth; i++)
      el = el.parentElement || (el.getRootNode() as ShadowRoot).host || el;
    return el;
  }
  function inspectLabel(el: Element) {
    const b = el.getBoundingClientRect();
    const size = (value: number) => String(Math.round(value * 100) / 100);
    return `${el.localName} · ${size(b.width)} × ${size(b.height)} CSS px · rendered`;
  }
  function paintInspection(el: Element) {
    paint(rect(el), inspectLabel(el));
    // Keep the dimension label visible for elements touching the top edge.
    $(".label").style.bottom =
      el.getBoundingClientRect().top < 24 ? "auto" : "";
    $(".label").style.top = el.getBoundingClientRect().top < 24 ? "100%" : "";
  }
  function union(rects: any[]) {
    const x = Math.min(...rects.map((r) => r.x)),
      y = Math.min(...rects.map((r) => r.y));
    return {
      x,
      y,
      width: Math.max(...rects.map((r) => r.x + r.width)) - x,
      height: Math.max(...rects.map((r) => r.y + r.height)) - y,
    };
  }
  type CaptureRect = { x: number; y: number; width: number; height: number };
  type CaptureSettings = {
    aiContext: boolean;
    contextHtml: boolean;
    contextFullPage: boolean;
  };
  function captureContext<T extends { rect: CaptureRect; mode: string }>(
    capture: T,
    elements: Element[],
    settings: CaptureSettings,
    scope = "selection",
  ) {
    const result = {
      ...capture,
      contextSettings: {
        aiContext: settings.aiContext === true,
        contextHtml: settings.contextHtml === true,
        contextFullPage: settings.contextFullPage === true,
      },
      contextHtml: undefined as
        { data: string; truncated: boolean } | undefined,
    };
    if (
      !result.contextSettings.aiContext ||
      !result.contextSettings.contextHtml
    )
      return result;
    try {
      const nodes: { selector: string; rect: CaptureRect; html: string }[] = [];
      const encoder = new TextEncoder();
      let visited = 0,
        bytes = 0,
        htmlBytes = 0,
        truncated = false,
        excluded = 0;
      const escape = (text: string) =>
        text
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      const allowed = [
        "id",
        "class",
        "role",
        "aria-label",
        "title",
        "data-testid",
        "alt",
      ];
      function visible(el: Element) {
        return (
          el !== host &&
          !host.contains(el) &&
          !el.closest(
            "script,style,noscript,template,iframe,object,embed,input,textarea,select,option,[hidden],[inert],[aria-hidden=true],[contenteditable]:not([contenteditable=false])",
          ) &&
          el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
        );
      }
      function fragment(text: string) {
        const size = encoder.encode(text).length;
        if (htmlBytes + size > 120 * 1024) {
          truncated = true;
          return "";
        }
        htmlBytes += size;
        return text;
      }
      function serialize(el: Element, deep: boolean, depth = 0): string {
        if (++visited > 2500 || depth > 40) {
          truncated = true;
          return "";
        }
        if (!visible(el)) {
          excluded++;
          return "";
        }
        const attributes = allowed
          .flatMap((name) => {
            const value = el.getAttribute(name);
            if (value && value.length > 500) truncated = true;
            return value ? [` ${name}="${escape(value.slice(0, 500))}"`] : [];
          })
          .join("");
        let html = fragment(`<${el.localName}${attributes}>`);
        for (const child of el.childNodes) {
          if (++visited > 2500 || htmlBytes >= 120 * 1024) {
            truncated = true;
            break;
          }
          if (child.nodeType === Node.TEXT_NODE) {
            const text = child.textContent || "";
            if (text.length > 2000) truncated = true;
            html += fragment(escape(text.slice(0, 2000)));
          } else if (deep && child instanceof Element)
            html += serialize(child, true, depth + 1);
          if (visited > 2500) break;
        }
        return html + fragment(`</${el.localName}>`);
      }
      function add(el: Element, deep: boolean) {
        if (!visible(el)) {
          excluded++;
          return;
        }
        const bounds = el.getBoundingClientRect(),
          r = capture.rect;
        if (
          bounds.right <= r.x ||
          bounds.bottom <= r.y ||
          bounds.x >= r.x + r.width ||
          bounds.y >= r.y + r.height
        )
          return;
        const html = serialize(el, deep);
        const record = { selector: selector(el), rect: rect(el), html };
        const size = encoder.encode(JSON.stringify(record)).length;
        if (bytes + size > 128 * 1024) {
          truncated = true;
          return;
        }
        bytes += size;
        nodes.push(record);
      }
      if (elements.length) {
        for (const el of elements) {
          if (nodes.length >= 200 || visited > 2500) {
            truncated = true;
            break;
          }
          add(el, true);
        }
      } else {
        let node: Node | null,
          scanned = 0;
        const walker = document.createTreeWalker(
          document.body || document.documentElement,
          NodeFilter.SHOW_ELEMENT,
          {
            acceptNode: (node) => {
              if (++scanned > 5000) return NodeFilter.FILTER_ACCEPT;
              if (visible(node as Element)) return NodeFilter.FILTER_ACCEPT;
              excluded++;
              return NodeFilter.FILTER_REJECT;
            },
          },
        );
        while ((node = walker.nextNode())) {
          if (scanned > 5000 || nodes.length >= 200 || visited > 2500) {
            truncated = true;
            break;
          }
          add(node as Element, false);
        }
      }
      result.contextHtml = {
        data: JSON.stringify({
          scope,
          coordinateSpace: "capture viewport CSS pixels",
          rect: capture.rect,
          exclusions:
            "Form controls, editable content, hidden subtrees, scripts, embedded documents, non-whitelisted attributes, props and state are omitted.",
          excludedNodes: excluded,
          nodes,
        }),
        truncated,
      };
    } catch {
      // The controller records an explicit unavailable part; never re-query a frozen page.
    }
    return result;
  }
  function selectionCapture(elements: Element[], kind: string) {
    const captures = elements.map((el) => {
      const r = el.getBoundingClientRect();
      if (
        !el.isConnected ||
        r.bottom <= 0 ||
        r.right <= 0 ||
        r.top >= innerHeight ||
        r.left >= innerWidth
      )
        throw new Error(
          "Bring all selected elements into view before writing the note.",
        );
      return metadata(el, rect(el), kind);
    });
    const selections = captures.map(
      ({ selector, element, components, rect }) => ({
        selector,
        element,
        components,
        rect,
      }),
    );
    return {
      ...captures[0],
      rect: union(selections.map((s) => s.rect)),
      ...(selections.length > 1 ? { selections } : {}),
    };
  }
  function areaCapture(r: any) {
    const capture = metadata(null, r, "area"),
      selections: any[] = [],
      seen = new Set<string>();
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: (node) =>
          node === host ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
      },
    );
    const points = [
      [0.5, 0.5],
      [0.1, 0.1],
      [0.9, 0.1],
      [0.1, 0.9],
      [0.9, 0.9],
    ];
    let node: Node | null;
    while (selections.length < 100 && (node = walker.nextNode())) {
      const el = node as Element,
        b = el.getBoundingClientRect();
      const x = Math.max(r.x, b.x),
        y = Math.max(r.y, b.y);
      const width = Math.min(r.x + r.width, b.right) - x,
        height = Math.min(r.y + r.height, b.bottom) - y;
      if (
        width <= 0 ||
        height <= 0 ||
        !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
      )
        continue;
      // Ignore occluded elements, but keep containers and visible pointer-events:none children.
      if (
        !points.some(([dx, dy]) => {
          const front = document
            .elementsFromPoint(x + width * dx, y + height * dy)
            .find((n) => n !== host);
          return front && (el.contains(front) || front.contains(el));
        })
      )
        continue;
      const bounds = rect(el),
        { selector, element, components } = metadata(el, bounds, "area");
      selections.push({ selector, element, components, rect: bounds });
      for (const component of components) {
        const key = JSON.stringify(component);
        if (seen.has(key) || capture.components.length >= 30) continue;
        seen.add(key);
        capture.components.push(component);
      }
    }
    return { ...capture, ...(selections.length ? { selections } : {}) };
  }
  function paintSelections() {
    if (selectionUrl !== location.href) {
      selected = [];
      selectionUrl = location.href;
    }
    const container = $(".selections");
    container.textContent = "";
    selected.forEach((el) => {
      if (!el.isConnected) return;
      const r = el.getBoundingClientRect(),
        box = document.createElement("div");
      box.className = "selected";
      box.style.cssText = `left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px`;
      container.append(box);
    });
    $(".selection-tools").hidden = !selected.length;
    $("[data-selection-count]").textContent = selected.length + " selected";
    pins();
  }
  function clearSelections() {
    selected = [];
    paintSelections();
  }
  function toggleSelection(el: Element) {
    if (selectionUrl !== location.href) clearSelections();
    const index = selected.indexOf(el);
    if (index >= 0) selected.splice(index, 1);
    else if (selected.length < 100) selected.push(el);
    paintSelections();
  }
  function target(event: any) {
    let el = document
      .elementsFromPoint(event.clientX, event.clientY)
      .find((n) => n !== host);
    if (config.ownerKey)
      el = playgroundTarget(event.clientX, event.clientY) ?? el;
    if (!el) return null;
    if (mode === "block")
      for (let i = 0; el.parentElement && i < 12; i++) {
        if (
          ["block", "flex", "grid", "table", "list-item"].includes(
            getComputedStyle(el).display,
          ) &&
          el.getBoundingClientRect().width > 40
        )
          break;
        el = el.parentElement;
      }
    return mode === "element" ? inspectTarget(el) : el;
  }
  function ours(e: Event) {
    const path = e.composedPath();
    return path.includes(host) && !(frozen && path.includes(frozen.image));
  }
  function stop(e: Event) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
  function showFrame(kind: "draft" | "note", token: string) {
    content.textContent = "";
    activeToken = token;
    frameKind = kind;
    ($("[data-panel-review]") as HTMLAnchorElement).href =
      config.reviewUrl +
      (kind === "note"
        ? "/#note=" + encodeURIComponent(token.split("|#").pop() || token)
        : "/");
    pendingWeb = undefined;
    frameDirty = false;
    frameSaving = false;
    frameEditingOriginal = false;
    replyDraftId = "";
    pendingReply = false;
    const status = document.createElement("p");
    status.className = "status";
    status.textContent = "Loading review editor…";
    content.append(status);
    const editor = document.createElement("iframe");
    frame = editor;
    editor.title =
      kind === "draft"
        ? "New visual review note"
        : "Visual review conversation";
    editor.allow = "clipboard-read; clipboard-write";
    editor.src =
      config.reviewUrl + "/?ui-" + kind + "=" + encodeURIComponent(token);
    editor.onload = () => {
      if (frame === editor) status.remove();
    };
    editor.onerror = () => {
      if (frame === editor) {
        status.remove();
        error(
          new Error(
            "The review editor could not load. Open Review to continue.",
          ),
        );
      }
    };
    content.append(editor);
  }
  function showEvidence(
    web: typeof pendingWeb,
    result: { reply?: boolean; draftId?: string } = {},
  ) {
    pendingWeb = web;
    pendingReply = result.reply === true;
    if (pendingReply && typeof result.draftId === "string")
      replyDraftId = result.draftId;
    draftWeb = frameKind === "draft" || pendingReply ? web : null;
    pins();
    tellFrame("evidence", {
      web,
      ...(pendingReply ? { reply: true, draftId: replyDraftId } : {}),
    });
    const count = web ? 1 + (web.additional?.length || 0) : 0;
    $(".head b").textContent =
      (pendingReply
        ? "Follow-up"
        : frameKind === "draft"
          ? "New note"
          : "Note") +
      " · " +
      count +
      " selection" +
      (count === 1 ? "" : "s");
    void refresh().catch(() => {});
  }
  async function removeSelection(index: number, key: string, draftId?: string) {
    if (!frame || !activeToken) return;
    if (busy || freezing || frameSaving) {
      tellFrame("evidence", {
        error: "Wait for the current selection or save to finish.",
      });
      if (!busy && !freezing) tellFrame("capturing", { busy: false });
      return;
    }
    const generation = panelGeneration;
    busy = true;
    tellFrame("capturing", { busy: true });
    try {
      const result = await rpc("remove-selection", {
        index,
        key,
        ...(draftId
          ? { draftId }
          : frameKind === "draft"
            ? { draftId: activeToken }
            : { id: activeToken }),
      });
      if (generation === panelGeneration)
        showEvidence(result.web, draftId ? { reply: true, draftId } : result);
    } catch (e) {
      if (generation === panelGeneration)
        tellFrame("evidence", {
          error: e instanceof Error ? e.message : String(e),
        });
    } finally {
      busy = false;
      if (generation === panelGeneration)
        tellFrame("capturing", { busy: false });
    }
  }
  async function choose(
    el: Element | null,
    r: any,
    kind = mode,
    elements: Element[] = [],
    point?: { x: number; y: number },
  ) {
    if (busy || freezing || frameSaving) return;
    const appending = !!frame && !!activeToken;
    if (!appending && !close()) return;
    hideTools();
    outline.style.display = "none";
    const generation = panelGeneration;
    const status = document.createElement("p");
    status.className = "status";
    status.textContent = "Capturing page and selected area…";
    if (!appending) {
      dock.hidden = false;
      $(".head b").textContent = "New visual note";
      minimize(false);
      content.append(status);
    }
    busy = true;
    tellFrame("capturing", { busy: true });
    try {
      const capture = {
        ...(frozen
          ? frozenCapture(r, kind, point)
          : elements.length
            ? selectionCapture(elements, kind)
            : kind === "area"
              ? areaCapture(r)
              : metadata(el, r, kind)),
        ...(kind === "point" && point ? { point } : {}),
      };
      capturingSelection = capture;
      pins();
      const settings = await rpc("context-settings", {});
      const result = await rpc("capture", {
        capture: frozen
          ? capture
          : captureContext(
              capture,
              elements.length ? elements : el ? [el] : [],
              settings,
            ),
        ...(frozen ? { freezeId: frozen.id } : {}),
        ...(appending
          ? frameKind === "draft"
            ? { draftId: activeToken }
            : { id: activeToken, editOriginal: frameEditingOriginal }
          : {}),
      });
      if (generation !== panelGeneration) {
        if (result.draftId)
          void rpc("discard", { draftId: result.draftId }).catch(() => {});
        return;
      }
      clearSelections();
      if (appending) showEvidence(result.web, result);
      else {
        if (typeof result.draftId !== "string" || !result.draftId)
          throw new Error("The page capture did not return a draft.");
        showFrame("draft", result.draftId);
        showEvidence(result.web);
      }
    } catch (e) {
      if (generation !== panelGeneration) return;
      status.remove();
      minimize(false);
      error(e);
      const retry = document.createElement("button");
      retry.textContent = "Retry capture";
      retry.onclick = () => {
        retry.remove();
        $(".error")?.remove();
        void choose(el, r, kind, elements, point);
      };
      content.append(retry);
    } finally {
      busy = false;
      if (generation === panelGeneration) {
        capturingSelection = null;
        pins();
        tellFrame("capturing", { busy: false });
      }
    }
  }
  listen(window, "message", (event) => {
    const message = event.data;
    if (
      event.origin !== reviewOrigin ||
      !frame ||
      event.source !== frame.contentWindow ||
      !message ||
      message.type !== "lcr:ui" ||
      message.token !== activeToken
    )
      return;
    if (message.action === "dirty") {
      if (typeof message.dirty === "boolean") frameDirty = message.dirty;
      if (typeof message.saving === "boolean") frameSaving = message.saving;
      if (typeof message.editOriginal === "boolean")
        frameEditingOriginal = message.editOriginal;
      if (typeof message.draftId === "string") replyDraftId = message.draftId;
    } else if (
      message.action === "annotation" &&
      typeof message.open === "boolean"
    ) {
      annotationOpen = message.open;
      if (!annotationOpen) pendingWeb = undefined;
      positionDock();
    } else if (
      message.action === "image-preview" &&
      typeof message.open === "boolean"
    ) {
      imagePreviewOpen = message.open;
      positionDock();
    } else if (message.action === "freeze") {
      void toggleFreeze();
    } else if (message.action === "ready") {
      tellFrame("capturing", { busy: busy || freezing });
      if (pendingWeb !== undefined)
        tellFrame("evidence", {
          web: pendingWeb,
          ...(pendingReply ? { reply: true, draftId: replyDraftId } : {}),
        });
    } else if (
      message.action === "remove-selection" &&
      Number.isSafeInteger(message.index) &&
      typeof message.key === "string"
    ) {
      void removeSelection(
        message.index,
        message.key,
        typeof message.draftId === "string" ? message.draftId : undefined,
      );
    } else if (message.action === "reply-sent") {
      replyDraftId = "";
      pendingReply = false;
      pendingWeb = undefined;
      draftWeb = null;
      pins();
      $(".head b").textContent = "Note";
    } else if (message.action === "close") {
      frameDirty = false;
      close();
      void refresh().catch(() => {});
    } else if (
      message.action === "review" &&
      (message.id === undefined ||
        (typeof message.id === "string" && message.id))
    ) {
      void rpc(
        "review",
        message.id === undefined ? {} : { id: message.id },
      ).catch(error);
    }
  });
  listen(document, "securitypolicyviolation", (event) => {
    if (
      frame &&
      event.effectiveDirective === "frame-src" &&
      event.blockedURI.startsWith(reviewOrigin)
    )
      error(
        new Error(
          "This page blocks the review editor in a frame. Open Review to continue.",
        ),
      );
  });
  function locateArea(c: any) {
    const candidates = (c.selections || []).filter(
      (s: any) =>
        s.selector &&
        s.element &&
        s.rect.x > 0 &&
        s.rect.y > 0 &&
        s.rect.x + s.rect.width < c.viewport.width &&
        s.rect.y + s.rect.height < c.viewport.height,
    );
    const inside = candidates.filter(
      (s: any) =>
        s.rect.x >= c.rect.x &&
        s.rect.y >= c.rect.y &&
        s.rect.x + s.rect.width <= c.rect.x + c.rect.width &&
        s.rect.y + s.rect.height <= c.rect.y + c.rect.height,
    );
    const strong = (s: any) =>
      !!(s.element.attributes.id || s.element.attributes["data-testid"]);
    const anchors = (
      inside.length
        ? inside
        : candidates.filter((s: any) => strong(s) || s.components.length)
    )
      .sort(
        (a: any, b: any) =>
          Number(strong(b)) - Number(strong(a)) ||
          a.rect.width * a.rect.height - b.rect.width * b.rect.height,
      )
      .slice(0, 3);
    if (!anchors.length) return null;
    let dx: number | undefined, dy: number | undefined;
    for (const anchor of anchors) {
      const match = locate({ ...c, ...anchor, mode: "element" });
      if (!match?.el) return null;
      const el = match.el as HTMLElement;
      if (
        !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) ||
        match.rect.width <= 0 ||
        match.rect.height <= 0
      )
        return null;
      if (
        (el.innerText || el.textContent || "").trim().slice(0, 2000) !==
        anchor.element.text
      )
        return null;
      if (anchor.components.length) {
        const current = components(el);
        if (
          anchor.components.some(
            (saved: any) =>
              !current.some(
                (now) =>
                  now.framework === saved.framework && now.name === saved.name,
              ),
          )
        )
          return null;
      }
      const x = match.rect.x - anchor.rect.x,
        y = match.rect.y - anchor.rect.y;
      if (dx !== undefined && (Math.abs(x - dx) > 2 || Math.abs(y - dy!) > 2))
        return null;
      dx = x;
      dy = y;
    }
    return {
      el: null,
      rect: { ...c.rect, x: c.rect.x + dx!, y: c.rect.y + dy! },
    };
  }
  function locate(c: any) {
    if (c.url !== location.href) return null;
    if (c.mode === "area") return locateArea(c);
    // Point evidence describes an element, but its pin belongs to the pointed neighborhood.
    if (c.mode === "point") {
      if (innerWidth !== c.viewport.width || innerHeight !== c.viewport.height)
        return null;
      return {
        el: null,
        rect: {
          ...c.rect,
          x: c.rect.x + c.scroll.x - scrollX,
          y: c.rect.y + c.scroll.y - scrollY,
        },
      };
    }
    if (c.element && !c.selector) return null;
    if (c.selector) {
      try {
        const matches = queryCapture(c.selector);
        if (matches.length !== 1) return null;
        const el = matches[0] as HTMLElement;
        if (el.localName !== c.element?.tag) return null;
        const attr = c.element.attributes;
        for (const key of ["id", "data-testid", "role", "aria-label", "name"])
          if (attr[key] && el.getAttribute(key) !== attr[key]) return null;
        if (
          !attr.id &&
          !attr["data-testid"] &&
          (el.innerText || el.textContent || "").trim().slice(0, 2000) !==
            c.element.text
        )
          return null;
        const bounds = el.getBoundingClientRect();
        return {
          el,
          rect: {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
          },
        };
      } catch {
        return null;
      }
    }
    if (innerWidth !== c.viewport.width || innerHeight !== c.viewport.height)
      return null;
    const r = {
      ...c.rect,
      x: c.rect.x + c.scroll.x - scrollX,
      y: c.rect.y + c.scroll.y - scrollY,
    };
    return { el: null, rect: r };
  }
  function pins() {
    const container = $(".pins");
    container.textContent = "";
    if (mode === "browse") return;
    const add = (
      r: CaptureRect,
      text: string,
      label: string,
      open: () => void,
      draft = false,
      centered = false,
    ) => {
      if (
        r.y + r.height < 0 ||
        r.y > innerHeight ||
        r.x + r.width < 0 ||
        r.x > innerWidth
      )
        return;
      const b = document.createElement("button");
      b.className = draft ? "pin draft-pin" : "pin";
      b.textContent = text;
      b.title = label;
      b.setAttribute(
        "aria-label",
        draft ? label : "UI note " + text + ": " + label.slice(0, 120),
      );
      b.style.left = r.x + "px";
      b.style.top = r.y + "px";
      if (centered) b.style.transform = "translate(-50%, -50%)";
      b.onclick = open;
      container.append(b);
    };
    const reopen = () => {
      if (dock.hidden) return;
      minimize(false);
      frame?.focus();
    };
    const draw = (
      capture: any,
      text: string,
      label: string,
      open: () => void,
      draft = false,
    ) => {
      if (capture.url !== location.href) return;
      const targets = (["element", "block"].includes(capture.mode) &&
        capture.selections) || [capture];
      for (const selection of targets) {
        const c = { ...capture, ...selection };
        const p = frozen && draft ? { rect: c.rect } : locate(c);
        const r =
          p?.rect ??
          (draft &&
          innerWidth === c.viewport.width &&
          innerHeight === c.viewport.height
            ? {
                ...c.rect,
                x: c.rect.x + c.scroll.x - scrollX,
                y: c.rect.y + c.scroll.y - scrollY,
              }
            : null);
        if (!r) continue;
        const point = c.mode === "point";
        add(
          point
            ? {
                x: r.x + (c.point?.x ?? c.rect.x + c.rect.width / 2) - c.rect.x,
                y:
                  r.y + (c.point?.y ?? c.rect.y + c.rect.height / 2) - c.rect.y,
                width: 0,
                height: 0,
              }
            : r,
          text,
          label,
          open,
          draft,
          point,
        );
      }
    };
    if (!frozen)
      notes.forEach((n, i) =>
        [n.web.before, ...(n.web.additional || [])].forEach((capture: any) =>
          draw(capture, String(i + 1), n.body, () => showNote(n.id)),
        ),
      );
    if (draftWeb)
      [draftWeb.before, ...(draftWeb.additional || [])].forEach((capture) =>
        draw(capture, "+", "Unsaved UI note · reopen editor", reopen, true),
      );
    if (capturingSelection)
      draw(capturingSelection, "+", "Capturing UI selection", reopen, true);
    else
      selected.forEach((el) => {
        if (!el.isConnected) return;
        add(
          el.getBoundingClientRect(),
          "+",
          "Unsaved selection · write note",
          () => void choose(el, rect(el), mode, [...selected]),
          true,
        );
      });
  }
  function showNote(id: string) {
    const n = notes.find((n) => n.id === id);
    if (!n || busy || !close()) return;
    hideTools();
    clearSelections();
    dock.hidden = false;
    $(".head b").textContent = "Visual note " + (notes.indexOf(n) + 1);
    minimize(false);
    showFrame("note", id);
  }
  async function refresh() {
    const result = await rpc("notes");
    if (disposed) return;
    notes = result.notes;
    $("[data-notes]").textContent = "Notes · " + notes.length;
    pins();
  }
  root.querySelectorAll("[data-mode]").forEach(
    (b) =>
      ((b as HTMLElement).onclick = () => {
        hideTools();
        setMode((b as HTMLElement).dataset.mode!);
      }),
  );
  $("[data-multiple]").onclick = () => {
    hideTools();
    const value = !multiple;
    if (value && mode !== "element" && mode !== "block") setMode("element");
    multiple = value;
    $("[data-multiple]").setAttribute("aria-pressed", String(value));
    hideTools();
  };
  $("[data-notes]").onclick = () => {
    hideTools();
    void rpc("review").catch(error);
  };
  $("[data-resume]").onclick = () => {
    if (!busy && !freezing) resume();
  };
  root
    .querySelectorAll<HTMLAnchorElement>("[data-review],[data-panel-review]")
    .forEach((link) => {
      link.href = config.reviewUrl;
      link.onclick = (e) => {
        hideTools();
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
          return;
        e.preventDefault();
        void rpc(
          "review",
          link.hasAttribute("data-panel-review") && frameKind === "note"
            ? { id: activeToken }
            : {},
        ).catch(error);
      };
    });
  $("[data-close]").onclick = () => {
    close(true);
  };
  $("[data-minimize]").onclick = () => minimize(!minimized);
  const head = $(".head");
  head.onpointerdown = (e) => {
    if (e.button !== 0 || (e.target as Element).closest("button,a")) return;
    dockPress = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      origin: { ...dockPosition },
    };
    head.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  head.onpointermove = (e) => {
    if (!dockPress || dockPress.id !== e.pointerId) return;
    dockPosition = {
      x: dockPress.origin.x + e.clientX - dockPress.x,
      y: dockPress.origin.y + e.clientY - dockPress.y,
    };
    positionDock();
  };
  head.onpointerup =
    head.onpointercancel =
    head.onlostpointercapture =
      (e) => {
        if (dockPress?.id === e.pointerId) dockPress = null;
      };
  $(".head b").onkeydown = (e) => {
    const delta: { [key: string]: [number, number] } = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    if (!delta[e.key]) return;
    e.preventDefault();
    const step = e.shiftKey ? 40 : 10;
    dockPosition.x += delta[e.key][0] * step;
    dockPosition.y += delta[e.key][1] * step;
    positionDock();
  };
  const resize = $("[data-resize]");
  resize.onpointerdown = (e) => {
    if (e.button !== 0 || minimized) return;
    resizePress = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      width: dock.offsetWidth,
      height: dock.offsetHeight,
    };
    resize.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  resize.onpointermove = (e) => {
    if (!resizePress || resizePress.id !== e.pointerId) return;
    resizeDock(
      resizePress.width + e.clientX - resizePress.x,
      resizePress.height + e.clientY - resizePress.y,
    );
  };
  resize.onpointerup =
    resize.onpointercancel =
    resize.onlostpointercapture =
      (e) => {
        if (resizePress?.id === e.pointerId) resizePress = null;
      };
  resize.onkeydown = (e) => {
    const delta: { [key: string]: [number, number] } = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    if (!delta[e.key]) return;
    e.preventDefault();
    const step = e.shiftKey ? 40 : 10;
    resizeDock(
      dock.offsetWidth + delta[e.key][0] * step,
      dock.offsetHeight + delta[e.key][1] * step,
    );
  };
  $("[data-write]").onclick = () => {
    if (selected.length)
      void choose(selected[0], rect(selected[0]), mode, [...selected]);
  };
  $("[data-clear]").onclick = clearSelections;
  listen(root, "focusout", (event) => {
    if (
      !(event.relatedTarget instanceof Node) ||
      !root.contains(event.relatedTarget)
    )
      hideTools();
  });
  launcher.onpointerdown = (e) => {
    if (e.button !== 0 || launcherPress) return;
    suppressLauncherClick = false;
    const press = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      origin: { ...launcherPosition },
      moved: false,
      held: false,
      timer: setTimeout(() => {
        if (launcherPress !== press || press.moved) return;
        press.held = true;
        expand(true);
      }, 450),
    };
    launcherPress = press;
    launcher.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  launcher.onpointermove = (e) => {
    if (
      !launcherPress ||
      e.pointerId !== launcherPress.id ||
      launcherPress.held
    )
      return;
    const dx = e.clientX - launcherPress.x,
      dy = e.clientY - launcherPress.y;
    if (Math.hypot(dx, dy) > 6) {
      launcherPress.moved = true;
      clearTimeout(launcherPress.timer);
    }
    if (!launcherPress.moved) return;
    launcherPosition = {
      x: launcherPress.origin.x + dx,
      y: launcherPress.origin.y + dy,
    };
    positionLauncher();
  };
  function endLauncher(cancelled = false) {
    if (!launcherPress) return;
    clearTimeout(launcherPress.timer);
    suppressLauncherClick =
      cancelled || launcherPress.moved || launcherPress.held;
    launcherPress = null;
    try {
      sessionStorage.setItem(positionKey, JSON.stringify(launcherPosition));
    } catch {}
  }
  launcher.onpointerup = (e) => {
    if (e.pointerId === launcherPress?.id) endLauncher();
  };
  launcher.onpointercancel = launcher.onlostpointercapture = (e) => {
    if (e.pointerId === launcherPress?.id) endLauncher(true);
  };
  launcher.onclick = (e) => {
    const suppressed = suppressLauncherClick;
    suppressLauncherClick = false;
    if (suppressed && e.detail !== 0) return;
    hideTools();
    setMode(mode === "browse" ? selectionMode : "browse");
  };
  launcher.oncontextmenu = (e) => {
    e.preventDefault();
    expand(true);
  };
  launcher.onkeydown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      expand(true);
    }
  };
  function areaRect(a: any, x: number, y: number) {
    return clamp({
      x: Math.min(a.x, x),
      y: Math.min(a.y, y),
      width: Math.max(1, Math.abs(a.x - x)),
      height: Math.max(1, Math.abs(a.y - y)),
    });
  }
  listen(
    document,
    "pointermove",
    (e) => {
      if (e.altKey && !frozen) {
        outline.style.display = "none";
        return;
      }
      if (mode === "browse" || busy || freezing) return;
      if (ours(e)) return;
      if (start) {
        if (
          mode !== "point" &&
          Math.hypot(start.x - e.clientX, start.y - e.clientY) > 6
        )
          start.area = true;
        if (start.area) {
          paint(areaRect(start, e.clientX, e.clientY), "Area");
          return;
        }
        return;
      }
      hovering = target(e);
      if (hovering && (mode === "element" || mode === "block"))
        paintInspection(hovering);
    },
    true,
  );
  listen(
    document,
    "pointerdown",
    (e) => {
      if (!ours(e)) hideTools();
      if (
        mode === "browse" ||
        busy ||
        freezing ||
        frameSaving ||
        ours(e) ||
        (e.altKey && !frozen) ||
        e.button !== 0
      )
        return;
      stop(e);
      const el = target(e);
      start = {
        x: e.clientX,
        y: e.clientY,
        id: e.pointerId,
        el,
        area: mode === "area",
        multiple: multiple || e.shiftKey,
      };
    },
    true,
  );
  listen(
    document,
    "pointerup",
    (e) => {
      if (!start || e.pointerId !== start.id) return;
      const a = start;
      start = null;
      if (
        mode === "browse" ||
        busy ||
        freezing ||
        ours(e) ||
        (e.altKey && !frozen)
      )
        return;
      stop(e);
      if (mode === "point") {
        void choose(
          frozen ? null : target(e) || a.el,
          clamp({
            x: e.clientX - 48,
            y: e.clientY - 48,
            width: 96,
            height: 96,
          }),
          "point",
          [],
          { x: e.clientX, y: e.clientY },
        );
        return;
      }
      if (a.area || Math.hypot(a.x - e.clientX, a.y - e.clientY) > 6)
        void choose(null, areaRect(a, e.clientX, e.clientY), "area");
      else {
        const el = target(e) || a.el;
        if (!el) return;
        if (a.multiple) {
          toggleSelection(el);
          outline.style.display = "none";
        } else if (selected.length) {
          if (!selected.includes(el) && selected.length < 100)
            selected.push(el);
          void choose(el, rect(el), mode, [...selected]);
        } else void choose(el, rect(el));
      }
    },
    true,
  );
  for (const type of ["click", "dblclick", "contextmenu"])
    listen(
      document,
      type,
      (e) => {
        if (
          (freezing || mode !== "browse") &&
          !ours(e) &&
          (frozen || !(e as MouseEvent).altKey)
        )
          stop(e);
      },
      true,
    );
  listen(
    document,
    "pointercancel",
    () => {
      start = null;
      outline.style.display = "none";
    },
    true,
  );
  listen(window, "blur", () => {
    start = null;
    dockPress = null;
    resizePress = null;
    outline.style.display = "none";
    endLauncher(true);
    hideTools();
  });
  listen(window, "beforeunload", (e) => {
    if (frameDirty || busy) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  listen(
    window,
    "keydown",
    (e) => {
      if (
        e.ctrlKey &&
        e.shiftKey &&
        e.code === "KeyF" &&
        !e.altKey &&
        !e.metaKey &&
        !e.isComposing
      ) {
        stop(e);
        if (!e.repeat) void toggleFreeze();
        return;
      }
      if (e.key === "Alt") {
        start = null;
        outline.style.display = "none";
      }
      if (e.key === "Escape") {
        stop(e);
        if (freezing) return;
        if (expanded) {
          hideTools();
          return;
        }
        if (frozen) {
          if (!busy) resume();
          return;
        }
        if (selected.length) {
          clearSelections();
          return;
        }
        if (!dock.hidden) {
          close();
          return;
        }
        if (mode !== "browse") {
          setMode("browse");
          return;
        }
      }
      if (e.key === "Enter" && selected.length && !ours(e)) {
        stop(e);
        void choose(selected[0], rect(selected[0]), mode, [...selected]);
      }
    },
    true,
  );
  let scheduled = false,
    pinsFrame = 0;
  function schedulePins() {
    if (scheduled || disposed) return;
    scheduled = true;
    pinsFrame = requestAnimationFrame(() => {
      scheduled = false;
      paintSelections();
      if (
        !start &&
        !busy &&
        !freezing &&
        (mode === "element" || mode === "block") &&
        hovering?.isConnected
      )
        paintInspection(hovering);
    });
  }
  listen(window, "scroll", schedulePins, true);
  for (const type of ["wheel", "touchmove"])
    listen(
      window,
      type,
      (e) => {
        if (type === "wheel" && mode === "element" && e.altKey && !ours(e)) {
          stop(e);
          const base = inspectBase;
          if (!base) return;
          inspectDepth = Math.max(0, inspectDepth + (e.deltaY > 0 ? 1 : -1));
          const el = inspectTarget(base);
          if (el) {
            hovering = el;
            paintInspection(el);
          }
          return;
        }
        if (frozen && !ours(e)) stop(e);
      },
      { capture: true, passive: false },
    );
  listen(window, "resize", () => {
    resume();
    positionLauncher();
    positionDock();
    schedulePins();
  });
  function dispose() {
    if (disposed) return;
    disposed = true;
    lifecycle.abort();
    clearInterval(refreshTimer);
    cancelAnimationFrame(pinsFrame);
    if (launcherPress) clearTimeout(launcherPress.timer);
    for (const call of pending.values()) {
      clearTimeout(call.timer);
      call.reject(new Error("The review connection closed."));
    }
    pending.clear();
    host.remove();
    delete win[config.key];
    if (win[ownerKey] === config.key) delete win[ownerKey];
  }
  win[ownerKey] = config.key;
  win[config.key] = {
    dispose,
    suspend(value: boolean) {
      suspended = value;
      host.inert = value;
      start = null;
      dockPress = null;
      resizePress = null;
      outline.style.display = "none";
      endLauncher(true);
    },
    resolve(seq: number, result: any) {
      const call = pending.get(seq);
      if (!call) return;
      pending.delete(seq);
      clearTimeout(call.timer);
      lastReply = Date.now();
      result.ok
        ? call.resolve(result.value)
        : call.reject(new Error(result.error));
    },
    async visible(value: boolean) {
      host.style.visibility = value ? "visible" : "hidden";
      await new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(r)),
      );
    },
    async cropFrozen(value: any) {
      if (!frozen || frozen.id !== value.id)
        throw new Error("That frozen view expired. Freeze the page again.");
      const image = frozen.image,
        r = value.rect;
      const canvas = document.createElement("canvas");
      const sx = image.naturalWidth / frozen.capture.viewport.width,
        sy = image.naturalHeight / frozen.capture.viewport.height;
      canvas.width = Math.max(1, Math.round(r.width * sx));
      canvas.height = Math.max(1, Math.round(r.height * sy));
      canvas
        .getContext("2d")!
        .drawImage(
          image,
          r.x * sx,
          r.y * sy,
          r.width * sx,
          r.height * sy,
          0,
          0,
          canvas.width,
          canvas.height,
        );
      return canvas.toDataURL("image/png").split(",")[1];
    },
    async focus(id: string) {
      resume();
      await refresh();
      const n = notes.find((n) => n.id === id);
      if (!n) throw new Error("That UI note no longer exists.");
      if (busy || !close()) return;
      const p = locate(n.web.before);
      if (p?.el) p.el.scrollIntoView({ block: "center" });
      showNote(id);
    },
    async prepare(c: any) {
      resume();
      const grouped = ["element", "block"].includes(c.mode) && c.selections;
      const captures = grouped || [c],
        places = captures.map((s: any) => locate({ ...c, ...s }));
      if (places.some((p: any) => !p))
        throw new Error(
          "The original element or viewport cannot be matched. Restore the original URL, viewport and page state, or create a new note.",
        );
      const elements = places.map((p: any) => p.el);
      if (grouped) {
        const r = union(places.map((p: any) => p.rect));
        window.scrollBy({
          left: r.x + r.width / 2 - innerWidth / 2,
          top: r.y + r.height / 2 - innerHeight / 2,
          behavior: "instant",
        });
      } else if (elements[0])
        elements[0].scrollIntoView({
          block: "center",
          inline: "nearest",
          behavior: "instant",
        });
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const settings = await rpc("context-settings", {});
      if (grouped)
        return captureContext(
          selectionCapture(elements, c.mode),
          elements,
          settings,
        );
      const p = places[0],
        r = clamp(p.el ? rect(p.el) : p.rect);
      return captureContext(
        {
          ...(c.mode === "area" ? areaCapture(r) : metadata(p.el, r, c.mode)),
          ...(c.mode === "point" && c.point
            ? {
                point: {
                  x: p.rect.x + c.point.x - c.rect.x,
                  y: p.rect.y + c.point.y - c.rect.y,
                },
              }
            : {}),
        },
        p.el ? [p.el] : [],
        settings,
      );
    },
  };
  setMode(mode);
  positionLauncher();
  void refresh().catch(error);
  const refreshTimer = setInterval(() => {
    void refresh().catch(() => {
      if (Date.now() - lastReply < 30000) return;
      if (frameDirty || frameSaving || busy) {
        setMode("browse");
        error(
          "The review connection closed. Your unfinished note is still here; reopen the page from lcr to reconnect.",
        );
      } else dispose();
    });
  }, 2000);
}
