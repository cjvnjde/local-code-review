import type { Cdp, CdpEvent, CdpEventParams } from "../browser/cdp.ts";
import type { ContextPartInput } from "../review/context.ts";
import { boundedRequest, safeEvidenceUrl } from "./evidence.ts";

type DiagnosticEvent = {
  at: string;
  type: string;
  level?: string;
  method?: string;
  resourceType?: string;
  status?: number;
  url?: string;
  canceled?: boolean;
};
type PendingRequest = {
  at: number;
  method?: string;
  resourceType?: string;
  url?: string;
};
const METHODS: Record<string, true> = {
  GET: true,
  HEAD: true,
  POST: true,
  PUT: true,
  DELETE: true,
  CONNECT: true,
  OPTIONS: true,
  TRACE: true,
  PATCH: true,
};
const RESOURCE_TYPES: Record<string, true> = {
  Document: true,
  Stylesheet: true,
  Image: true,
  Media: true,
  Font: true,
  Script: true,
  TextTrack: true,
  XHR: true,
  Fetch: true,
  Prefetch: true,
  EventSource: true,
  WebSocket: true,
  Manifest: true,
  SignedExchange: true,
  Ping: true,
  CSPViolationReport: true,
  Preflight: true,
  Other: true,
};

/** Target/session-scoped metadata only; arguments, exception text, headers and bodies never enter buffers. */
export class DiagnosticsEvidence {
  private events: DiagnosticEvent[] = [];
  private requests = new Map<string, PendingRequest>();
  private listeners: (() => void)[] = [];
  private active = false;
  private generation = 0;
  private network = false;
  private clipped = false;
  private startedAt = "";
  constructor(
    private cdp: Pick<Cdp, "send" | "on">,
    private session: string,
  ) {}

  clear() {
    this.events = [];
    this.requests.clear();
    this.clipped = false;
    this.startedAt = new Date().toISOString();
  }
  private prune() {
    const cutoff = Date.now() - 60_000;
    this.events = this.events.filter((event) => Date.parse(event.at) >= cutoff);
    for (const [id, request] of this.requests)
      if (request.at < cutoff) this.requests.delete(id);
  }
  private add(event: Omit<DiagnosticEvent, "at">) {
    if (!this.active) return;
    this.prune();
    this.events.push({ at: new Date().toISOString(), ...event });
    if (this.events.length > 50) {
      this.events.shift();
      this.clipped = true;
    }
  }
  async configure(enabled: boolean) {
    if (enabled === this.active) return;
    const generation = ++this.generation;
    this.active = enabled;
    this.network = false;
    this.clear();
    for (const off of this.listeners) off();
    this.listeners = [];
    if (!enabled) {
      await boundedRequest(
        this.cdp.send("Network.disable", {}, this.session),
        500,
      ).catch(() => {});
      return;
    }
    const on = <M extends CdpEvent>(
      method: M,
      callback: (event: CdpEventParams<M>) => void,
    ) => {
      this.listeners.push(
        this.cdp.on(method, (event, sid) => {
          if (
            this.active &&
            generation === this.generation &&
            sid === this.session &&
            event &&
            typeof event === "object"
          )
            callback(event);
        }),
      );
    };
    on("Runtime.consoleAPICalled", (event) => {
      if (event.type === "warning" || event.type === "error")
        this.add({ type: "console", level: event.type });
    });
    on("Runtime.exceptionThrown", () => this.add({ type: "exception" }));
    on("Network.requestWillBeSent", (event) => {
      if (
        typeof event.requestId !== "string" ||
        event.requestId.length > 200 ||
        !event.request ||
        typeof event.request !== "object"
      )
        return;
      this.prune();
      if (this.requests.size >= 100) {
        this.requests.delete(this.requests.keys().next().value!);
        this.clipped = true;
      }
      const request = event.request;
      this.requests.set(event.requestId, {
        at: Date.now(),
        ...(typeof request.method === "string" &&
        METHODS[request.method] === true
          ? { method: request.method }
          : {}),
        ...(typeof event.type === "string" &&
        RESOURCE_TYPES[event.type] === true
          ? { resourceType: event.type }
          : {}),
        url: safeEvidenceUrl(request.url),
      });
    });
    on("Network.responseReceived", (event) => {
      if (
        typeof event.requestId !== "string" ||
        !event.response ||
        typeof event.response !== "object"
      )
        return;
      const response = event.response;
      if (
        typeof response.status !== "number" ||
        !Number.isInteger(response.status) ||
        response.status < 400 ||
        response.status > 599
      )
        return;
      const pending = this.requests.get(event.requestId);
      if (!pending || pending.at < Date.now() - 60_000) return;
      const { at: _at, ...metadata } = pending;
      this.add({
        ...metadata,
        type: "http-error",
        status: response.status,
        url: safeEvidenceUrl(response.url),
      });
    });
    on("Network.loadingFailed", (event) => {
      if (typeof event.requestId !== "string") return;
      const pending = this.requests.get(event.requestId);
      if (!pending || pending.at < Date.now() - 60_000) return;
      const { at: _at, ...metadata } = pending;
      this.requests.delete(event.requestId);
      this.add({
        ...metadata,
        type: "request-failed",
        canceled: event.canceled === true,
      });
    });
    on("Network.loadingFinished", (event) => {
      if (typeof event.requestId === "string")
        this.requests.delete(event.requestId);
    });
    try {
      await boundedRequest(
        this.cdp.send(
          "Network.enable",
          { maxTotalBufferSize: 0, maxResourceBufferSize: 0 },
          this.session,
        ),
        500,
      );
      if (generation === this.generation && this.active) this.network = true;
    } catch {
      /* Console metadata remains useful when Network is unsupported. */
    }
  }
  snapshot(enabled: boolean): ContextPartInput {
    const part = {
      name: "diagnostics",
      label: "Recent opt-in diagnostic metadata",
      type: "application/json",
    };
    if (!enabled)
      return {
        ...part,
        status: "excluded",
        detail:
          "Diagnostic recording was disabled at capture time; no diagnostic history is retained while disabled.",
      };
    if (!this.active)
      return {
        ...part,
        status: "unavailable",
        detail:
          "The reviewed target had no active diagnostic recorder at capture time.",
      };
    this.prune();
    return {
      ...part,
      data: JSON.stringify({
        version: 1,
        events: this.events,
        windowMs: 60_000,
        limit: 50,
        coverage: {
          startedAt: this.startedAt,
          console: "warning/error calls and exception occurrence metadata only",
          network: this.network
            ? "HTTP errors and request failures"
            : "unavailable",
          scope:
            "attached target/session; history cleared on navigation, disable and detach",
        },
        exclusions: [
          "Console arguments/text, exception messages/stacks, request/response bodies and headers are never retained.",
          "URL credentials, query strings and fragments are removed; URL paths may still contain sensitive information.",
          "Requests from other targets and earlier navigation epochs are not retained.",
        ],
        limits: { pendingRequests: 100 },
      }),
      truncated: this.clipped,
      detail:
        "Opt-in bounded metadata only; no console payloads, exception messages, headers or network bodies.",
    };
  }
  dispose() {
    this.active = false;
    ++this.generation;
    for (const off of this.listeners) off();
    this.listeners = [];
    this.clear();
  }
}
