import path from "node:path";
import type { AgentLaunchSummary } from "../shared/agent-types.ts";
import type { AcpConfig } from "./acp.ts";

const thinkingLevels: Record<string, true> = {
  off: true,
  minimal: true,
  low: true,
  medium: true,
  high: true,
  xhigh: true,
  max: true,
  auto: true,
};
const approvalModes: Record<string, true> = {
  "always-ask": true,
  "always-ask-cached": true,
  write: true,
  yolo: true,
};
const codexModes: Record<string, true> = {
  "read-only": true,
  "workspace-write": true,
  agent: true,
  "agent-full-access": true,
};
const modelId = (value: unknown): string | undefined =>
  typeof value === "string" &&
  /^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]{0,159}$/.test(value)
    ? value
    : undefined;

/** Allowlisted profile fields only: never expose argv, arbitrary environment or config. */
export function agentLaunchSummary(config: AcpConfig): AgentLaunchSummary {
  const command = path.basename(config.command).replace(/\.exe$/i, "");
  if (command === "omp") {
    const summary: AgentLaunchSummary = { adapter: "omp" };
    // Unknown options can consume a following token or override earlier settings.
    // Fail closed rather than misidentify their values as model/permission flags.
    if (config.args.at(-1) !== "acp") return summary;
    let model: string | undefined;
    let thinking: string | undefined;
    let approval: string | undefined;
    let autoApprove = false;
    for (let index = 0; index < config.args.length - 1; index++) {
      const arg = config.args[index]!;
      if (arg === "--auto-approve") {
        autoApprove = true;
        continue;
      }
      const equals = arg.indexOf("=");
      const flag = equals < 0 ? arg : arg.slice(0, equals);
      if (!["--model", "--thinking", "--approval-mode"].includes(flag))
        return summary;
      const value = equals < 0 ? config.args[++index] : arg.slice(equals + 1);
      if (index >= config.args.length - 1 || !value) return summary;
      if (flag === "--model") {
        model = modelId(value);
        if (!model) return summary;
      } else if (flag === "--thinking") {
        if (!Object.hasOwn(thinkingLevels, value)) return summary;
        thinking = value;
      } else {
        if (!Object.hasOwn(approvalModes, value)) return summary;
        approval = value;
      }
    }
    return {
      ...summary,
      ...(model ? { model } : {}),
      ...(thinking ? { thinking } : {}),
      ...(autoApprove
        ? { permissions: "Auto-approve tool calls (--auto-approve)" }
        : approval
          ? { permissions: `Approval mode: ${approval}` }
          : {}),
    };
  }
  const packageArgs = config.args.filter(
    (arg) => !["-y", "--yes"].includes(arg),
  );
  const codex =
    (command === "codex-acp" && config.args.length === 0) ||
    (["bunx", "npx"].includes(command) &&
      packageArgs.length === 1 &&
      /^@agentclientprotocol\/codex-acp(?:@[a-zA-Z0-9.+-]+)?$/.test(
        packageArgs[0]!,
      ));
  if (!codex) return { adapter: "other" };
  const summary: AgentLaunchSummary = { adapter: "codex" };
  const mode = config.env?.INITIAL_AGENT_MODE;
  if (mode && Object.hasOwn(codexModes, mode))
    summary.permissions = `Initial mode: ${mode}`;
  try {
    const settings: unknown = JSON.parse(config.env?.CODEX_CONFIG ?? "null");
    if (!settings || typeof settings !== "object" || Array.isArray(settings))
      return summary;
    const values = settings as Record<string, unknown>;
    const model = modelId(values.model);
    if (model) summary.model = model;
    if (
      typeof values.model_reasoning_effort === "string" &&
      ["none", "minimal", "low", "medium", "high", "xhigh"].includes(
        values.model_reasoning_effort,
      )
    )
      summary.thinking = values.model_reasoning_effort;
  } catch {
    // The adapter owns validation; a malformed config is not a displayable setting.
  }
  return summary;
}
