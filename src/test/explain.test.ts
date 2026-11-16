// @vitest-environment node
import { expect, it } from "vitest";
import { explain, type Explanation, type Source } from "../explain";
import type { Run } from "../types";

// Engine-written artifacts, read through the app's own validation (electron/artifacts.js), so the model is tested on
// the exact Run shape the renderer receives. See docs/evidence-walkthrough.md for the fixture matrix.
const modules = ["../../electron/artifacts.js", "../../electron/zip-fixture.js"];
const { artifactView } = await import(/* @vite-ignore */ modules[0]);
const { engineFiles } = await import(/* @vite-ignore */ modules[1]);
const finished = (changes: Partial<Run>): Run => ({
  id: "12", status: "completed", stage: "notify", started_at: "2026-11-08T12:00:05Z", events: [], ...changes,
});
const engine = (name: string): Run => finished(artifactView(engineFiles(name)));
const withReport = (name: string, report: Partial<NonNullable<Run["report"]>>): Run => {
  const run = engine(name);
  return { ...run, report: { ...run.report!, ...report } };
};
const supported = (run: Run) => {
  const result = explain(run);
  if (!result.supported) throw new Error(`expected a walkthrough, got: ${result.reason}`);
  return result;
};
const checks = (result: Extract<Explanation, { supported: true }>) =>
  Object.fromEntries(result.evidence.rows.map((row) => [row.id, row.availability === "available" ? row.check : row.availability]));

it("walks through a verified code fix: both checks passed, outcome word for word", () => {
  const run = engine("fix_verified");
  const result = supported(run);
  expect(result.symptom).toMatchObject({ origin: "recorded", availability: "available", title: run.issue!.title, excerpt: run.issue!.body_excerpt, url: run.issue!.url });
  expect(result.cause).toMatchObject({ origin: "proposed", availability: "available", text: run.report!.root_cause });
  expect(result.change).toMatchObject({ origin: "recorded", availability: "available", description: { origin: "proposed", text: run.report!.approach } });
  expect(checks(result)).toEqual({ tests: "passed", regression: "passed" });
  expect(result.outcome).toEqual({ origin: "recorded", source: { run: "12", fields: ["outcome", "outcome_reason"] }, outcome: "fix_verified", reason: run.outcome_reason, verified: true });
});

it("keeps a passing fact passing when the overall outcome isn't verified", () => {
  const result = supported(engine("fix_not_verified"));
  expect(checks(result)).toEqual({ tests: "passed", regression: "failed" });
  expect(result.outcome).toMatchObject({ outcome: "fix_not_verified", verified: false });
});

it("says the regression check didn't run when the tests failed", () => {
  const result = supported(engine("tests_failed"));
  expect(checks(result)).toEqual({ tests: "failed", regression: "not_run" });
  expect(result.outcome.verified).toBe(false);
});

it("treats a documentation fix's code regression as not applicable, not as failed or missing", () => {
  const result = supported(engine("docs_verified"));
  expect(checks(result)).toEqual({ tests: "passed", regression: "not_applicable", documentation: "passed" });
  expect(result.outcome.verified).toBe(true);
});

it.each([
  ["no fix", () => engine("no_fix"), "no_fix"],
  ["no pick: a valid abstention, not failed steps", () => ({ ...engine("no_pick"), status: "abstained" as const }), "no_pick"],
  ["a missing saved report", () => finished({ artifact: { status: "missing", message: "none" } }), "no_report"],
  ["an expired saved report", () => finished({ artifact: { status: "expired", message: "gone" } }), "no_report"],
  ["an unreadable saved report", () => finished({ artifact: { status: "unreadable", message: "bad" } }), "no_report"],
  ["an older engine's saved report", () => finished({ artifact: { status: "older", message: "old", report_text: "text", patch: "+x\n" } }), "no_report"],
  ["a running scout", () => finished({ status: "running" }), "not_finished"],
  ["a failed scout", () => finished({ status: "failed", error: "boom" }), "not_finished"],
  ["a stopped scout", () => finished({ status: "cancelled" }), "not_finished"],
] as const)("gives no walkthrough for %s", (_name, run, reason) => {
  expect(explain(run())).toEqual({ supported: false, reason });
});

