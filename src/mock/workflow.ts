import type {
  Connection,
  Project,
  Run,
  RunReport,
  ScoutSettings,
  Suggestion,
} from "../types";
import { runStages } from "../stages";

export const defaultProjects: Project[] = [
  {
    id: "project_1",
    repo: "octocat/async-toolkit",
    description:
      "Async Python helpers for background work, cancellation, and worker queues.",
    language: "python",
    use_as_evidence: true,
    topics: ["asyncio", "python", "queues"],
  },
  {
    id: "project_2",
    repo: "octocat/trace-lab",
    description:
      "Experiments in tracing and instrumentation for developer tools.",
    language: "typescript",
    use_as_evidence: true,
    topics: ["observability", "tracing"],
  },
  {
    id: "project_3",
    repo: "octocat/learning-notes",
    description:
      "Notes and examples from building and contributing to open-source projects.",
    language: "none",
    use_as_evidence: false,
    topics: ["documentation"],
  },
];
export const defaultSettings: ScoutSettings = {
  days: 3,
  updated_days: 30,
  search_pages: 2,
  candidate_limit: 30,
  max_comment_pages: 5,
  max_timeline_pages: 5,
  claim_days: 14,
  retry_days: 7,
  max_attempts: 2,
  min_score: 6,
  min_confidence: 0.7,
  labels: ["bug", "help wanted"],
  documentation_labels: ["documentation", "docs"],
  skill_aliases: { observability: ["tracing", "instrumentation"] },
  schedule_enabled: true,
  schedule_time: "11:30",
  timezone: "America/New_York",
  draft_fixes: true,
  email_enabled: false,
  email: "",
  tracing_enabled: false,
};
export const defaultConnections: Connection[] = [
  {
    id: "github",
    name: "GitHub",
    detail: "Your identity, projects, and contribution activity.",
    connected: true,
    required: true,
  },
  {
    id: "ranking",
    name: "Issue evaluation",
    detail: "Groq evaluates suitability, evidence, and repository policies.",
    connected: true,
    required: true,
  },
  {
    id: "solver",
    name: "Fix drafting",
    detail: "Claude Code drafts changes for your review.",
    connected: true,
    required: true,
  },
  {
    id: "email",
    name: "Email delivery",
    detail: "Receive your review brief and patch by email.",
    connected: false,
    required: false,
  },
  {
    id: "tracing",
    name: "Run tracing",
    detail: "Optional LangSmith traces for detailed run inspection.",
    connected: false,
    required: false,
  },
];
export function makeReport(
  suggestion: Suggestion,
  email: boolean,
  failedDelivery: boolean,
): RunReport {
  const documentation = suggestion.work_type === "documentation";
  const report: RunReport = {
    root_cause: documentation
      ? "The public guide omits the supported custom retry callback."
      : "The async generator closes before its final span attributes are copied into the exporter payload.",
    approach: documentation
      ? "Add one runnable TypeScript example and explain when to use custom backoff."
      : "Preserve the final attributes during generator cleanup and add a focused regression test.",
    risks:
      "This example report needs human review against the actual repository before use.",
    not_verified:
      "Behavior against external services and production workloads. Mock tests shown here have not executed real code.",
    maintainer_questions: [
      "Does this change affect the public API? No public signature changes are proposed.",
      "Why this approach? It keeps the change limited to the documented behavior.",
    ],
    checklist: [
      "Claim the issue and confirm maintainer expectations.",
      "Review the patch and reproduce the checks locally.",
      "Read the contribution guide and AI policy.",
      "Disclose AI assistance when required.",
      "Open the pull request yourself when you are satisfied.",
    ],
    claim_comment:
      "I’d like to work on this issue. I plan to add a focused regression test and keep the change scoped to the behavior described. Is that approach welcome?",
    commit_message: documentation
      ? "docs: explain custom retry strategies"
      : "fix: retain span attributes for async generators",
    pr_title: suggestion.issue.title,
    pr_body: `## Summary\nProposes a focused change for #${suggestion.issue.number}.\n\n## Validation\nReview the attached validation and regression logs, then reproduce locally.\n\n## AI assistance\nThis draft was prepared with AI assistance and requires human review.`,
    runtime: documentation
      ? "documentation"
      : suggestion.language === "python"
        ? "python312"
        : "node22",
    test_commands: documentation
      ? [["npm", "run", "docs:build"]]
      : [["pytest", "tests/test_async_export.py", "-q"]],
    work_type: documentation ? "documentation" : "code",
    tests_passed: true,
    regression_reproduced: documentation ? null : true,
    validation_log: documentation
      ? "[DEMO — no real commands executed]\nUTF-8, conflict markers, local Markdown links, diff whitespace: PASS\nDocumentation build: PASS"
      : "[DEMO — no real commands executed]\nSetup completed in isolated runtime.\npytest tests/test_async_export.py -q\n3 passed in 0.42s",
    regression_log: documentation
      ? "Not applicable to documentation-only contributions."
      : `[DEMO — no real commands executed]\nUnfixed checkout: test phase started\nAssertionError: SCOUT_REGRESSION:${suggestion.issue.number}\nTargeted assertion fails on unfixed code.`,
    cost_estimate: 0.18,
    attempts: 1,
    patch: documentation
      ? "diff --git a/docs/retries.md b/docs/retries.md\n--- a/docs/retries.md\n+++ b/docs/retries.md\n@@ -0,0 +1,3 @@\n+# Custom retry strategies\n+\n+Pass a backoff callback to customize retry timing.\n"
      : 'diff --git a/src/exporter.py b/src/exporter.py\n--- a/src/exporter.py\n+++ b/src/exporter.py\n@@ -1,3 +1,4 @@\n def finish_span(span, payload):\n+    payload["attributes"] = dict(span.attributes)\n     return payload\n',
    notification: {
      status: failedDelivery ? "failed" : email ? "sent" : "disabled",
      attempts: failedDelivery ? 3 : email ? 1 : 0,
      ...(failedDelivery
        ? {
            error:
              "The mail provider was temporarily unavailable. Your report and patch are saved.",
          }
        : {}),
    },
    report_text: "",
  };
  report.report_text = `[ISSUE SCOUT DEMO REPORT — SAMPLE DATA]\n${suggestion.issue.title}\n${suggestion.issue.url}\n\nRoot cause:\n${report.root_cause}\n\nApproach:\n${report.approach}\n\nRisks:\n${report.risks}\n\nNot verified:\n${report.not_verified}\n\nClaim comment:\n${report.claim_comment}\n\nMaintainer questions:\n${report.maintainer_questions.join("\n")}\n\nChecklist:\n${report.checklist.join("\n")}\n\nPR title: ${report.pr_title}\n${report.pr_body}\n\nValidation:\n${report.validation_log}\n\nRegression:\n${report.regression_log}\n\nEstimated usage: ${report.cost_estimate === null ? "n/a" : `$${report.cost_estimate.toFixed(2)}`}\n`;
  return report;
}
export function completedRun(suggestion: Suggestion): Run {
  return {
    id: "run_example",
    status: "completed",
    stage: "notify",
    started_at: "2026-10-16T15:30:00Z",
    finished_at: "2026-10-16T15:34:00Z",
    issue: suggestion.issue,
    suggestion_id: suggestion.id,
    events: runStages.map((stage, index) => ({
      at: new Date(
        Date.parse("2026-10-16T15:30:00Z") + index * 30000,
      ).toISOString(),
      stage: stage.key,
      message: stage.detail,
    })),
    report: makeReport(suggestion, false, false),
  };
}
