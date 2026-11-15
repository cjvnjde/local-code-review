import { expect, test } from "bun:test";
import type { Result } from "axe-core";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  accessibilityComment,
  accessibilityExpression,
  accessibilityReport,
} from "./accessibility.ts";
import { createSession } from "../review/session.ts";

const rule: Result = {
  id: "button-name",
  impact: "critical",
  help: "Buttons must have discernible text",
  description: "Ensure buttons have discernible text",
  helpUrl: "https://dequeuniversity.com/rules/axe/4.14/button-name",
  tags: ["wcag2a"],
  nodes: [
    {
      html: "<button data-private='RAW_HTML_SECRET'></button>",
      target: ["#checkout", ["review-card", "button"]],
      impact: "serious",
      any: [],
      all: [],
      none: [],
      failureSummary: "Target has no accessible name",
    },
  ],
};
const results = {
  timestamp: "2026-11-15T00:00:00.000Z",
  testEngine: { name: "axe-core", version: "4.14.0" },
  violations: [rule],
  incomplete: [
    {
      ...rule,
      id: "color-contrast",
      nodes: [
        {
          ...rule.nodes[0]!,
          failureSummary: undefined,
          any: [
            {
              id: "color-contrast",
              impact: "serious",
              message: "Background image requires manual review",
              data: null,
            },
          ],
        },
      ],
    },
  ],
};

test("bundled axe runs explicitly with overlay exclusion and no raw node HTML", () => {
  const expression = accessibilityExpression("__lcr_private");
  expect(expression).toContain("axe.configure({noHtml:true})");
  expect(expression).toContain("#__lcr_private");
  expect(expression).toContain("[data-lcr-overlay]");
  expect(expression).toContain("resultTypes:['violations','incomplete']");
  const report = accessibilityReport(results, "http://localhost:3000/checkout");
  expect(report.findings.map((finding) => finding.kind)).toEqual([
    "violation",
    "incomplete",
  ]);
  expect(report.findings[0]!.impact).toBe("serious");
  expect(report.findings[0]!.targets).toEqual(rule.nodes[0]!.target);
  expect(report.findings[1]!.summary).toContain("manual review");
  expect(JSON.stringify(report)).not.toContain("RAW_HTML_SECRET");
  expect(report.scope).toContain("Iframes are not scanned");
  expect(() => accessibilityComment(report, "unknown")).toThrow("expired");
});

test("privacy-active scans withhold page-derived targets, details and URL path", () => {
  const report = accessibilityReport(
    {
      ...results,
      violations: [
        {
          ...rule,
          nodes: [
            {
              ...rule.nodes[0]!,
              target: ["#SECRET"],
              failureSummary: "SECRET",
            },
          ],
        },
      ],
    },
    "http://localhost:3000/SECRET?token=SECRET",
    true,
  );
  expect(report.privacy).toBe(true);
  expect(report.findings[0]!.targets).toEqual([]);
  expect(JSON.stringify(report)).not.toContain("SECRET");
  expect(
    accessibilityComment(report, report.findings[0]!.id).body,
  ).not.toContain("SECRET");
  expect(report.omissionReason).toContain("privacy");
});

test("only selected findings become real notes, preserving manual-review classification and provenance", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "lcr-axe-notes-"));
  try {
    const session = createSession(root, ".review", "HEAD");
    const report = accessibilityReport(
      results,
      "http://localhost:3000/checkout",
    );
    expect((await session.read()).notes).toHaveLength(0);
    const selected = report.findings[1]!;
    const saved = await session.save({
      comments: [accessibilityComment(report, selected.id)],
    });
    const doc = await session.read();
    expect(doc.notes).toHaveLength(1);
    expect(doc.notes[0]!.body).toContain("manual review (incomplete)");
    expect(doc.notes[0]!.body).toContain(selected.id);
    expect(doc.notes[0]!.body).toContain("axe-core 4.14.0");
    expect(doc.notes[0]!.body).toContain("#checkout");
    expect(doc.notes[0]!.body).not.toContain(report.findings[0]!.id);
    expect(doc.notes[0]!.web).toBeUndefined();
    const markdown = await readFile(path.join(root, saved.file), "utf8");
    expect(markdown).not.toContain("RAW_HTML_SECRET");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