it("shows a withheld patch as withheld, with nothing derived from the patch anywhere", () => {
  const secret = "+token = 'ghp_example_only_in_the_patch'";
  // What the backend sends for a withheld patch: no patch, and the engine's reason.
  const run = withReport("fix_not_verified", { patch: null, patch_withheld_reason: "github token matched in the output." });
  const result = supported(run);
  expect(result.change).toMatchObject({ availability: "withheld", reason: "github token matched in the output." });
  expect(result.change).not.toHaveProperty("patch");
  expect(JSON.stringify(result)).not.toContain(secret);
  // And if a patch string were ever present beside a withheld reason, the reason wins.
  const leaked = supported(withReport("fix_not_verified", { patch: `${secret}\n`, patch_withheld_reason: "github token matched in the output." }));
  expect(leaked.change.availability).toBe("withheld");
  expect(JSON.stringify(leaked)).not.toContain("ghp_example");
});

it("marks missing pieces unavailable instead of filling them in", () => {
  const result = supported(withReport("fix_verified", { patch: null, root_cause: "  ", approach: "" }));
  expect(result.change).toEqual({
    origin: "recorded", source: { run: "12", fields: ["report.patch", "report.patch_withheld_reason"] }, availability: "unavailable",
    description: { origin: "proposed", source: { run: "12", fields: ["report.approach"] }, availability: "unavailable" },
  });
  expect(result.cause).toEqual({ origin: "proposed", source: { run: "12", fields: ["report.root_cause"] }, availability: "unavailable" });
  const run = engine("fix_verified");
  const bare = supported({ ...run, issue: { ...run.issue!, body_excerpt: "" } });
  expect(bare.symptom).toMatchObject({ availability: "available", title: run.issue!.title });
  expect(bare.symptom).not.toHaveProperty("excerpt");
});

it("never presents Scout's explanation as a passed check, repeats the outcome exactly, and leaves the run untouched", () => {
  for (const name of ["fix_verified", "fix_not_verified", "tests_failed", "docs_verified"]) {
    const run = engine(name);
    const before = JSON.stringify(run);
    const result = supported(run);
    expect(result.cause.origin).toBe("proposed");
    expect(result.cause).not.toHaveProperty("check");
    expect(result.change.description.origin).toBe("proposed");
    expect([result.outcome.outcome, result.outcome.reason]).toEqual([run.outcome, run.outcome_reason]);
    expect(result.outcome.verified).toBe(run.outcome === "fix_verified");
    expect(JSON.stringify(run)).toBe(before);
  }
});

// Source references and recorded evidence.
type Walkthrough = Extract<Explanation, { supported: true }>;
const at = (run: Run, field: string): unknown => field.split(".").reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], run);
const sources = (value: unknown): Source[] =>
  !value || typeof value !== "object" ? []
    : [...("source" in value ? [value.source as Source] : []), ...Object.values(value).flatMap(sources)];
const row = (result: Walkthrough, id: string) => result.evidence.rows.find((item) => item.id === id)!;
const NONE = { availability: "unavailable" };

it("maps every item to the run and the fields it was read from", () => {
  const run = engine("fix_verified");
  const result = supported(run);
  expect(result.run).toBe("12");
  expect({
    symptom: result.symptom.source.fields, cause: result.cause.source.fields, change: result.change.source.fields,
    description: result.change.description.source.fields, evidence: result.evidence.source.fields,
    tests: row(result, "tests").source.fields, regression: row(result, "regression").source.fields, outcome: result.outcome.source.fields,
  }).toEqual({
    symptom: ["issue.title", "issue.body_excerpt", "issue.url"], cause: ["report.root_cause"], change: ["report.patch"],
    description: ["report.approach"], evidence: ["report.work_type", "report.setup_commands"],
    tests: ["report.tests_passed", "report.test_commands", "report.validation_log"],
    regression: ["report.regression_reproduced", "report.regression_log"], outcome: ["outcome", "outcome_reason"],
  });
  // Following a reference into the run gives exactly what the item shows.
  expect([result.symptom.title, result.symptom.excerpt, result.symptom.url]).toEqual(result.symptom.source.fields.map((field) => at(run, field)));
  expect(result.cause).toMatchObject({ text: at(run, "report.root_cause") });
  expect(result.change).toMatchObject({ patch: at(run, "report.patch"), description: { text: at(run, "report.approach") } });
  expect([result.outcome.outcome, result.outcome.reason]).toEqual([at(run, "outcome"), at(run, "outcome_reason")]);
});

