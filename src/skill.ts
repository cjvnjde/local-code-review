import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import skillContent from "../skills/apply-lcr/SKILL.md" with { type: "text" };

export const SKILL_NAME = "apply-lcr";
export const SKILL_DIRECTORIES = [
  ".agents/skills",
  ".agent/skills",
  ".augment/skills",
  ".claude/skills",
  ".cline/skills",
  ".clinerules/skills",
  ".codex/skills",
  ".cursor/skills",
  ".factory/skills",
  ".gemini/skills",
  ".github/skills",
  ".goose/skills",
  ".junie/skills",
  ".kilo/skills",
  ".kiro/skills",
  ".opencode/skills",
  ".qwen/skills",
  ".roo/skills",
  ".windsurf/skills",
] as const;
export const SKILL_CONTENT = skillContent;

export type SkillTargetState = "create" | "replace" | "installed";

export interface SkillTargetPreview {
  directory: string;
  path: string;
  state: SkillTargetState;
  revision: string | null;
}

export interface SkillPreview {
  name: string;
  content: string;
  targets: SkillTargetPreview[];
}

export interface SkillInstallResult {
  path: string;
  state: "created" | "replaced";
}

export class SkillPreviewChangedError extends Error {
  constructor() {
    super("Skill destination changed since preview. Reopen the preview and confirm again.");
    this.name = "SkillPreviewChangedError";
  }
}

export async function previewSkill(invocationRoot: string): Promise<SkillPreview> {
  const root = path.resolve(invocationRoot);
  const directories = await findSkillDirectories(root);
  const targets = await Promise.all(directories.map(async (directory) => {
    const target = skillPath(root, directory);
    const current = await readCurrentSkill(root, target);
    return {
      directory,
      path: target,
      state: current === null ? "create" : current === SKILL_CONTENT ? "installed" : "replace",
      revision: revisionOf(current),
    } satisfies SkillTargetPreview;
  }));

  return { name: SKILL_NAME, content: SKILL_CONTENT, targets };
}

export async function installSkill(
  invocationRoot: string,
  directory: string,
  expectedState: "create" | "replace",
  expectedRevision: string | null,
): Promise<SkillInstallResult> {
  const root = path.resolve(invocationRoot);
  const available = await findSkillDirectories(root);
  if (!available.includes(directory as typeof available[number])) {
    throw new Error("Skill target is no longer available. Reopen the preview and try again.");
  }

  const target = skillPath(root, directory);
  const current = await readCurrentSkill(root, target);
  const currentState = current === null ? "create" : current === SKILL_CONTENT ? "installed" : "replace";
  if (currentState !== expectedState || revisionOf(current) !== expectedRevision) {
    throw new SkillPreviewChangedError();
  }

  await assertNoSymlinks(root, path.dirname(target));
  await mkdir(path.dirname(target), { recursive: true });
  await assertNoSymlinks(root, target);
  if (current === null) await createSkillFile(target);
  else await replaceSkillFile(target, expectedRevision);
  if (await readCurrentSkill(root, target) !== SKILL_CONTENT) throw new SkillPreviewChangedError();
  return { path: target, state: current === null ? "created" : "replaced" };
}

async function findSkillDirectories(root: string): Promise<string[]> {
  const existing: string[] = [];
  for (const directory of SKILL_DIRECTORIES) {
    if (await isSafeDirectory(root, directory)) existing.push(directory);
  }
  return existing.length ? existing : [SKILL_DIRECTORIES[0]];
}

async function isSafeDirectory(root: string, relative: string): Promise<boolean> {
  let current = root;
  for (const part of relative.split("/")) {
    current = path.join(current, part);
    const info = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!info) return false;
    if (info.isSymbolicLink() || !info.isDirectory()) return false;
  }
  return true;
}

function skillPath(root: string, directory: string): string {
  if (!(SKILL_DIRECTORIES as readonly string[]).includes(directory)) {
    throw new Error("Unsupported skill target.");
  }
  return path.join(root, directory, SKILL_NAME, "SKILL.md");
}

async function readCurrentSkill(root: string, target: string): Promise<string | null> {
  await assertNoSymlinks(root, target);
  return readFile(target, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
}

function revisionOf(content: string | null): string | null {
  return content === null ? null : createHash("sha256").update(content).digest("hex");
}

async function createSkillFile(target: string): Promise<void> {
  try {
    await writeFile(target, SKILL_CONTENT, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (isDestinationRace(error)) throw new SkillPreviewChangedError();
    throw error;
  }
}

async function replaceSkillFile(target: string, expectedRevision: string | null): Promise<void> {
  let file;
  try {
    file = await open(target, constants.O_RDWR | (constants.O_NOFOLLOW ?? 0));
  } catch (error) {
    if (isDestinationRace(error)) throw new SkillPreviewChangedError();
    throw error;
  }

  try {
    const info = await file.stat();
    const current = info.isFile() ? await file.readFile("utf8") : null;
    if (revisionOf(current) !== expectedRevision) throw new SkillPreviewChangedError();

    const content = Buffer.from(SKILL_CONTENT);
    let written = 0;
    while (written < content.byteLength) {
      const result = await file.write(content, written, content.byteLength - written, written);
      if (!result.bytesWritten) throw new Error("Could not write skill content.");
      written += result.bytesWritten;
    }
    await file.truncate(content.byteLength);
    await file.sync();
  } finally {
    await file.close();
  }
}

function isDestinationRace(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code;
  return code === "EEXIST" || code === "ENOENT" || code === "ELOOP" || code === "EISDIR";
}

async function assertNoSymlinks(root: string, target: string): Promise<void> {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Skill target escapes invocation folder.");

  let current = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const info = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!info) return;
    if (info.isSymbolicLink()) throw new Error(`Refusing to write through symbolic link: ${current}`);
  }
}
