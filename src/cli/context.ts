import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  contextTextSlice,
  readContext,
  readContextPart,
} from "../review/context.ts";
import { contextId, contextIsText } from "../shared/context.ts";

export const CONTEXT_HELP = `Usage:
  lcr context inspect <id> --review <review.md>
  lcr context read <id> --review <review.md> --part <name> [--offset N --limit N]

Read immutable saved context offline, without Git, settings, a server, or an agent.
IDs may also be review-relative context/<id>/manifest.json references.
Text reads return JSON with UTF-8-safe byte offsets and nextOffset (null at EOF).
The default text limit is 16384 bytes; the maximum is 65536 bytes.
Binary reads report a local path and MIME type, never inline binary data.`;

export async function runContextCli(argv: string[]): Promise<string> {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h"))
    return CONTEXT_HELP;
  const [command, rawId, ...flags] = argv;
  if (command !== "inspect" && command !== "read")
    throw new Error(
      "context requires inspect or read; use lcr context --help.",
    );
  const id = contextId(rawId);
  if (!id)
    throw new Error(
      "context requires a 64-character lowercase SHA-256 ID or review-relative manifest path.",
    );
  const values = new Map<string, string>();
  for (let i = 0; i < flags.length; i += 2) {
    const flag = flags[i]!;
    if (!["--review", "--part", "--offset", "--limit"].includes(flag))
      throw new Error(`Unknown context option: ${flag}.`);
    if (values.has(flag)) throw new Error(`Duplicate context option: ${flag}.`);
    const value = flags[i + 1];
    if (!value || value.startsWith("--"))
      throw new Error(`${flag} requires a value.`);
    values.set(flag, value);
  }
  const review = values.get("--review");
  if (!review)
    throw new Error(
      "--review <review.md> is required to scope context retrieval.",
    );
  if (
    command === "inspect" &&
    ["--part", "--offset", "--limit"].some((flag) => values.has(flag))
  )
    throw new Error(
      "--part, --offset, and --limit apply only to context read.",
    );
  const name = values.get("--part");
  if (command === "read" && !name)
    throw new Error("context read requires --part <name>.");
  const numbers: { offset?: number; limit?: number } = {};
  for (const key of ["offset", "limit"] as const) {
    const value = values.get(`--${key}`);
    if (value !== undefined) {
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
        throw new Error(`--${key} requires a non-negative integer.`);
      numbers[key] = Number(value);
    }
  }
  let reviewFile: string;
  try {
    reviewFile = await realpath(path.resolve(review));
    if (!(await stat(reviewFile)).isFile()) throw new Error("not a file");
  } catch {
    throw new Error(
      `Review file does not exist or is not a regular file: ${review}.`,
    );
  }
  const directory = path.dirname(reviewFile);
  if (command === "inspect") {
    const manifest = await readContext(directory, ".", id);
    if (!manifest)
      throw new Error(
        `Context bundle ${id} is missing or incomplete beside ${reviewFile}.`,
      );
    return JSON.stringify(manifest, null, 2);
  }
  const found = await readContextPart(directory, ".", id, name!);
  if (!found)
    throw new Error(
      `Context part ${name} in ${id} is missing or unavailable beside ${reviewFile}.`,
    );
  if (contextIsText(found.part.type))
    return JSON.stringify(
      {
        part: found.part,
        ...contextTextSlice(found.bytes, numbers.offset, numbers.limit),
      },
      null,
      2,
    );
  if (numbers.offset !== undefined || numbers.limit !== undefined)
    throw new Error("--offset and --limit apply only to text parts.");
  return JSON.stringify(
    {
      part: found.part,
      path: path.resolve(
        directory,
        found.part.attachment ?? `context/${id}/${found.part.file}`,
      ),
      type: found.part.type,
      totalBytes: found.bytes.byteLength,
    },
    null,
    2,
  );
}
