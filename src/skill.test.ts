import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { installSkill, previewSkill, SKILL_CONTENT } from "./skill.ts";

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "lcr-skill-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("agent skill installation", () => {
  test("embeds canonical skill without changing project-local copy", async () => {
    const [canonical, local] = await Promise.all([
      readFile(new URL("../skills/apply-lcr/SKILL.md", import.meta.url), "utf8"),
      readFile(new URL("../.agents/skills/apply-lcr/SKILL.md", import.meta.url), "utf8"),
    ]);

    expect(SKILL_CONTENT).toBe(canonical);
    expect(local).toBe(canonical);
  });

  test("falls back to .agents/skills under invocation folder", async () => {
    const root = await tempRoot();
    const preview = await previewSkill(root);

    expect(preview.targets).toEqual([{
      directory: ".agents/skills",
      path: path.join(root, ".agents/skills/apply-lcr/SKILL.md"),
      state: "create",
      revision: null,
    }]);

    const result = await installSkill(root, ".agents/skills", "create", null);
    expect(result.state).toBe("created");
    expect(await readFile(result.path, "utf8")).toBe(SKILL_CONTENT);
  });

  test("offers every existing supported skills directory", async () => {
    const root = await tempRoot();
    await Promise.all([
      mkdir(path.join(root, ".claude/skills"), { recursive: true }),
      mkdir(path.join(root, ".codex/skills"), { recursive: true }),
      mkdir(path.join(root, ".github/skills"), { recursive: true }),
      mkdir(path.join(root, ".opencode/skills"), { recursive: true }),
    ]);

    const preview = await previewSkill(root);
    expect(preview.targets.map((target) => target.directory)).toEqual([
      ".claude/skills",
      ".codex/skills",
      ".github/skills",
      ".opencode/skills",
    ]);
  });

  test("previews and replaces an existing different skill", async () => {
    const root = await tempRoot();
    const target = path.join(root, ".claude/skills/apply-lcr/SKILL.md");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "custom skill", "utf8");

    const preview = await previewSkill(root);
    expect(preview.targets[0]?.state).toBe("replace");
    const result = await installSkill(root, ".claude/skills", "replace", preview.targets[0]!.revision);
    expect(result.state).toBe("replaced");
    expect(await readFile(target, "utf8")).toBe(SKILL_CONTENT);
    expect((await previewSkill(root)).targets[0]?.state).toBe("installed");
  });

  test("rejects destination changed after preview", async () => {
    const root = await tempRoot();
    const preview = await previewSkill(root);
    const target = preview.targets[0]!.path;
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "created after preview", "utf8");

    await expect(installSkill(root, ".agents/skills", "create", null)).rejects.toThrow("changed since preview");
    expect(await readFile(target, "utf8")).toBe("created after preview");
  });

  test("rejects changed replacement content", async () => {
    const root = await tempRoot();
    const target = path.join(root, ".agents/skills/apply-lcr/SKILL.md");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "first custom version", "utf8");
    const preview = await previewSkill(root);
    await writeFile(target, "second custom version", "utf8");

    await expect(installSkill(root, ".agents/skills", "replace", preview.targets[0]!.revision))
      .rejects.toThrow("changed since preview");
    expect(await readFile(target, "utf8")).toBe("second custom version");
  });

  test("rejects target not offered by current preview", async () => {
    const root = await tempRoot();
    await expect(installSkill(root, ".claude/skills", "create", null)).rejects.toThrow("no longer available");
  });
});
