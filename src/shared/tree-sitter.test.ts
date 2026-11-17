import { expect, test } from "bun:test";
import { reviewParserStatus } from "./tree-sitter.ts";

test("detects review languages from extensions and named files, including both sides of renames", () => {
  const review = reviewParserStatus(
    [
      { path: "src/component.tsx", from: "src/component.jsx" },
      { path: "types/index.d.ts" },
      { path: "config.yml", from: "old/config.yaml" },
      { path: ".github/workflows/check.yaml" },
      { path: "shell/.bashrc" },
      { path: "shell/.bash_profile" },
      { path: "src/removed.py" },
      { path: "generated.ts.map" },
      { path: "source.ts/README.md" },
      { path: "binary.json", binary: true },
      { path: "assets/logo.png" },
      { path: "unknown.custom" },
    ],
    ["source.js", "source.ts"],
    [],
  );
  expect(
    review.languages.map(({ scope, files, configured }) => ({
      scope,
      files,
      configured,
    })),
  ).toEqual([
    { scope: "source.js", files: 1, configured: true },
    { scope: "source.ts", files: 1, configured: true },
    { scope: "source.tsx", files: 1, configured: false },
    { scope: "source.yaml", files: 2, configured: false },
    { scope: "source.bash", files: 2, configured: false },
    { scope: "source.python", files: 1, configured: false },
  ]);
});

test("only TypeScript setup needs Bun, and configured or unmapped files need no installation", () => {
  const files = [{ path: "app.ts" }, { path: "index.html" }];
  expect(
    reviewParserStatus(files, ["source.ts"], ["bun", "git"]).missingTools,
  ).toEqual(["git"]);
  expect(
    reviewParserStatus([...files, { path: "view.tsx" }], ["source.ts"], ["bun"])
      .missingTools,
  ).toEqual(["bun"]);
  expect(
    reviewParserStatus(files, ["source.ts", "source.html"], ["bun", "git"])
      .missingTools,
  ).toEqual([]);
  expect(
    reviewParserStatus(
      [{ path: "README.md" }, { path: "script.rb" }],
      [],
      ["bun"],
    ).languages,
  ).toEqual([]);
});

test("recognizes the other recommended file types and JavaScript module suffixes", () => {
  const review = reviewParserStatus(
    [
      "source.js",
      "source.mjs",
      "source.cjs",
      "source.jsx",
      "site.css",
      "config.json",
      "source.go",
      "source.rs",
      "script.sh",
      "script.bash",
    ].map((path) => ({ path })),
    [],
    [],
  );
  expect(
    review.languages.map(({ label, files }) => ({ label, files })),
  ).toEqual([
    { label: "JavaScript / JSX", files: 4 },
    { label: "CSS", files: 1 },
    { label: "JSON", files: 1 },
    { label: "Bash", files: 2 },
    { label: "Go", files: 1 },
    { label: "Rust", files: 1 },
  ]);
});
