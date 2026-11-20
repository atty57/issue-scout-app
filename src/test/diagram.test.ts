// @vitest-environment node
import { expect, it } from "vitest";
import { buildDiagram, layout, reasoningFor, view, LIMITS, type Diagram, type ViewName } from "../diagram";
import { SAMPLES, type Sample } from "../samples/explanations";
import type { Run } from "../types";

// The samples are written by hand (src/samples/explanations.ts); no run produced them. Each refused case below is a
// sample with one thing changed. See docs/evidence-walkthrough.md, Part 1.
const [search, docs] = SAMPLES;
type Raw = { nodes: any[]; edges: any[]; evidence: any[]; reasoning: any; [key: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const attempt = (sample: Sample, change: (raw: Raw) => void = () => {}, context: Partial<Parameters<typeof buildDiagram>[1]> = {}) => {
  const raw = structuredClone(sample.explanation) as Raw;
  change(raw);
  return buildDiagram(raw, { patch: sample.patch, withheld: false, issue: sample.issue, ...context });
};
const built = (...args: Parameters<typeof attempt>): Diagram => {
  const result = attempt(...args);
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.diagram;
};
const node = (diagram: Diagram, id: string) => diagram.nodes.find((item) => item.id === id)!;
const raw = (data: Raw, id: string) => data.nodes.find((item) => item.id === id);
const ids = (items: { node?: { id: string }; edge?: { id: string } }[]) => items.map((item) => (item.node ?? item.edge)!.id);

it("builds both samples, keeps them marked as samples, and changes nothing it was given", () => {
  for (const sample of SAMPLES) {
    const before = JSON.stringify(sample.explanation);
    const diagram = built(sample);
    expect(diagram.sample).toBe(true);
    expect(JSON.parse(JSON.stringify(diagram))).toStrictEqual(diagram);
    expect(JSON.stringify(sample.explanation)).toBe(before);
  }
  expect(built(search, (data) => delete data.sample).sample).toBe(false);
});

it("gives a step in both versions its own reference for each, on the right lines", () => {
  const first = node(built(search), "first");
  expect(first.code.original).toEqual({ path: "src/results.py", start_line: 18, end_line: 18, quote: "    top = results[0]", check: "patch", changed: false });
  expect(first.code.patched).toMatchObject({ start_line: 20, end_line: 20, check: "patch", changed: false });
  // The same words on the original's line number are wrong for the patched file, and the patch shows it.
  expect(attempt(search, (data) => (raw(data, "first").code.patched.start_line = raw(data, "first").code.patched.end_line = 18))).toEqual({
    ok: false, reason: 'Step "first"\'s patched code doesn\'t match the saved patch.',
  });
});

it("keeps code, behaviour and evidence apart: added lines don't make the explanation a fact", () => {
  const diagram = built(search);
  const guard = node(diagram, "guard");
  expect(guard.code.patched).toMatchObject({ check: "patch", changed: true });
  expect(guard.basis).toBe("inferred");
  expect(diagram.edges.every((edge) => edge.basis === "inferred")).toBe(true);
  expect(diagram.evidence).toEqual([
    { check: "regression", target: "crash", note: expect.any(String), attribution: "inferred" },
    { check: "tests", target: "empty", note: expect.any(String), attribution: "inferred" },
  ]);
  expect(attempt(search, (data) => (raw(data, "guard").basis = "recorded"))).toMatchObject({ ok: false, reason: expect.stringContaining("basis") });
  expect(attempt(search, (data) => (data.edges[0].basis = "recorded"))).toMatchObject({ ok: false, reason: expect.stringContaining("no run records the path") });
});

it("accepts references the patch doesn't show as engine-checked, and refuses only what the patch contradicts", () => {
  // A file the patch doesn't touch.
  expect(node(built(search), "none").code.original).toMatchObject({ path: "src/search.py", check: "engine", changed: false });
  // A touched file, outside the diff's context lines.
  const far = built(search, (data) => (raw(data, "shown").code.original = { path: "src/results.py", start_line: 60, end_line: 61, quote: "def other():\n    pass" }));
  expect(node(far, "shown").code.original).toMatchObject({ check: "engine", changed: false });
  // Partly shown: lines 19-20 are in the patch, 21 isn't. The shown ones must still match.
  const partly = { path: "src/results.py", start_line: 19, end_line: 21, quote: "    return format_result(top)\n\ndef other():" };
  expect(node(built(search, (data) => (raw(data, "shown").code.original = partly)), "shown").code.original).toMatchObject({ check: "engine" });
  expect(attempt(search, (data) => (raw(data, "shown").code.original = { ...partly, quote: "    return top\n\ndef other():" }))).toMatchObject({ ok: false, reason: expect.stringContaining("doesn't match the saved patch") });
  // No usable patch: nothing can be compared, so nothing is called patch-checked.
  for (const patch of [null, "not a diff\n"]) {
    const blind = built(search, undefined, { patch });
    expect(blind.nodes.flatMap((item) => Object.values(item.code)).map((ref) => ref.check)).toEqual(Array(7).fill("engine"));
  }
  // CRLF content matches a quote without the carriage return.
  const crlf = "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1,2 @@\n one\r\n-two\r\n+TWO\r\n";
  const windows = built(search, (data) => (raw(data, "guard").code.patched = { path: "a.txt", start_line: 2, end_line: 2, quote: "TWO" }), { patch: crlf });
  expect(node(windows, "guard").code.patched).toMatchObject({ check: "patch", changed: true });
});

it("shows each view only what exists in it, with that version's code", () => {
  const diagram = built(search);
  const before = view(diagram, "before"), after = view(diagram, "after"), changes = view(diagram, "changes");
  expect(ids(before.nodes)).toEqual(["query", "none", "first", "crash", "shown"]);
  expect(ids(before.edges)).toEqual(["e1", "e2", "e3", "e7"]);
  expect(ids(after.nodes)).toEqual(["query", "none", "guard", "first", "empty", "shown"]);
  expect(ids(after.edges)).toEqual(["e1", "e4", "e5", "e6", "e7"]);
  const first = (name: ViewName) => view(diagram, name).nodes.find((item) => item.node.id === "first")!.code.map((ref) => [ref.revision, ref.start_line]);
  expect([first("before"), first("after"), first("changes")]).toEqual([[["original", 18]], [["patched", 20]], [["original", 18], ["patched", 20]]]);
  expect(before.nodes.every((item) => item.change === "same")).toBe(true);
  expect(Object.fromEntries(changes.nodes.map((item) => [item.node.id, item.change]))).toMatchObject({ guard: "added", empty: "added", crash: "removed", first: "same" });
  expect(Object.fromEntries(changes.edges.map((item) => [item.edge.id, item.change]))).toEqual({ e1: "same", e2: "removed", e3: "removed", e4: "added", e5: "added", e6: "added", e7: "same" });
  expect(before.nodes.find((item) => item.node.id === "crash")!.evidence).toMatchObject([{ check: "regression" }]);
  // Branching: the guard leads two ways.
  expect(after.edges.filter((item) => item.edge.from === "guard").map((item) => [item.edge.to, item.edge.label])).toEqual([["empty", "no results"], ["first", "has results"]]);
});

it("never draws a connection to a step its view doesn't show", () => {
  for (const sample of SAMPLES)
    for (const name of ["before", "after", "changes"] as const) {
      const { nodes, edges } = view(built(sample), name);
      const visible = new Set(ids(nodes));
      for (const { edge } of edges) expect([visible.has(edge.from), visible.has(edge.to)], `${name} ${edge.id}`).toEqual([true, true]);
    }
  // A connection in both versions can't end at a step that exists only before; nor an after one at a before step.
  expect(attempt(search, (data) => (data.edges[2].presence = "both"))).toEqual({ ok: false, reason: 'Connection "e3" would be drawn in a view that doesn\'t show step "crash".' });
  expect(attempt(search, (data) => (data.edges[4].to = "crash"))).toMatchObject({ ok: false, reason: expect.stringContaining('doesn\'t show step "crash"') });
});

it("builds a documentation fix from statements, with no runtime path", () => {
  const diagram = built(docs);
  expect(diagram.kind).toBe("documentation");
  expect(diagram.nodes.every((item) => item.kind === "statement")).toBe(true);
  expect(node(diagram, "old").code.original).toMatchObject({ check: "patch", changed: true });
  expect(node(diagram, "new").code.patched).toMatchObject({ check: "patch", changed: true });
  expect(node(diagram, "code").code.original).toMatchObject({ check: "engine" });
  expect(ids(view(diagram, "before").nodes)).toEqual(["report", "code", "old"]);
  expect(ids(view(diagram, "after").nodes)).toEqual(["report", "code", "new"]);
  expect(attempt(docs, (data) => (data.evidence[0].check = "regression"))).toMatchObject({ ok: false });
  expect(attempt(docs, (data) => (data.nodes[0].kind = "step"))).toMatchObject({ ok: false });
  expect(attempt(search, (data) => (data.nodes[0].kind = "statement"))).toMatchObject({ ok: false });
});

it.each<[string, (data: Raw) => void, RegExp]>([
  ["a quote the saved patch contradicts", (data) => (raw(data, "first").code.original.quote = "    top = results[1]"), /doesn't match the saved patch/],
  ["a quote with the wrong number of lines", (data) => (raw(data, "guard").code.patched.end_line = 20), /different number of lines/],
  ["line numbers that aren't usable", (data) => (raw(data, "guard").code.patched.start_line = 0), /unusable line numbers/],
  ["patched code on a step that exists only before", (data) => (raw(data, "crash").code = { patched: { path: "a", start_line: 1, end_line: 1, quote: "x" } }), /only before/],
  ["original code on a step that exists only after", (data) => (raw(data, "guard").code.original = { path: "a", start_line: 1, end_line: 1, quote: "x" }), /only after/],
  ["a reported step whose words aren't in the issue", (data) => (raw(data, "crash").issue_quote = "TypeError: boom"), /aren't in the saved issue text/],
  ["a reported step with no quote", (data) => delete raw(data, "crash").issue_quote, /quote from the issue/],
  ["a connection to a step that doesn't exist", (data) => (data.edges[0].to = "nowhere"), /doesn't exist/],
  ["a connection from a step to itself", (data) => (data.edges[0].to = "query"), /to itself/],
  ["a loop", (data) => data.edges.push({ id: "back", from: "shown", to: "query", presence: "both" }), /form a loop/],
  ["a repeated id", (data) => (data.edges[0].id = "query"), /repeats the id/],
  ["an evidence link to nothing", (data) => (data.evidence[0].target = "gone"), /points at nothing/],
  ["too many steps", (data) => {
    for (let n = 0; n < LIMITS.nodes; n++) data.nodes.push({ id: `extra${n}`, label: "x", kind: "step", presence: "both", basis: "inferred", explanation: "" });
  }, /number more than 12/],
  ["an overlong explanation", (data) => (data.nodes[1].explanation = "x".repeat(LIMITS.text + 1)), /too long/],
  ["no commit for the original code", (data) => (data.base_commit = "4f2a9c1"), /names no commit/],
  ["an unknown kind", (data) => (data.kind = "sequence"), /kind/],
  ["no steps", (data) => {
    data.nodes = []; data.edges = []; data.evidence = [];
  }, /no steps/],
])("refuses the whole explanation for %s", (_name, change, reason) => {
  const result = attempt(search, change);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toMatch(reason);
});

it("refuses a reference to a version of a file that doesn't exist", () => {
  const added = "diff --git a/new.py b/new.py\nnew file mode 100644\nindex 0000000..3b18e51\n--- /dev/null\n+++ b/new.py\n@@ -0,0 +1 @@\n+x = 1\n";
  const removed = "diff --git a/old.py b/old.py\ndeleted file mode 100644\nindex 3b18e51..0000000\n--- a/old.py\n+++ /dev/null\n@@ -1 +0,0 @@\n-x = 1\n";
  const point = (side: "original" | "patched", path: string) => (data: Raw) => (raw(data, "none").code = { [side]: { path, start_line: 1, end_line: 1, quote: "x = 1" } });
  expect(attempt(search, point("original", "new.py"), { patch: added })).toEqual({ ok: false, reason: 'Step "none"\'s original code points at a version of the file that doesn\'t exist.' });
  expect(attempt(search, point("patched", "old.py"), { patch: removed })).toMatchObject({ ok: false, reason: expect.stringContaining("doesn't exist") });
  expect(node(built(search, point("patched", "new.py"), { patch: added }), "none").code.patched).toMatchObject({ check: "patch", changed: true });
  expect(node(built(search, point("original", "old.py"), { patch: removed }), "none").code.original).toMatchObject({ check: "patch", changed: true });
});

it.each([null, "text", [], 7, { kind: "behaviour" }])("refuses %j without throwing", (input) => {
  expect(buildDiagram(input, { patch: null, withheld: false, issue: search.issue })).toMatchObject({ ok: false });
});

it("shows no diagram for a withheld patch, whatever was saved, and says nothing from it", () => {
  const result = attempt(search, undefined, { withheld: true });
  expect(result).toEqual({ ok: false, reason: "The patch was withheld for safety, so no diagram is shown." });
  expect(JSON.stringify(result)).not.toMatch(/EMPTY_STATE|results\.py/);
});

// The reasoning panel, on the engine's own fixtures through the app's own reader (as in explain.test.ts).
const modules = ["../../electron/artifacts.js", "../../electron/zip-fixture.js"];
const { artifactView } = await import(/* @vite-ignore */ modules[0]);
const { engineFiles } = await import(/* @vite-ignore */ modules[1]);
const engine = (name: string, report: Partial<NonNullable<Run["report"]>> = {}): Run => {
  const run: Run = { id: "12", status: "completed", stage: "notify", started_at: "2026-11-08T12:00:05Z", events: [], ...artifactView(engineFiles(name)) };
  return run.report ? { ...run, report: { ...run.report, ...report } } : run;
};

it("answers only what today's runs recorded, and says where each answer was saved", () => {
  const run = engine("fix_verified", { root_cause: "The index is read first.", approach: "Check first.", not_verified: "Other callers.", risks: "" });
  expect(reasoningFor(run)).toEqual({
    intended: [],
    cause: [{ origin: "proposed", from: "report.root_cause", text: "The index is read first." }],
    location: [],
    effect: [{ origin: "proposed", from: "report.approach", text: "Check first." }],
    tested: expect.objectContaining({ origin: "recorded", rows: expect.arrayContaining([expect.objectContaining({ id: "tests", check: "passed" })]) }),
    uncertain: [{ origin: "proposed", from: "report.not_verified", text: "Other callers." }],
  });
});

it("prefers the explanation's own reasoning when a run has one, and still lists the report's doubts", () => {
  const run = engine("fix_not_verified", { not_verified: "Other callers.", risks: "May hide a real bug." });
  const answers = reasoningFor(run, built(search))!;
  expect(answers.intended).toEqual([{ origin: "proposed", from: "explanation.reasoning.intended", text: "An empty search should show a message that there are no results." }]);
  expect(answers.cause.map((answer) => answer.from)).toEqual(["explanation.reasoning.cause"]);
  expect(answers.location.map((answer) => answer.from)).toEqual(["explanation.reasoning.location"]);
  expect(answers.uncertain.map((answer) => answer.from)).toEqual(["explanation.reasoning.uncertain", "report.not_verified", "report.risks"]);
  // Scout's words never become a check: the recorded evidence is passed through untouched.
  expect(answers.tested.rows.map((row) => [row.id, row.availability === "available" && row.check])).toEqual([["tests", "passed"], ["regression", "failed"]]);
  // An explanation with empty reasoning falls back to the report, not to filler.
  const empty = reasoningFor(run, built(search, (data) => delete data.reasoning))!;
  expect([empty.intended, empty.cause.map((answer) => answer.from)]).toEqual([[], ["report.root_cause"]]);
});

// Layout: where steps and connections go, worked out once for all three views.
it("gives every step and every skipping connection a place of its own", () => {
  for (const sample of SAMPLES) {
    const diagram = built(sample), { steps, routes, columns } = layout(diagram);
    const taken = [...steps.values(), ...[...routes.values()].flat()].map((slot) => `${slot.column}:${slot.row}`);
    expect(new Set(taken).size, sample.name).toBe(taken.length);
    expect(steps.size).toBe(diagram.nodes.length);
    for (const edge of diagram.edges) {
      const from = steps.get(edge.from)!.column, to = steps.get(edge.to)!.column;
      expect(to, edge.id).toBeGreaterThan(from); // always downwards
      // One place in each layer the connection skips, and none when it joins neighbouring layers.
      expect(routes.get(edge.id)!.map((slot) => slot.column), edge.id).toEqual(Array.from({ length: to - from - 1 }, (_, at) => from + 1 + at));
    }
    expect(Math.max(...[...steps.values()].map((slot) => slot.column)) + 1).toBe(columns);
  }
});

it("routes the removed connection beside the added guard, not through it", () => {
  const { steps, routes } = layout(built(search));
  const guard = steps.get("guard")!, [around] = routes.get("e2")!; // e2: "Search returns no results" to "Read the first result", before only
  expect(around.column).toBe(guard.column);
  expect(around.row).not.toBe(guard.row);
  expect(routes.get("e2")).toHaveLength(1);
  expect(routes.get("e6")).toEqual([]); // the guard's own connections join neighbouring layers
});

it("lays out the large sample at the step limit with branches side by side", () => {
  const diagram = built(SAMPLES[2]);
  expect(diagram.nodes).toHaveLength(LIMITS.nodes);
  expect(diagram.sample).toBe(true);
  expect(Math.max(...diagram.nodes.map((step) => step.label.length))).toBeGreaterThan(65);
  const { steps, routes, columns } = layout(diagram);
  expect(columns).toBe(9);
  expect([steps.get("badheader")!.column, steps.get("loop")!.column]).toEqual([3, 3]);
  expect(steps.get("badheader")!.row).not.toBe(steps.get("loop")!.row);
  expect(routes.get("c5")).toHaveLength(1); // before only: skips the layer of the added blank-line check
  expect(routes.get("c12")).toHaveLength(1);
  // Three views of one layout: what each view shows is a subset of the same places.
  for (const name of ["before", "after", "changes"] as const)
    for (const { node } of view(diagram, name).nodes) expect(steps.has(node.id)).toBe(true);
});

it("gives the reasoning for a withheld patch, and none for runs without a report", () => {
  const withheld = engine("fix_not_verified", { patch: null, patch_withheld_reason: "github token matched in the output." });
  expect(reasoningFor(withheld)).toMatchObject({ cause: [{ from: "report.root_cause" }] });
  expect(reasoningFor(engine("no_fix"))).toBeNull();
  expect(reasoningFor(engine("no_pick"))).toBeNull();
});
