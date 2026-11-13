import { expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("production bundle processes Tailwind without warnings and preserves highlight styles", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "lcr-build-"));
  try {
    const build = Bun.spawn(
      [
        process.execPath,
        "run",
        "scripts/build.ts",
        "--bundle",
        "--outfile",
        directory,
      ],
      {
        cwd: path.resolve(import.meta.dir, "../.."),
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [code, stdout, stderr] = await Promise.all([
      build.exited,
      new Response(build.stdout).text(),
      new Response(build.stderr).text(),
    ]);
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    expect(stdout).toContain("Bundled lcr");

    const files = await readdir(directory, { recursive: true });
    const css = (
      await Promise.all(
        files
          .filter((file) => file.endsWith(".css"))
          .map((file) => Bun.file(path.join(directory, file)).text()),
      )
    ).join("\n");
    expect(css.length).toBeGreaterThan(0);
    expect(css).not.toMatch(/@(source|custom-variant|theme|apply|tailwind)\b/);
    expect(css).toContain(".flex{display:flex}");

    const htmlFile = files.find((file) => file.endsWith(".html"));
    expect(htmlFile).toBeDefined();
    const html = await Bun.file(path.join(directory, htmlFile!)).text();
    expect(html).toContain("::highlight(lcr-selection)");
    expect(html).toContain("::highlight(lcr-notes)");
    expect(html).toContain("var(--primary)");
    expect(html).toContain("#f59e0b33");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
