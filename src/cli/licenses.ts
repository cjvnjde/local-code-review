import acp from "../../node_modules/@agentclientprotocol/sdk/LICENSE" with { type: "text" };
import baseUi from "../../node_modules/@base-ui/react/LICENSE" with { type: "text" };
import axe from "../../node_modules/axe-core/LICENSE" with { type: "text" };
import axeDependencies from "../../node_modules/axe-core/LICENSE-3RD-PARTY.txt" with { type: "text" };
import axePackage from "../../node_modules/axe-core/package.json";
import culori from "../../node_modules/culori/LICENSE" with { type: "text" };
import freehand from "../../node_modules/perfect-freehand/LICENSE" with { type: "text" };
import gracefulFs from "../../node_modules/graceful-fs/LICENSE.md" with { type: "text" };
import pixelmatch from "../../node_modules/pixelmatch/LICENSE" with { type: "text" };
import pngjs from "../../node_modules/pngjs/LICENSE" with { type: "text" };
import properLockfile from "../../node_modules/proper-lockfile/LICENSE" with { type: "text" };
import retry from "../../node_modules/retry/License" with { type: "text" };
import signalExit from "../../node_modules/signal-exit/LICENSE.txt" with { type: "text" };
import zod from "../../node_modules/zod/LICENSE" with { type: "text" };

/** Bun embeds these build-time text imports in the standalone executable. */
export function libraryNotices(): string {
  return [
    "Library integration notices",
    "These dependencies retain their own licenses; lcr remains MIT licensed.",
    `Unmodified axe-core ${axePackage.version} source: https://github.com/dequelabs/axe-core/tree/v${axePackage.version}`,
    "axe-core is available under MPL-2.0; its license and bundled third-party notices follow.",
    ...[
      ["@agentclientprotocol/sdk", acp],
      ["@base-ui/react", baseUi],
      ["axe-core", axe],
      ["axe-core bundled dependencies", axeDependencies],
      ["culori", culori],
      ["graceful-fs", gracefulFs],
      ["perfect-freehand", freehand],
      ["pixelmatch", pixelmatch],
      ["pngjs", pngjs],
      ["proper-lockfile", properLockfile],
      ["retry", retry],
      ["signal-exit", signalExit],
      ["zod", zod],
    ].map(([name, text]) => `\n=== ${name} ===\n\n${text}`),
  ].join("\n");
}
