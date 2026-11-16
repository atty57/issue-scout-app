import type { Run, RunIssue, RunOutcome, RunReport } from "./types";

// The evidence walkthrough's model (docs/evidence-walkthrough.md): what a finished run recorded, in a fixed order,
// with each piece's origin, availability and check kept apart. The one rule: no claim may exceed the evidence for
// that particular claim. It reads the validated Run the page already has and never decides or changes an outcome.
// The result is plain data (JSON round-trips unchanged), so a page or an exporter can both use it.

/** A saved fact, or Scout's own explanation (model-written, never shown as proven). */
export type Origin = "recorded" | "proposed";
export type Check = "passed" | "failed" | "not_run";
/** A field of the Run this was read from, as a path: `run.report.root_cause` is "report.root_cause". */
export type SourceField = `issue.${keyof RunIssue & string}` | `report.${keyof RunReport & string}` | "outcome" | "outcome_reason";
/** Where an item came from: the run, and every field read to build it (including ones that turned out empty). */
export type Source = { run: string; fields: SourceField[] };
type Text = { origin: "proposed"; source: Source } & ({ availability: "available"; text: string } | { availability: "unavailable" });
/** A recorded log, word for word. Unavailable: the run recorded no text there. */
export type Log = { availability: "available"; text: string } | { availability: "unavailable" };
/** Recorded commands as the argument lists the engine ran. Unavailable: none were recorded for this. */
export type Commands = { availability: "available"; commands: string[][] } | { availability: "unavailable" };
export type EvidenceRow = { id: "tests" | "regression" | "documentation"; origin: "recorded"; source: Source; log: Log; commands: Commands } & (
  | { availability: "available"; check: Check }
  | { availability: "not_applicable" }
);
export type Explanation =
  | { supported: false; reason: "not_finished" | "no_pick" | "no_fix" | "no_report" }
  | {
      supported: true;
      run: string;
      /** The saved excerpt of the issue, not the whole or current issue on GitHub. */
      symptom: { origin: "recorded"; source: Source; availability: "available"; title: string; excerpt?: string; url: string };
      cause: Text;
      change: { origin: "recorded"; source: Source; description: Text } & (
        | { availability: "available"; patch: string }
        | { availability: "withheld"; reason: string }
        | { availability: "unavailable" }
      );
      /** `setup` prepared the environment for every check; each row carries its own log and commands. */
      evidence: { origin: "recorded"; source: Source; setup: Commands; rows: EvidenceRow[] };
      outcome: { origin: "recorded"; source: Source; outcome: RunOutcome; reason?: string; verified: boolean };
    };

const check = (passed: boolean): Check => (passed ? "passed" : "failed");
const log = (text: string | undefined): Log => (text?.trim() ? { availability: "available", text } : { availability: "unavailable" });
const commands = (list: string[][] | undefined): Commands =>
  list?.length ? { availability: "available", commands: list.map((command) => [...command]) } : { availability: "unavailable" };

export function explain(run: Run): Explanation {
  if (run.outcome === "no_pick") return { supported: false, reason: "no_pick" };
  if (run.outcome === "no_fix") return { supported: false, reason: "no_fix" };
  if (run.status !== "completed") return { supported: false, reason: "not_finished" };
  const { report, issue, outcome } = run;
  if (!report || !issue || !outcome) return { supported: false, reason: "no_report" };

  const from = (...fields: SourceField[]): Source => ({ run: run.id, fields });
  const proposed = (text: string, field: SourceField): Text =>
    text.trim() ? { origin: "proposed", source: from(field), availability: "available", text } : { origin: "proposed", source: from(field), availability: "unavailable" };

  const documentation = report.work_type === "documentation";
  const validation = () => ({ log: log(report.validation_log), commands: commands(report.test_commands) });
  // The artifact records no commands for the regression run, so none are shown for it.
  const regression = () => ({ log: log(report.regression_log), commands: { availability: "unavailable" } as const });
  const rows: EvidenceRow[] = [
    { id: "tests", origin: "recorded", source: from("report.tests_passed", "report.test_commands", "report.validation_log"),
      ...validation(), availability: "available", check: check(report.tests_passed) },
    documentation
      ? { id: "regression", origin: "recorded", source: from("report.work_type", "report.regression_log"), ...regression(), availability: "not_applicable" }
      : { id: "regression", origin: "recorded", source: from("report.regression_reproduced", "report.regression_log"), ...regression(),
          availability: "available", check: report.regression_reproduced === null ? "not_run" : check(report.regression_reproduced) },
  ];
  // A documentation fix's checks are the validation run itself, so this row shares its log and commands.
  if (documentation)
    rows.push({ id: "documentation", origin: "recorded", source: from("report.documentation_verified", "report.test_commands", "report.validation_log"),
      ...validation(), availability: "available", check: check(report.documentation_verified === true) });

  const description = proposed(report.approach, "report.approach");
  return {
    supported: true,
    run: run.id,
    symptom: {
      origin: "recorded", source: from("issue.title", "issue.body_excerpt", "issue.url"), availability: "available", title: issue.title, url: issue.url,
      ...(issue.body_excerpt?.trim() ? { excerpt: issue.body_excerpt } : {}),
    },
    cause: proposed(report.root_cause, "report.root_cause"),
    // A withheld reason wins over any patch text: nothing from a withheld patch may reach the page, and its source
    // doesn't point at the patch field either.
    change: report.patch_withheld_reason
      ? { origin: "recorded", source: from("report.patch_withheld_reason"), description, availability: "withheld", reason: report.patch_withheld_reason }
      : report.patch
        ? { origin: "recorded", source: from("report.patch"), description, availability: "available", patch: report.patch }
        : { origin: "recorded", source: from("report.patch", "report.patch_withheld_reason"), description, availability: "unavailable" },
    evidence: { origin: "recorded", source: from("report.work_type", "report.setup_commands"), setup: commands(report.setup_commands), rows },
    outcome: {
      origin: "recorded", source: from("outcome", "outcome_reason"), outcome, verified: outcome === "fix_verified",
      ...(run.outcome_reason ? { reason: run.outcome_reason } : {}),
    },
  };
}
