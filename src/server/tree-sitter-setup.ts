import {
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { lock } from "proper-lockfile";
import { z } from "zod";
import {
  reviewParserStatus,
  type ParserReviewFile,
  type TreeSitterStatus,
} from "../shared/tree-sitter.ts";
import { runParserCommand } from "./parser-process.ts";
import { parseSyntaxHtml } from "./syntax-html.ts";

const parsers = [
  [
    "tree-sitter/tree-sitter-javascript",
    [["js", "source.js", "const count = 1;\n"]],
  ],
  [
    "tree-sitter/tree-sitter-typescript",
    [
      ["ts", "source.ts", "const count: number = 1;\n"],
      ["tsx", "source.tsx", "const view = <div>Hello</div>;\n"],
    ],
  ],
  [
    "tree-sitter-grammars/tree-sitter-yaml",
    [["yaml", "source.yaml", "enabled: true\n"]],
  ],
  [
    "tree-sitter/tree-sitter-html",
    [["html", "source.html", '<div class="greeting">Hello</div>\n']],
  ],
  [
    "tree-sitter/tree-sitter-css",
    [["css", "source.css", ".greeting { color: red; }\n"]],
  ],
  [
    "tree-sitter/tree-sitter-json",
    [["json", "source.json", '{"enabled": true}\n']],
  ],
  ["tree-sitter/tree-sitter-bash", [["sh", "source.bash", 'echo "hello"\n']]],
  [
    "tree-sitter/tree-sitter-python",
    [["py", "source.python", 'print("hello")\n']],
  ],
  [
    "tree-sitter/tree-sitter-go",
    [["go", "source.go", "package main; func main() {}\n"]],
  ],
  [
    "tree-sitter/tree-sitter-rust",
    [["rs", "source.rust", 'fn main() { println!("hello"); }\n']],
  ],
] as const;

const configSchema = z
  .object({
    "parser-directories": z.array(z.string()).optional(),
  })
  .passthrough();

interface SetupOptions {
  enabled?: boolean;
  env?: NodeJS.ProcessEnv;
  /** Uses the same Git diff source as the review, without running highlighting. */
  getFiles?: () => Promise<readonly ParserReviewFile[]>;
  /** Re-probe highlighting and notify open reviews after setup or an explicit refresh. */
  onRefresh: () => void;
}

/** No repository paths or commands come from HTTP; setup only manages this fixed catalog. */
export function createTreeSitterSetup(options: SetupOptions) {
  const env = options.env ?? process.env;
  const absolute = (value: string | undefined, fallback: string) =>
    value && path.isAbsolute(value) ? value : fallback;
  const configBase =
    process.platform === "win32"
      ? absolute(env.APPDATA, path.join(homedir(), "AppData", "Roaming"))
      : absolute(env.XDG_CONFIG_HOME, path.join(homedir(), ".config"));
  const configFile = path.join(configBase, "tree-sitter", "config.json");
  const directory = path.join(
    absolute(
      env.XDG_DATA_HOME,
      process.platform === "win32"
        ? absolute(env.LOCALAPPDATA, configBase)
        : path.join(homedir(), ".local", "share"),
    ),
    "lcr",
    "tree-sitter",
  );
  let installation: TreeSitterStatus["installation"] = { state: "idle" };
  type Detected = Omit<TreeSitterStatus, "installation" | "review">;
  let detected: Promise<Detected> | undefined;
  const review = async (status: Detected) =>
    reviewParserStatus(
      (await options.getFiles?.()) ?? [],
      status.languages,
      status.missingTools,
    );
  const which = (command: string) =>
    Bun.which(command, { cwd: tmpdir(), PATH: env.PATH });
  const run = (args: string[], cwd: string, timeoutMs = 3000) =>
    runParserCommand(args, {
      cwd,
      timeoutMs,
      env: { ...env, GIT_TERMINAL_PROMPT: "0" },
    });
  async function checked(args: string[], cwd: string, timeoutMs = 120_000) {
    const result = await run(args, cwd, timeoutMs);
    if (result.code !== 0)
      throw new Error(
        `${path.basename(args[0]!)} failed: ${(result.stderr || result.stdout).trim().slice(-2000) || `exit ${result.code}`}`,
      );
    return result;
  }

  async function detect(): Promise<Detected> {
    const command = which("tree-sitter");
    const status: Detected = {
      enabled: options.enabled !== false,
      cli: command ? { path: command, version: "Unknown version" } : null,
      languages: [],
      directory,
      missingTools: [],
      error: null,
    };
    for (const tool of ["tree-sitter", "git", "bun"])
      if (!which(tool)) status.missingTools.push(tool);
    if (
      ![env.CC, "cc", "clang", "gcc", "cl"].some((tool) => tool && which(tool))
    )
      status.missingTools.push("C compiler");
    if (!command) return status;
    const work = await mkdtemp(path.join(tmpdir(), "lcr-parser-status-"));
    try {
      const version = await checked([command, "--version"], work, 3000);
      status.cli!.version =
        (version.stdout || version.stderr).trim().slice(0, 200) ||
        "Unknown version";
      const listing = await checked([command, "dump-languages"], work, 3000);
      status.languages = [
        ...new Set(
          [
            ...(listing.stdout + "\n" + listing.stderr).matchAll(
              /^scope:\s*(\S+)/gm,
            ),
          ].map((match) => match[1]!),
        ),
      ].sort();
    } catch (error) {
      status.error = (error as Error).message;
    } finally {
      await rm(work, { recursive: true, force: true });
    }
    return status;
  }

  async function readConfig() {
    const file = Bun.file(configFile);
    if (!(await file.exists())) return null;
    try {
      if (file.size > 1024 * 1024) throw new Error("file exceeds 1 MiB");
      return configSchema.parse(await file.json());
    } catch {
      throw new Error(
        `Fix the Tree-sitter configuration at ${configFile} before installing parsers. Existing settings were not replaced.`,
      );
    }
  }

  async function install(mode: "recommended" | "detected") {
    const status = await detect();
    const current = await review(status);
    const missing = new Set(
      current.languages
        .filter((language) => !language.configured)
        .map((language) => language.parser),
    );
    const selected = parsers.filter(
      ([repo]) =>
        mode === "recommended" ||
        [...missing].some((parser) => repo.endsWith(`/tree-sitter-${parser}`)),
    );
    if (!selected.length) return "No missing parsers for this review.";
    const missingTools =
      mode === "recommended" ? status.missingTools : current.missingTools;
    if (missingTools.length)
      throw new Error(
        `Install the missing tools first: ${missingTools.join(", ")}. Then check again.`,
      );
    const command = status.cli!.path;
    // Fail before downloading anything when an existing configuration cannot be merged safely.
    await readConfig();
    await mkdir(directory, { recursive: true });
    const canonical = await realpath(directory);
    let release: () => Promise<void>;
    try {
      release = await lock(canonical, {
        lockfilePath: path.join(canonical, ".install.lock"),
        stale: 30_000,
        update: 5000,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ELOCKED") throw error;
      throw new Error(
        "Another lcr server is installing parsers. Wait for it to finish, then check again.",
      );
    }
    let work: string | undefined;
    try {
      work = await mkdtemp(path.join(directory, ".install-"));
      for (const [repo] of selected) {
        const name = repo.split("/")[1]!;
        const target = path.join(directory, name);
        installation = {
          state: "running",
          detail: `Installing ${name.replace("tree-sitter-", "")}…`,
        };
        if (await Bun.file(path.join(target, "tree-sitter.json")).exists()) {
          if (name === "tree-sitter-typescript")
            await checked(
              [which("bun")!, "install", "--production", "--ignore-scripts"],
              target,
            );
          continue;
        }
        const clone = path.join(work, name);
        await checked(
          [
            which("git")!,
            "-c",
            "core.hooksPath=",
            "clone",
            "--depth",
            "1",
            `https://github.com/${repo}.git`,
            clone,
          ],
          work,
        );
        if (name === "tree-sitter-typescript") {
          // Upstream TS/TSX queries refer to node_modules/tree-sitter-javascript.
          await checked(
            [which("bun")!, "install", "--production", "--ignore-scripts"],
            clone,
          );
        }
        await rename(clone, target);
      }
      installation = {
        state: "running",
        detail: "Configuring parser discovery…",
      };
      if (!(await readConfig())) await checked([command, "init-config"], work);
      // Reread after downloads so unrelated edits made during installation survive.
      const config = await readConfig();
      if (!config) throw new Error(`Tree-sitter did not create ${configFile}.`);
      config["parser-directories"] = [
        ...new Set([...(config["parser-directories"] ?? []), directory]),
      ];
      const destination = await realpath(configFile);
      const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(config, null, 2) + "\n", {
          mode: 0o600,
          flag: "wx",
        });
        await rename(temporary, destination);
      } finally {
        await rm(temporary, { force: true });
      }
      for (const [, samples] of selected) {
        for (const [extension, scope, source] of samples) {
          installation = {
            state: "running",
            detail: `Compiling and checking ${extension.toUpperCase()}…`,
          };
          const sample = path.join(work, `example.${extension}`);
          await writeFile(sample, source);
          const result = await checked(
            [
              command,
              "highlight",
              "--html",
              "--css-classes",
              "--scope",
              scope,
              "--",
              sample,
            ],
            work,
          );
          const tokens = parseSyntaxHtml(result.stdout, source);
          if (
            !tokens?.some((line) =>
              line.some((token) => token.kind !== "plain"),
            )
          )
            throw new Error(
              `The ${extension.toUpperCase()} parser did not produce highlighting. Check its queries and your Tree-sitter theme.`,
            );
        }
      }
    } finally {
      if (work) await rm(work, { recursive: true, force: true });
      await release();
    }
    return mode === "recommended"
      ? "Recommended parsers are ready."
      : "Parsers for this review are ready.";
  }

  return {
    async status(): Promise<TreeSitterStatus> {
      const status = await (detected ??= detect());
      return { ...status, review: await review(status), installation };
    },
    async refresh() {
      if (installation.state !== "running") {
        detected = undefined;
        options.onRefresh();
      }
      return this.status();
    },
    startInstall(mode: "recommended" | "detected" = "recommended") {
      if (installation.state === "running") return;
      installation = { state: "running", detail: "Checking setup tools…" };
      void install(mode)
        .then(
          (detail) => {
            installation = {
              state: "complete",
              detail,
            };
          },
          (error: unknown) => {
            installation = {
              state: "failed",
              detail:
                error instanceof Error
                  ? error.message
                  : "Parser installation failed. Try again.",
            };
          },
        )
        .finally(() => {
          detected = undefined;
          options.onRefresh();
        });
    },
  };
}

export type TreeSitterSetup = ReturnType<typeof createTreeSitterSetup>;
