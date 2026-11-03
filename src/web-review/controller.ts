import { attachRef, readAttachment, saveAttachment } from "../review/attach.ts";
import { preserveWebContexts, saveWebContext } from "../review/web-context.ts";
import type { ContextPartInput } from "../review/context.ts";
import {
  CONTEXT_MAX_BYTES,
  DEFAULT_CONTEXT_SETTINGS,
  type ContextSettings,
} from "../shared/context.ts";
import type { Hub } from "../server/events.ts";
import {
  launchReviewBrowser,
  type ReviewBrowser,
} from "../browser/review-browser.ts";
import { attachReviewBrowser } from "../browser/existing-browser.ts";
import { reviewBrowserProfile } from "../browser/profile.ts";
import type { CliOptions } from "../shared/review-types.ts";
import type { ReviewSession } from "../review/session.ts";
import { installPageReview } from "../web/client/web-review/page-overlay.ts";
import {
  dropWebSelection,
  localWebUrl,
  setWebAnnotation,
  webAnnotationTarget,
  WebAnnotationInvalid,
  WebSelectionConflict,
  webCapture,
  type WebCapture,
  type WebAnnotationTarget,
  type WebReview,
} from "../shared/web-review.ts";
import {
  webAnnotation,
  webAnnotationImagesMatch,
  type WebAnnotation,
} from "../shared/web-annotation.ts";

