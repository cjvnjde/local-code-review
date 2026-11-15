import {
  AcpClient,
  ACP_DIAGNOSTIC_BYTES,
  readAcpConfig,
} from "../agent/acp.ts";
import { loadUserSettings, resolveAcpPath } from "./config.ts";

const HELP = `Usage: lcr doctor [--acp <profile.json>] [--diagnostics]

Check the configured external ACP agent without creating a session or sending a task.
Works outside Git. Relative --acp paths resolve from the current directory.
--diagnostics includes at most ${ACP_DIAGNOSTIC_BYTES} bytes of agent stderr in this terminal;
it may contain credentials or private content. Nothing is written to a log.`;
const WARNING =
  "Privacy warning: --diagnostics exposes a bounded agent stderr tail that may contain credentials or private content. Review it before sharing. No diagnostic log is written.";

/** Run before repository discovery: doctor needs only trusted user settings and cwd. */
export async function runDoctorCli(argv: string[]): Promise<string> {
  let acp: string | undefined;
  let diagnostics = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "-h") return HELP;
    if (arg === "--diagnostics") diagnostics = true;
    else if (arg === "--acp") {
      const value = argv[++i];
      if (!value || value.startsWith("-") || value.includes("\0"))
        throw new Error("lcr doctor --acp requires a profile path.");
      acp = value;
    } else
      throw new Error(`Unknown doctor option: ${arg}. Use lcr doctor --help.`);
  }
  const settings = await loadUserSettings({ acp });
  const file = resolveAcpPath(
    { acp: acp ?? settings.acp ?? undefined },
    process.cwd(),
  );
  if (!file)
    throw new Error(
      "No ACP agent is configured. Set acp in your user lcr settings or run lcr doctor --acp <profile.json>.",
    );
  const config = await readAcpConfig(file);
  const executable = Bun.which(config.command, {
    cwd: process.cwd(),
    PATH: config.env?.PATH ?? process.env.PATH,
  });
  if (!executable)
    throw new Error(
      `ACP executable missing or not executable: ${config.command}. Install the agent, check its executable permissions, or fix command/PATH in ${file}. No agent was started.`,
    );

  const agent = new AcpClient(
    config,
    process.cwd(),
    {
      update() {},
      permission(permission) {
        agent.decide(permission.id);
      },
      lost() {},
    },
    { diagnostics },
  );
  let failure: unknown;
  try {
    await agent.start();
  } catch (error) {
    failure = error;
  } finally {
    await agent.close();
  }
  const diagnosticReport = diagnostics
    ? `\n\n${WARNING}\nAgent stderr tail (maximum ${ACP_DIAGNOSTIC_BYTES} bytes):\n${agent.diagnostics.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "�") || "(empty)"}`
    : "";
  if (failure)
    throw new Error(
      `ACP start/initialization failed: ${failure instanceof Error ? failure.message : String(failure)}\nCheck the agent's ACP mode, authentication and profile arguments. No session or task was sent.${diagnostics ? "" : " Use --diagnostics to explicitly include a bounded stderr tail (may contain secrets)."}${diagnosticReport}`,
    );
  const capabilities = agent.capabilities;
  return (
    [
      `ACP doctor: ready (${config.name})`,
      `Executable: ${executable}`,
      "Protocol: stable ACP v1",
      `Session restoration: ${capabilities.loadSession ? "supported" : "not advertised"}`,
      `Image prompts: ${capabilities.promptCapabilities?.image ? "supported" : "not advertised"}`,
      `Audio prompts: ${capabilities.promptCapabilities?.audio ? "supported" : "not advertised"}`,
      `Embedded context: ${capabilities.promptCapabilities?.embeddedContext ? "supported" : "not advertised"}`,
      "Initialization only; no session or task was sent. Agent process closed.",
    ].join("\n") + diagnosticReport
  );
}
