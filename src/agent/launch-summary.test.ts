import { expect, test } from "bun:test";
import type { AcpConfig } from "./acp.ts";
import { agentLaunchSummary } from "./launch-summary.ts";

const omp = (args: string[]): AcpConfig => ({
  name: "Any display label",
  command: "/opt/bin/omp",
  args,
});
const codex = (env: Record<string, string>): AcpConfig => ({
  name: "Not a vendor identifier",
  command: "bunx",
  args: ["@agentclientprotocol/codex-acp@2.5.0"],
  env,
});

test("OMP launch summary handles explicit flags without claiming a default", () => {
  expect(agentLaunchSummary(omp(["acp"]))).toEqual({ adapter: "omp" });
  expect(
    agentLaunchSummary(
      omp([
        "--model",
        "openai/gpt-5.2",
        "--thinking=high",
        "--auto-approve",
        "acp",
      ]),
    ),
  ).toEqual({
    adapter: "omp",
    model: "openai/gpt-5.2",
    thinking: "high",
    permissions: "Auto-approve tool calls (--auto-approve)",
  });
  expect(
    agentLaunchSummary(
      omp([
        "--model=old",
        "--model",
        "new",
        "--approval-mode",
        "always-ask",
        "acp",
      ]),
    ),
  ).toEqual({
    adapter: "omp",
    model: "new",
    permissions: "Approval mode: always-ask",
  });
  expect(
    agentLaunchSummary(omp(["--auto-approve", "--approval-mode=yolo", "acp"]))
      .permissions,
  ).toBe("Auto-approve tool calls (--auto-approve)");
});

test("OMP ambiguous argv and arbitrary credential arguments are never summarized", () => {
  for (const args of [
    ["--system-prompt", "--model", "secret", "acp"],
    ["--api-key", "secret", "--model", "real-model", "acp"],
    ["--model", "real-model", "--unknown", "secret", "acp"],
    ["--model", "acp"],
    ["--model=", "acp"],
    ["--model", "a\nsecret", "acp"],
    ["--thinking", "__proto__", "acp"],
    ["--approval-mode", "constructor", "acp"],
    ["acp", "--model", "real-model"],
  ])
    expect(agentLaunchSummary(omp(args))).toEqual({ adapter: "omp" });
});

test("Codex summary allowlists explicit model, reasoning and initial mode only", () => {
  const config = codex({
    CODEX_CONFIG: JSON.stringify({
      model: "gpt-5.2-codex",
      model_reasoning_effort: "xhigh",
      api_key: "secret",
      model_providers: { private: { token: "secret" } },
    }),
    INITIAL_AGENT_MODE: "agent-full-access",
    CODEX_API_KEY: "secret",
    PRIVATE: "secret",
  });
  expect(agentLaunchSummary(config)).toEqual({
    adapter: "codex",
    model: "gpt-5.2-codex",
    thinking: "xhigh",
    permissions: "Initial mode: agent-full-access",
  });
  expect(JSON.stringify(agentLaunchSummary(config))).not.toContain("secret");
  expect(
    agentLaunchSummary({ ...config, command: "/opt/codex-acp", args: [] }),
  ).toEqual(agentLaunchSummary(config));
  expect(
    agentLaunchSummary({
      ...config,
      command: "npx",
      args: ["-y", ...config.args],
    }),
  ).toEqual(agentLaunchSummary(config));
});

test("invalid or unknown Codex config stays unreported without returning its raw text", () => {
  for (const CODEX_CONFIG of [
    "secret",
    "null",
    "[]",
    '"secret"',
    '{"model":{"token":"secret"},"model_reasoning_effort":"secret"}',
    '{"model":"<script>secret</script>"}',
  ])
    expect(
      agentLaunchSummary(
        codex({ CODEX_CONFIG, INITIAL_AGENT_MODE: "__proto__" }),
      ),
    ).toEqual({ adapter: "codex" });
  expect(agentLaunchSummary(codex({}))).toEqual({ adapter: "codex" });
});

test("adapter identity is executable-based and wrappers are not assumed to be Codex", () => {
  const env = { CODEX_CONFIG: '{"model":"secret"}' };
  for (const config of [
    {
      name: "OMP",
      command: "unrelated",
      args: ["--model", "secret", "acp"],
      env,
    },
    { ...codex(env), args: ["other-package"] },
    { ...codex(env), args: ["@agentclientprotocol/codex-acp-malicious"] },
    {
      ...codex(env),
      args: ["@agentclientprotocol/codex-acp@2.5.0", "--model", "secret"],
    },
    { ...codex(env), command: "codex" },
  ])
    expect(agentLaunchSummary(config)).toEqual({ adapter: "other" });
});