export interface WebReviewOptions {
  url: string;
  repoRoot: string;
  outDir: string;
  browserProfile?: CliOptions["browserProfile"];
  browserDataDir?: string;
  session: ReviewSession;
  hub: Hub;
  reviewUrl: () => string;
  /** Used by browser integration tests; ordinary launches always have a visible window. */
  browserArgs?: string[];
  /** Separate ownership for the source-only playground's example overlay. */
  overlayOwnerKey?: string;
}
export function createWebReview(options: WebReviewOptions) {
  const url = localWebUrl(options.url),
    origin = new URL(url).origin;
  let browser: ReviewBrowser | null = null,
    sessionId = "",
    contextId = 0;
  let scriptId = "",
    closing = false;
  let connectionAbort: AbortController | undefined;
  let offDisconnect = () => {};
  let reviewTargetId = "",
    reviewOpening: Promise<{
      targetId: string;
      created: boolean;
      url: string;
    }> | null = null;
  let opening: Promise<void> | null = null,
    state = "closed",
    detail = "Open the page to annotate your UI.";
  let queue: Promise<unknown> = Promise.resolve();
  const key = "__lcr_" + crypto.randomUUID().replaceAll("-", ""),
    binding = key + "_send";
  const drafts = new Map<string, WebReview | null>();
  const replyDrafts = new Map<string, string>();
  const draftOwners = new Map<string, string>();
  let contextSettings: ContextSettings = { ...DEFAULT_CONTEXT_SETTINGS };
  type ContextSnapshot = {
    settings: ContextSettings;
    extras: ContextPartInput[];
  };
  let frozen: {
    id: string;
    capture: WebCapture;
    snapshot: ContextSnapshot;
  } | null = null;
  function discardDraft(id: string) {
    const owner = draftOwners.get(id);
    if (owner) replyDrafts.delete(owner);
    draftOwners.delete(id);
    return drafts.delete(id);
  }
  function createDraft(web: WebReview) {
    if (drafts.size >= 30) discardDraft(drafts.keys().next().value!);
    const draftId = crypto.randomUUID();
    drafts.set(draftId, web);
    return draftId;
  }
  function appendReplyCapture(id: string, capture: WebCapture) {
    let draftId = replyDrafts.get(id);
    const current = draftId ? drafts.get(draftId) : null;
    if (current && (current.additional?.length ?? 0) >= 100)
      throw new Error("This follow-up already has 100 additional selections.");
    const web: WebReview = current ?? { before: capture, after: [] };
    if (current) (web.additional ??= []).push(capture);
    if (!draftId) {
      draftId = createDraft(web);
      replyDrafts.set(id, draftId);
      draftOwners.set(draftId, id);
    } else drafts.set(draftId, web);
    return { web: structuredClone(web), draftId, reply: true };
  }
  let listeners: (() => void)[] = [];
  const unbind = () => {
    for (const off of listeners) off();
    listeners = [];
  };
  const status = () => ({ url, state, detail });
  const send = (method: string, params: Record<string, unknown> = {}) => {
    if (!browser) throw new Error("Open the review browser first.");
    return browser.cdp.send(method, params, sessionId);
  };
  async function evaluate(expression: string, executionContextId?: number) {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      ...(executionContextId ? { contextId: executionContextId } : {}),
    });
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.exception?.description ||
          result.exceptionDetails.text,
      );
    return result.result.value;
  }
  const api = (method: string, value: any) =>
    evaluate(
      `globalThis[${JSON.stringify(key)}].${method}(${JSON.stringify(value)})`,
    );
  async function detachPage() {
    frozen = null;
    unbind();
    const current = browser,
      sid = sessionId,
      script = scriptId;
    sessionId = "";
    contextId = 0;
    scriptId = "";
    if (!current || !sid || !current.cdp.connected) return;
    if (script)
      await current.cdp
        .send(
          "Page.removeScriptToEvaluateOnNewDocument",
          { identifier: script },
          sid,
        )
        .catch(() => {});
    await current.cdp
      .send(
        "Runtime.evaluate",
        {
          expression: `globalThis[${JSON.stringify(key)}]?.dispose()`,
        },
        sid,
      )
      .catch(() => {});
    await current.cdp
      .send("Runtime.removeBinding", { name: binding }, sid)
      .catch(() => {});
    await current.cdp
      .send("Target.detachFromTarget", { sessionId: sid })
      .catch(() => {});
  }
  async function releaseBrowser() {
    offDisconnect();
    offDisconnect = () => {};
    await detachPage();
    const current = browser;
    browser = null;
    reviewTargetId = "";
    if (current) await current.close();
  }
  /** Only top-level review pages can be the conversation tab, never editor frames. */
  async function ensureReviewTarget(destination = options.reviewUrl()) {
    if (reviewOpening) return reviewOpening;
    if (!browser) throw new Error("Browser disconnected.");
    const cdp = browser.cdp;
    reviewOpening = (async () => {
      const { targetInfos } = await cdp.send("Target.getTargets");
      const reviewOrigin = new URL(options.reviewUrl()).origin;
      const isReview = (target: any) => {
        if (target.type !== "page") return false;
        try {
          const candidate = new URL(target.url);
          return (
            candidate.origin === reviewOrigin &&
            !candidate.searchParams.has("ui-draft") &&
            !candidate.searchParams.has("ui-note")
          );
        } catch {
          return false;
        }
      };
      const target =
        targetInfos.find(
          (target: any) =>
            target.targetId === reviewTargetId && isReview(target),
        ) || targetInfos.find(isReview);
      if (target) {
        reviewTargetId = target.targetId;
        return { targetId: reviewTargetId, created: false, url: target.url };
      }
      reviewTargetId = (
        await cdp.send("Target.createTarget", {
          url: destination,
          background: true,
        })
      ).targetId;
      return { targetId: reviewTargetId, created: true, url: destination };
    })();
    try {
      return await reviewOpening;
    } finally {
      reviewOpening = null;
    }
  }
  async function review(id?: string) {
    let ref = "";
    if (id !== undefined) {
      if (
        typeof id !== "string" ||
        !(await options.session.read()).notes.some((note) => note.id === id)
      )
        throw new Error("That note no longer exists.");
      ref = /\|#([0-9a-z]+)$/.exec(id)?.[1] || "";
      if (!ref) throw new Error("That note has no valid reference.");
    }
    if (!browser?.cdp.connected) await open();
    if (!browser) throw new Error("Browser disconnected.");
    const destination = new URL(options.reviewUrl());
    if (ref) destination.hash = "note=" + encodeURIComponent(ref);
    const target = await ensureReviewTarget(destination.href);
    await browser.cdp.send("Target.activateTarget", {
      targetId: target.targetId,
    });
    if (ref && !target.created) {
      const attached = await browser.cdp.send("Target.attachToTarget", {
        targetId: target.targetId,
        flatten: true,
      });
      try {
        // Native fragment navigation keeps the document and its active editors intact.
        const next = new URL(target.url);
        next.hash = destination.hash;
        if (target.url !== next.href) {
          const navigation = await browser.cdp.send(
            "Page.navigate",
            { url: next.href },
            attached.sessionId,
          );
          if (navigation.errorText)
            throw new Error(
              "Could not navigate to the note: " + navigation.errorText,
            );
        } else {
          // User-facing hash handlers may open a dialog; do not await that interaction over CDP.
          await browser.cdp.send(
            "Runtime.evaluate",
            {
              expression:
                "setTimeout(()=>dispatchEvent(new HashChangeEvent('hashchange')),0);void 0",
            },
            attached.sessionId,
          );
        }
      } finally {
        await browser.cdp
          .send("Target.detachFromTarget", { sessionId: attached.sessionId })
          .catch(() => {});
      }
    }
    return {};
  }
  function settingsSnapshot(value: unknown): ContextSettings {
    const settings = value && typeof value === "object" ? value : {};
    return {
      aiContext: "aiContext" in settings && settings.aiContext === true,
      contextHtml: "contextHtml" in settings && settings.contextHtml === true,
      contextFullPage:
        "contextFullPage" in settings && settings.contextFullPage === true,
    };
  }
  async function fullPagePart(capture: WebCapture): Promise<ContextPartInput> {
    const part = {
      name: "full-page",
      label: "Full document screenshot",
      type: "image/png",
    };
    try {
      const metrics = await send("Page.getLayoutMetrics");
      const bounds = metrics.cssContentSize;
      if (
        !bounds ||
        !Number.isFinite(bounds.width) ||
        !Number.isFinite(bounds.height) ||
        bounds.width <= 0 ||
        bounds.height <= 0
      )
        throw new Error("The browser did not report document bounds.");
      const dpr = capture.viewport.dpr;
      const scale = Math.min(
        1,
        8192 / (Math.max(bounds.width, bounds.height) * dpr),
        Math.sqrt(16_000_000 / (bounds.width * bounds.height * dpr * dpr)),
      );
      if (scale < 0.05)
        throw new Error(
          "Document extent exceeds the bounded full-page screenshot limit.",
        );
      const image = await send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: true,
        clip: {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          scale,
        },
      });
      if (
        typeof image.data !== "string" ||
        image.data.length > Math.ceil(CONTEXT_MAX_BYTES / 3) * 4
      )
        throw new Error("Full-page PNG exceeds the 12 MiB limit.");
      const bytes = Buffer.from(image.data, "base64");
      if (bytes.length > CONTEXT_MAX_BYTES)
        throw new Error("Full-page PNG exceeds the 12 MiB limit.");
      const name = await saveAttachment(
        options.repoRoot,
        options.outDir,
        bytes,
        "image/png",
      );
      if (!name) throw new Error("The full-page PNG could not be saved.");
      return {
        ...part,
        attachment: attachRef(name),
        detail: `Complete document extent ${bounds.width} × ${bounds.height} CSS pixels; screenshot scale ${scale}.`,
      };
    } catch (error) {
      return {
        ...part,
        status: "unavailable",
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }
  function htmlPart(
    input: { contextHtml?: unknown },
    settings: ContextSettings,
  ): ContextPartInput {
    const part = {
      name: "selected-html",
      label: "Sanitized selected HTML and spatial identities",
      type: "application/json",
    };
    if (!settings.contextHtml)
      return {
        ...part,
        status: "excluded",
        detail: "Selected HTML was disabled at capture time.",
      };
    const html = input.contextHtml;
    if (
      !html ||
      typeof html !== "object" ||
      !("data" in html) ||
      typeof html.data !== "string" ||
      Buffer.byteLength(html.data) > 256 * 1024
    )
      return {
        ...part,
        status: "unavailable",
        detail: "Bounded selected HTML was not available at capture time.",
      };
    return {
      ...part,
      data: html.data,
      truncated: "truncated" in html && html.truncated === true,
      detail:
        "Capture-time sanitized visible DOM only. Form controls, hidden content, scripts, arbitrary attributes, state and props are excluded.",
    };
  }
  async function screenshot(input: any, freezeId?: unknown) {
    const settings = { ...contextSettings };
    const clean = webCapture({
      ...input,
      annotation: undefined,
      context: undefined,
      proposal: undefined,
      page: "images/page.png",
      area: "images/area.png",
    });
    if (!clean || new URL(clean.url).origin !== origin)
      throw new Error(
        "Invalid page selection. Select an area in the reviewed localhost page.",
      );
    if (freezeId !== undefined) {
      if (
        !frozen ||
        frozen.id !== freezeId ||
        !["area", "point"].includes(clean.mode) ||
        clean.url !== frozen.capture.url ||
        clean.at !== frozen.capture.at ||
        JSON.stringify(clean.viewport) !==
          JSON.stringify(frozen.capture.viewport) ||
        JSON.stringify(clean.scroll) !== JSON.stringify(frozen.capture.scroll)
      )
        throw new Error(
          "That frozen view expired. Resume and freeze the page again.",
        );
      const page = frozen.capture.page;
      const data = await api("cropFrozen", { id: freezeId, rect: clean.rect });
      const area = await saveAttachment(
        options.repoRoot,
        options.outDir,
        Buffer.from(data, "base64"),
        "image/png",
      );
      if (!area) throw new Error("Could not save the frozen selection.");
      const snapshot = frozen.snapshot;
      let capture: WebCapture = { ...clean, page, area: attachRef(area) };
      if (snapshot.settings.aiContext)
        capture = await saveWebContext(
          options.repoRoot,
          options.outDir,
          capture,
          snapshot.extras,
        );
      return { capture, snapshot };
    }
    const actual = await evaluate(
      "({url:location.href,width:innerWidth,height:innerHeight,x:scrollX,y:scrollY})",
    );
    if (
      actual.url !== clean.url ||
      actual.width !== clean.viewport.width ||
      actual.height !== clean.viewport.height ||
      actual.x !== clean.scroll.x ||
      actual.y !== clean.scroll.y
    )
      throw new Error(
        "The page moved during selection. Select the area again.",
      );
    await api("visible", false);
    try {
      const page = await send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: false,
      });
      const area = await send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: false,
        clip: {
          x: clean.rect.x + clean.scroll.x,
          y: clean.rect.y + clean.scroll.y,
          width: clean.rect.width,
          height: clean.rect.height,
          scale: 1,
        },
      });
      const extras: ContextPartInput[] = settings.aiContext
        ? [
            htmlPart(input, settings),
            settings.contextFullPage
              ? await fullPagePart(clean)
              : {
                  name: "full-page",
                  label: "Full document screenshot",
                  type: "image/png",
                  status: "excluded",
                  detail: "Full-page screenshot was disabled at capture time.",
                },
          ]
        : [];
      const after = await evaluate(
        "({url:location.href,width:innerWidth,height:innerHeight,x:scrollX,y:scrollY})",
      );
      if (JSON.stringify(actual) !== JSON.stringify(after))
        throw new Error(
          "The page moved while capturing. Select the area again.",
        );
      const [pageName, areaName] = await Promise.all([
        saveAttachment(
          options.repoRoot,
          options.outDir,
          Buffer.from(page.data, "base64"),
          "image/png",
        ),
        saveAttachment(
          options.repoRoot,
          options.outDir,
          Buffer.from(area.data, "base64"),
          "image/png",
        ),
      ]);
      if (!pageName || !areaName)
        throw new Error("Could not save screenshots.");
      let capture: WebCapture = {
        ...clean,
        page: attachRef(pageName),
        area: attachRef(areaName),
      };
      if (settings.aiContext)
        capture = await saveWebContext(
          options.repoRoot,
          options.outDir,
          capture,
          extras,
        );
      return { capture, snapshot: { settings, extras } };
    } finally {
      await api("visible", true).catch(() => {});
    }
  }
  async function action(name: string, payload: any) {
    if (name === "context-settings") return { ...contextSettings };
    if (name === "freeze") {
      const { capture, snapshot } = await screenshot(payload.capture);
      const image = await readAttachment(
        options.repoRoot,
        options.outDir,
        capture.page,
      );
      if (!image) throw new Error("Could not load the frozen view.");
      const id = crypto.randomUUID();
      frozen = { id, capture, snapshot };
      return {
        id,
        data:
          "data:image/png;base64," +
          Buffer.from(image.bytes).toString("base64"),
      };
    }
    if (name === "resume") {
      if (frozen?.id === payload.id) frozen = null;
      return {};
    }
    if (name === "notes")
      return {
        notes: (await options.session.read()).notes.filter((n) => n.web),
      };
    if (name === "annotation") {
      const hasDraft = payload.draftId !== undefined,
        hasNote = payload.id !== undefined;
      const target = webAnnotationTarget(payload.target),
        annotation =
          payload.annotation === null
            ? null
            : webAnnotation(payload.annotation);
      if (
        hasDraft === hasNote ||
        !target ||
        (payload.annotation !== null && !annotation)
      )
        throw new WebAnnotationInvalid(
          "Choose a draft or saved note and a valid screenshot annotation target.",
        );
      if (hasDraft) {
        if (typeof payload.draftId !== "string" || !drafts.has(payload.draftId))
          throw new WebSelectionConflict(
            "That captured selection no longer exists.",
          );
        const current = drafts.get(payload.draftId);
        if (!current)
          throw new WebSelectionConflict(
            "That capture no longer exists. Reload the note and try again.",
          );
        const web = setWebAnnotation(current, target, annotation);
        if (annotation) {
          const capture =
            target.kind === "after"
              ? web.after[target.index]!
              : target.index === 0
                ? web.before
                : web.additional![target.index - 1]!;
          if (
            !(await webAnnotationImagesMatch(annotation, capture.area, (name) =>
              readAttachment(options.repoRoot, options.outDir, name),
            ))
          )
            throw new WebAnnotationInvalid(
              "The PNG attachments are missing, invalid, or their dimensions do not match the annotation. Upload the drawing again.",
            );
        }
        const preserved = await preserveWebContexts(
          options.repoRoot,
          options.outDir,
          web,
        );
        drafts.set(payload.draftId, preserved);
        return { web: structuredClone(preserved) };
      }
      if (typeof payload.id !== "string" || !payload.id)
        throw new WebAnnotationInvalid("A note id is required.");
      const note = await options.session.annotateWebCapture(
        payload.id,
        target,
        annotation,
      );
      if (!note?.web)
        throw new WebSelectionConflict("That UI capture no longer exists.");
      options.hub.emit({ type: "review", file: options.session.file });
      return { web: note.web };
    }
    if (name === "remove-selection") {
      const hasDraft = payload.draftId !== undefined,
        hasNote = payload.id !== undefined;
      if (hasDraft === hasNote)
        throw new Error("Choose either a draft or a saved UI note.");
      if (
        !Number.isInteger(payload.index) ||
        payload.index < 0 ||
        payload.index > 100 ||
        typeof payload.key !== "string"
      )
        throw new Error("A selection index and expected key are required.");
      if (hasDraft) {
        if (typeof payload.draftId !== "string" || !drafts.has(payload.draftId))
          throw new Error("That captured selection no longer exists.");
        const current = drafts.get(payload.draftId);
        if (!current)
          throw new Error(
            "That selection no longer exists. Reload the note and try again.",
          );
        const web = dropWebSelection(current, payload.index, payload.key);
        drafts.set(payload.draftId, web);
        return { web: structuredClone(web) };
      }
      if (typeof payload.id !== "string")
        throw new Error("A note id is required.");
      const note = await options.session.removeWebSelection(
        payload.id,
        payload.index,
        payload.key,
      );
      if (!note) throw new Error("That UI selection no longer exists.");
      options.hub.emit({ type: "review", file: options.session.file });
      return { web: note.web ?? null };
    }
    if (name === "capture") {
      const hasDraft = payload.draftId !== undefined,
        hasNote = payload.id !== undefined;
      if (hasDraft && hasNote)
        throw new Error("Choose either a draft or a saved UI note.");
      if (
        hasDraft &&
        (typeof payload.draftId !== "string" || !drafts.has(payload.draftId))
      )
        throw new Error("That captured selection no longer exists.");
      if (
        hasNote &&
        (typeof payload.id !== "string" ||
          !(await options.session.read()).notes.some(
            (note) => note.id === payload.id && note.scope === "global",
          ))
      )
        throw new Error("That overall note no longer exists.");
      const draft = hasDraft ? drafts.get(payload.draftId)! : null;
      if (draft && (draft.additional?.length ?? 0) >= 100)
        throw new Error("This note already has 100 additional selections.");
      const { capture } = await screenshot(payload.capture, payload.freezeId);
      const result = { capture };
      if (hasDraft) {
        const web: WebReview = draft ?? { before: result.capture, after: [] };
        if (draft) (web.additional ??= []).push(result.capture);
        drafts.set(payload.draftId, web);
        return {
          ...result,
          web: structuredClone(web),
          draftId: payload.draftId,
          ...(draftOwners.has(payload.draftId) ? { reply: true } : {}),
        };
      }
      if (hasNote) {
        if (payload.editOriginal !== true)
          return {
            ...result,
            ...appendReplyCapture(payload.id, result.capture),
          };
        try {
          const note = await options.session.addWebSelection(
            payload.id,
            result.capture,
          );
          if (!note?.web)
            throw new Error(
              "That note was deleted before the selection was saved.",
            );
          options.hub.emit({ type: "review", file: options.session.file });
          return { ...result, web: note.web };
        } catch (error) {
          // An answer arriving during an explicit edit closes that original's evidence.
          if (!(error instanceof WebSelectionConflict)) throw error;
          return {
            ...result,
            ...appendReplyCapture(payload.id, result.capture),
          };
        }
      }
      const web: WebReview = { before: result.capture, after: [] };
      const draftId = createDraft(web);
      return { ...result, web: structuredClone(web), draftId };
    }
    if (name === "discard") {
      if (typeof payload.draftId !== "string" || !discardDraft(payload.draftId))
        throw new Error("That captured selection no longer exists.");
      return {};
    }
    if (name === "after") {
      const note = (await options.session.read()).notes.find(
        (n) => n.id === payload.id,
      );
      if (!note?.web) throw new Error("That UI note no longer exists.");
      await open(); // A background page can suspend the animation frame that locates its capture.
      const metadata = await api("prepare", note.web.before);
      const { capture } = await screenshot(metadata);
      const result = { capture };
      return { ...result, ...appendReplyCapture(note.id, result.capture) };
    }
    if (name === "review") return review(payload.id);
    throw new Error("Unknown web review action.");
  }
  async function open() {
    if (closing) throw new Error("The browser connection is closing.");
    if (opening) return opening;
    opening = (async () => {
      const existing = options.browserProfile === "existing";
      try {
        if (browser && !browser.cdp.connected) await releaseBrowser();
        if (browser && sessionId) {
          try {
            const targetId = (await send("Target.getTargetInfo")).targetInfo
              .targetId;
            await ensureReviewTarget();
            await browser.cdp.send("Target.activateTarget", { targetId });
            return;
          } catch {
            await detachPage();
          }
        }
        state = "opening";
        detail = existing
          ? "Allow the connection in Chrome's dialog…"
          : "Starting the review browser…";
        if (!browser) {
          connectionAbort = new AbortController();
          browser = existing
            ? await attachReviewBrowser(
                options.browserDataDir,
                connectionAbort.signal,
              )
            : await launchReviewBrowser(
                reviewBrowserProfile(
                  options.repoRoot,
                  options.outDir,
                  options.browserProfile === "project" ? "project" : "shared",
                ),
                options.browserArgs,
              );
          const connected = browser;
          offDisconnect = connected.cdp.onDisconnect(() => {
            if (browser !== connected) return;
            state = "closed";
            detail = "The browser disconnected. Use Open page to reconnect.";
          });
        }
        await detachPage();
        const cdp = browser.cdp;
        const targets = await cdp.send("Target.getTargets");
        const matches = targets.targetInfos.filter(
          (t: any) =>
            t.type === "page" && t.url === (existing ? url : "about:blank"),
        );
        if (existing && matches.length > 1)
          throw new Error(
            "More than one browser tab matches " +
              url +
              ". Close duplicate tabs or use a distinct --web URL, then retry.",
          );
        const target = matches[0];
        const targetId =
          target?.targetId ||
          (
            await cdp.send("Target.createTarget", {
              url: existing ? url : "about:blank",
            })
          ).targetId;
        sessionId = (
          await cdp.send("Target.attachToTarget", { targetId, flatten: true })
        ).sessionId;
        const attachedSession = sessionId;
        const frame = (await send("Page.getFrameTree")).frameTree.frame.id;
        listeners.push(
          cdp.on("Runtime.executionContextsCleared", (_, sid) => {
            if (sid === attachedSession) {
              contextId = 0;
              frozen = null;
            }
          }),
        );
        listeners.push(
          cdp.on("Runtime.executionContextCreated", (event, sid) => {
            if (
              sid === attachedSession &&
              event.context.auxData?.isDefault &&
              event.context.auxData?.frameId === frame
            )
              contextId = event.context.id;
          }),
        );
        listeners.push(
          cdp.on("Runtime.bindingCalled", (event, sid) => {
            if (
              sid !== attachedSession ||
              event.name !== binding ||
              event.executionContextId !== contextId ||
              event.payload.length > 1_000_000
            )
              return;
            const context = event.executionContextId;
            let message: any;
            try {
              message = JSON.parse(event.payload);
            } catch {
              return;
            }
            if (
              !Number.isSafeInteger(message.seq) ||
              typeof message.action !== "string"
            )
              return;
            const work = async () => {
              if (context !== contextId || attachedSession !== sessionId)
                return;
              let result: any;
              try {
                result = {
                  ok: true,
                  value: await action(message.action, message.payload || {}),
                };
              } catch (error) {
                result = {
                  ok: false,
                  error: error instanceof Error ? error.message : String(error),
                };
              }
              await evaluate(
                `globalThis[${JSON.stringify(key)}]?.resolve(${message.seq},${JSON.stringify(result)})`,
                context,
              ).catch(() => {});
            };
            // prepare() runs inside the action queue and asks for current settings.
            // This read-only RPC must not wait behind the action awaiting it.
            if (message.action === "context-settings") void work();
            else queue = queue.then(work, work);
          }),
        );
        await send("Page.enable");
        await send("Runtime.enable");
        await send("Runtime.addBinding", { name: binding });
        const source =
          "(" +
          installPageReview.toString() +
          ")(" +
          JSON.stringify({
            key,
            binding,
            origin,
            reviewUrl: options.reviewUrl(),
            ...(options.overlayOwnerKey
              ? { ownerKey: options.overlayOwnerKey }
              : {}),
          }) +
          ")";
        // Register before navigation: full reloads retain the toolbar; SPA navigation retains its DOM.
        scriptId = (
          await send("Page.addScriptToEvaluateOnNewDocument", { source })
        ).identifier;
        if (existing) await evaluate(source);
        else {
          const navigation = await send("Page.navigate", { url });
          if (navigation.errorText)
            throw new Error(
              "Could not load " + url + ": " + navigation.errorText,
            );
        }
        let installed = false;
        for (let i = 0; i < 100; i++) {
          if (closing) throw new Error("The browser connection is closing.");
          installed = await evaluate(
            "typeof globalThis[" +
              JSON.stringify(key) +
              "]?.prepare==='function'",
          ).catch(() => false);
          if (installed) break;
          await Bun.sleep(100);
        }
        if (!installed)
          throw new Error(
            "The annotation toolbar could not start. Check that the local app is running and its page finishes loading.",
          );
        await ensureReviewTarget();
        await cdp.send("Target.activateTarget", { targetId });
        state = "ready";
        detail =
          "Click an element or drag an area to annotate. Hold Alt to interact with the app.";
        listeners.push(
          cdp.on("Target.detachedFromTarget", (event) => {
            if (
              event.sessionId === attachedSession &&
              sessionId === attachedSession
            ) {
              sessionId = "";
              contextId = 0;
              state = "closed";
              detail = "The reviewed tab closed. Use Open page to continue.";
            }
          }),
        );
      } catch (error) {
        state = "error";
        detail = error instanceof Error ? error.message : String(error);
        await releaseBrowser();
        throw error;
      } finally {
        opening = null;
      }
    })();
    return opening;
  }
  return {
    status,
    configureContext(settings: Partial<ContextSettings>) {
      contextSettings = settingsSnapshot(settings);
    },
    open,
    review(id?: string) {
      const work = () => review(id);
      const next = queue.then(work, work);
      queue = next.catch(() => {});
      return next;
    },
    draft(id: string) {
      if (
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
          id,
        )
      )
        return undefined;
      const web = drafts.get(id);
      return web === undefined ? undefined : structuredClone(web);
    },
    replyDraft(id: string) {
      const draftId = replyDrafts.get(id);
      return {
        reply: true,
        ...(draftId ? { draftId } : {}),
        web: draftId ? structuredClone(drafts.get(draftId) ?? null) : null,
      };
    },
    discardDraft(id: string) {
      const work = () => action("discard", { draftId: id });
      const next = queue.then(work, work);
      queue = next.catch(() => {});
      return next;
    },
    removeSelection(payload: {
      draftId?: string;
      id?: string;
      index: number;
      key: string;
    }) {
      const work = () => action("remove-selection", payload);
      const next = queue.then(work, work);
      queue = next.catch(() => {});
      return next;
    },
    annotate(payload: {
      draftId?: string;
      id?: string;
      target: WebAnnotationTarget;
      annotation: WebAnnotation | null;
    }) {
      const input = structuredClone(payload);
      const work = () => action("annotation", input);
      const next = queue.then(work, work);
      queue = next.catch(() => {});
      return next;
    },
    async captureAfter(id: string): Promise<{
      capture: WebCapture;
      web: WebReview;
      draftId: string;
      reply: true;
    }> {
      const work = () => action("after", { id });
      const next = queue.then(work, work);
      queue = next.catch(() => {});
      return next;
    },
    async focus(id: string) {
      const note = (await options.session.read()).notes.find(
        (n) => n.id === id,
      );
      if (!note?.web) throw new Error("That UI note no longer exists.");
      await open();
      // Do not navigate automatically: restoring app state belongs to the reviewer.
      return api("focus", note.id);
    },
    async close() {
      closing = true;
      connectionAbort?.abort();
      try {
        await opening?.catch(() => {});
        await releaseBrowser();
        state = "closed";
      } finally {
        closing = false;
      }
    },
  };
}
export type WebReviewController = ReturnType<typeof createWebReview>;