it("repeats the recorded logs and commands exactly, and invents no regression commands", () => {
  const run = engine("fix_verified");
  const result = supported(run);
  expect(result.evidence.setup).toEqual({ availability: "available", commands: [["python", "-m", "pip", "install", "-e", "."]] });
  expect(row(result, "tests")).toMatchObject({
    log: { availability: "available", text: "Targeted tests passed" },
    commands: { availability: "available", commands: [["python", "-m", "pytest", "tests/test_validation.py"]] },
  });
  expect(row(result, "regression")).toMatchObject({ log: { availability: "available", text: "SCOUT_REGRESSION:1 assertion failed" }, commands: NONE });
  // Word for word, whitespace included, and as copies: changing the result can't change the run.
  const odd = supported(withReport("fix_verified", { validation_log: "  line 1\r\n\tline 2\n\n", test_commands: [["sh", "-c", "a  b"], []] }));
  expect(row(odd, "tests")).toMatchObject({ log: { text: "  line 1\r\n\tline 2\n\n" }, commands: { commands: [["sh", "-c", "a  b"], []] } });
  const tests = row(result, "tests");
  if (tests.commands.availability === "available") tests.commands.commands[0].push("changed");
  expect(run.report!.test_commands).toEqual([["python", "-m", "pytest", "tests/test_validation.py"]]);
});

it("keeps each check's evidence with its own row, whatever the check recorded", () => {
  const failed = supported(engine("tests_failed"));
  expect(row(failed, "tests")).toMatchObject({ check: "failed", log: { text: "FAILED tests/test_validation.py::test_nested_none" } });
  // The check didn't run; what the engine saved in its log field is repeated, not replaced or reworded.
  expect(row(failed, "regression")).toMatchObject({ check: "not_run", log: { text: engine("tests_failed").report!.regression_log }, commands: NONE });

  const docs = supported(engine("docs_verified"));
  expect(docs.evidence.setup).toEqual(NONE);
  expect(row(docs, "regression")).toMatchObject({ availability: "not_applicable", commands: NONE, source: { fields: ["report.work_type", "report.regression_log"] } });
  expect(row(docs, "regression")).not.toHaveProperty("check");
  expect(row(docs, "documentation")).toMatchObject({
    check: "passed", log: { availability: "available", text: "Targeted tests passed" }, commands: NONE,
    source: { fields: ["report.documentation_verified", "report.test_commands", "report.validation_log"] },
  });
});

it("says so when a log or command list wasn't recorded", () => {
  const result = supported(withReport("fix_verified", { validation_log: "", regression_log: " \n", test_commands: [], setup_commands: undefined }));
  expect(result.evidence.setup).toEqual(NONE);
  expect(row(result, "tests")).toMatchObject({ check: "passed", log: NONE, commands: NONE });
  expect(row(result, "regression")).toMatchObject({ check: "passed", log: NONE, commands: NONE });
  expect(JSON.stringify(result.evidence)).not.toMatch(/"text"|"commands":\[/);
});

it("is plain data with resolvable references for every supported fixture", () => {
  for (const name of ["fix_verified", "fix_not_verified", "tests_failed", "docs_verified"]) {
    const run = engine(name);
    const result = supported(run);
    expect(JSON.parse(JSON.stringify(result))).toStrictEqual(result);
    const all = sources(result);
    expect(all.length).toBe(6 + result.evidence.rows.length);
    for (const source of all) {
      expect(source.run).toBe(run.id);
      expect(source.fields.length).toBeGreaterThan(0);
      for (const field of source.fields) expect(field.split(".")[0] in run, field).toBe(true);
    }
  }
});

it("gives a withheld patch no reference to the patch field, so nothing can follow one to it", () => {
  const secret = "+token = 'ghp_example_only_in_the_patch'";
  const run = withReport("fix_not_verified", { patch: `${secret}\n`, patch_withheld_reason: "github token matched in the output." });
  const result = supported(run);
  expect(result.change.source.fields).toEqual(["report.patch_withheld_reason"]);
  const fields = sources(result).flatMap((source) => source.fields);
  expect(fields).not.toContain("report.patch");
  expect(JSON.stringify(fields.map((field) => at(run, field)))).not.toContain("ghp_example");
  expect(JSON.stringify(result)).not.toContain("ghp_example");
  // The checks and their evidence are still shown: withholding the patch doesn't hide what was validated.
  expect(row(result, "tests")).toMatchObject({ check: "passed", log: { availability: "available" } });
});
