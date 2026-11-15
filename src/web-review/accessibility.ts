import axe, { type AxeResults } from "axe-core";
import type { AccessibilityReport } from "../shared/accessibility.ts";
import type { ReviewComment } from "../shared/review-types.ts";
import { REDACTION_OMISSION } from "../shared/redaction.ts";
import { mintNoteId } from "../shared/note-id.ts";

export const ACCESSIBILITY_SCOPE =
  "Top-level document and open shadow roots; lcr overlay/editor excluded. Iframes are not scanned and require manual review. External assets are not fetched. Automated checks do not establish accessibility conformance.";

/** axe.source is shipped in the executable through the normal Bun import graph; no CDN or runtime file lookup. */
export function accessibilityExpression(overlayId: string): string {
  return `(async()=>{${axe.source}\naxe.configure({noHtml:true});return await axe.run({exclude:[${JSON.stringify("#" + overlayId)},'[data-lcr-overlay]']},{iframes:false,preload:false,resultTypes:['violations','incomplete']});})()`;
}

export function accessibilityReport(
  results: Pick<
    AxeResults,
    "timestamp" | "testEngine" | "violations" | "incomplete"
  >,
  url: string,
  privacy = false,
): AccessibilityReport {
  const id = crypto.randomUUID();
  return {
    id,
    at: results.timestamp,
    url: privacy ? new URL(url).origin + "/" : url,
    engine: {
      name: results.testEngine.name,
      version: results.testEngine.version,
    },
    scope: ACCESSIBILITY_SCOPE,
    privacy,
    ...(privacy ? { omissionReason: REDACTION_OMISSION } : {}),
    findings: (["violations", "incomplete"] as const).flatMap((kind) =>
      results[kind].flatMap((rule) => {
        const nodes = rule.nodes.length ? rule.nodes : [undefined];
        return nodes.map((node, index) => ({
          id: `${id}:${kind}:${rule.id}:${index}`,
          rule: rule.id,
          kind:
            kind === "violations"
              ? ("violation" as const)
              : ("incomplete" as const),
          impact: node?.impact ?? rule.impact ?? null,
          help: rule.help,
          description: rule.description,
          helpUrl: rule.helpUrl,
          tags: [...rule.tags],
          targets: privacy ? [] : structuredClone(node?.target ?? []),
          summary: privacy
            ? "Target selectors and page-derived check details withheld by pre-capture privacy settings."
            : (node?.failureSummary ??
              ((node &&
                [...node.any, ...node.all, ...node.none]
                  .map((check) => check.message)
                  .join("\n")) ||
                (kind === "incomplete"
                  ? "Automated evaluation was inconclusive. Review this target manually."
                  : rule.description))),
        }));
      }),
    ),
  };
}

/** Only selected findings enter ReviewSession.save; scans never create attachments or dispatch agents. */
export function accessibilityComment(
  report: AccessibilityReport,
  findingId: string,
): ReviewComment {
  const finding = report.findings.find((item) => item.id === findingId);
  if (!finding)
    throw new Error("That accessibility finding expired. Run the scan again.");
  const literal = (text: string) =>
    text.replaceAll("`", "\\u0060").replaceAll("<", "\\u003c");
  return {
    id: mintNoteId("", "@", "@"),
    file: "",
    scope: "global",
    start: 0,
    end: 0,
    body: [
      `Accessibility ${finding.kind === "violation" ? "violation" : "manual review (incomplete)"}: ${finding.help}`,
      "",
      `Rule: ${finding.rule}; impact: ${finding.impact ?? "not assigned"}.`,
      finding.description,
      "",
      "```text",
      literal(finding.summary),
      "```",
      "Targets (axe selector paths):",
      "```json",
      literal(JSON.stringify(finding.targets, null, 2)),
      "```",
      ...(report.omissionReason ? [report.omissionReason] : []),
      `Help: ${finding.helpUrl}`,
      `Provenance: ${report.engine.name} ${report.engine.version}; ${report.at}; scan ${report.id}; finding ${finding.id}.`,
      `Page: \`${literal(report.url)}\`.`,
      report.scope,
      "User-selected finding. No screenshot was captured or attached; no agent was dispatched.",
    ].join("\n"),
  };
}
