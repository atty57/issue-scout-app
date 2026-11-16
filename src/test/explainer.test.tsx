import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, expect, it } from "vitest";
import { BugDiagram } from "../components/BugDiagram";
import { buildDiagram, reasoningFor } from "../diagram";
import ExplainerSample from "../pages/ExplainerSample";
import { SAMPLES } from "../samples/explanations";

// The sample page (stage 2 prototype). jsdom has no layout, so React Flow's canvas is not measured or drawn here;
// these tests cover what the page says, through the text list and the inspector. The canvas itself (drawing, theme,
// zoom keys, focus) is checked in a real Electron window by out/explainer/review.cjs.
beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
});
const steps = () => within(screen.getByRole("region", { name: "Steps as text" }));
const inspector = () => screen.getByRole("region", { name: "Selected step or connection" });
const open = (name: string) => userEvent.click(steps().getByRole("button", { name }));

it("says it is a hand-written sample before anything else", () => {
  render(<ExplainerSample />);
  expect(screen.getByRole("note")).toHaveTextContent("Sample explanation, written by hand. No run produced it");
  expect(screen.getByRole("note")).toHaveTextContent("Scout doesn’t draw these diagrams for your runs yet.");
});

it("switches Before, After and Changes as tabs, with the arrow keys, and lists only that view's steps", async () => {
  render(<ExplainerSample />);
  const before = screen.getByRole("tab", { name: "Before" });
  expect(before).toHaveAttribute("aria-selected", "true");
  expect(steps().getByRole("button", { name: "Crash: IndexError" })).toBeInTheDocument();
  expect(steps().queryByRole("button", { name: "Are there any results?" })).toBeNull();

  before.focus();
  await userEvent.keyboard("{ArrowRight}");
  expect(screen.getByRole("tab", { name: "After" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("tab", { name: "After" })).toHaveFocus();
  expect(steps().queryByRole("button", { name: "Crash: IndexError" })).toBeNull();
  expect(steps().getByRole("button", { name: "Are there any results?" })).toBeInTheDocument();
  expect(steps().getByText(/when: no results/)).toBeInTheDocument();
  expect(steps().getByText(/when: has results/)).toBeInTheDocument();

  await userEvent.keyboard("{ArrowRight}");
  expect(screen.getByRole("tab", { name: "Changes" })).toHaveAttribute("aria-selected", "true");
  expect(steps().getByText(/Failure · Reported in the issue · Removed by the patch/)).toBeInTheDocument();
  expect(steps().getByText(/Check · Scout’s reading · Added by the patch/)).toBeInTheDocument();
});

it("opens a step with that view's code, on that version's line, and moves focus to it", async () => {
  render(<ExplainerSample />);
  await open("Read the first result");
  expect(inspector()).toHaveFocus();
  expect(inspector()).toHaveTextContent("src/results.py, line 18, original (commit 4f2a9c1)");
  expect(inspector()).toHaveTextContent("Matched against the saved patch. Not changed by it.");
  expect(inspector()).toHaveTextContent("Scout’s reading of the code. It was not observed.");
  expect(inspector()).not.toHaveTextContent("line 20");

  await userEvent.click(screen.getByRole("tab", { name: "After" }));
  expect(inspector()).toHaveTextContent("src/results.py, line 20, after the patch");
  await userEvent.click(screen.getByRole("tab", { name: "Changes" }));
  expect(inspector()).toHaveTextContent("line 18, original (commit 4f2a9c1)");
  expect(inspector()).toHaveTextContent("line 20, after the patch");
});

it("keeps code, Scout's explanation and the recorded check apart in the inspector", async () => {
  render(<ExplainerSample />);
  await open("Crash: IndexError");
  expect(inspector()).toHaveTextContent("Reported in the issue:IndexError: list index out of range");
  expect(inspector()).toHaveTextContent("Bug reproduced on original code");
  expect(inspector()).toHaveTextContent("The new regression test failed on the code before the patch.");
  expect(inspector()).toHaveTextContent("Why Scout ties this check to this step:");
  expect(inspector()).toHaveTextContent("SCOUT_REGRESSION:41 assertion failed");
  expect(inspector()).toHaveTextContent("It doesn’t show that each step happened as drawn.");
  expect(within(inspector()).queryByLabelText("Commands")).toBeNull(); // the run records no regression commands

  await userEvent.click(screen.getByRole("tab", { name: "After" }));
  // The crash doesn't exist after the patch, so nothing stays selected.
  expect(inspector()).toHaveTextContent("Nothing selected");
  await open("Are there any results?");
  expect(inspector()).toHaveTextContent("Matched against the saved patch. Added by it.");
  expect(inspector()).toHaveTextContent("Scout’s reading of the code. It was not observed.");
  expect(inspector()).toHaveTextContent("These lines locate the step. They don’t show that it behaves as described.");
  expect(inspector()).toHaveTextContent("No recorded check is tied to this step.");

  await open("Search returns no results");
  expect(inspector()).toHaveTextContent("Checked by the engine against the patched code when the run was saved. Not shown in the patch.");
  await open("Empty-state message");
  expect(inspector()).toHaveTextContent("Tests passed");
  expect(within(inspector()).getByLabelText("Commands")).toHaveTextContent("python -m pytest tests/test_results.py");
});

it("opens a connection as Scout's reading, never as an observed path", async () => {
  render(<ExplainerSample />);
  const item = steps().getByRole("button", { name: "Search returns no results" }).closest("li")!;
  await userEvent.click(within(item).getByRole("button", { name: "Connection to Read the first result" }));
  expect(inspector()).toHaveTextContent("Search returns no results → Read the first result");
  expect(inspector()).toHaveTextContent("Scout’s reading of the code. No run records the path the code took.");
  expect(inspector()).toHaveTextContent("Nothing stops an empty list from reaching the index.");
});

it("answers the five questions with their sources, and shows the documentation sample without a runtime path", async () => {
  render(<ExplainerSample />);
  const reasoning = () => screen.getByRole("region", { name: "Reasoning behind the fix" });
  for (const question of ["What behaviour was intended?", "What caused the reported failure?", "Why was this location changed?", "How does the change address it?", "What was tested, and what remains uncertain?"])
    expect(within(reasoning()).getByText(question)).toBeInTheDocument();
  expect(reasoning()).toHaveTextContent("An empty search should show a message that there are no results.Scout’s explanation");
  expect(reasoning()).toHaveTextContent("Tests passedRecorded by the run");
  expect(reasoning()).toHaveTextContent("Callers that pass something other than a list.Scout’s report");

  await userEvent.click(screen.getByRole("button", { name: "Documentation gives the wrong unit" }));
  expect(screen.getByRole("heading", { name: "README says --timeout is in seconds" })).toBeInTheDocument();
  expect(reasoning()).toHaveTextContent("No reproduction for a documentation fix");
  expect(reasoning()).toHaveTextContent("Documentation checks passed");
  expect(steps().getAllByText(/^Statement · /)).toHaveLength(3);
});

it("says what a run didn't record, and renders saved text as text", () => {
  const [sample] = SAMPLES;
  const explanation = structuredClone(sample.explanation) as { nodes: { label: string }[]; reasoning?: unknown };
  explanation.nodes[0].label = "<img src=x onerror=alert(1)>";
  delete explanation.reasoning;
  const built = buildDiagram(explanation, { patch: sample.patch, withheld: false, issue: sample.issue });
  if (!built.ok) throw new Error(built.reason);
  const run = { ...sample.run, report: { ...sample.run.report!, root_cause: "", approach: "" } };
  const { container } = render(<BugDiagram diagram={built.diagram} reasoning={reasoningFor(run, built.diagram)!} />);
  expect(container.querySelector("img")).toBeNull();
  expect(steps().getByRole("button", { name: "<img src=x onerror=alert(1)>" })).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Reasoning behind the fix" })).getAllByText("This run didn’t record this.")).toHaveLength(4);
});

// Review findings, 2026-11-15.
const [search, docs, large] = SAMPLES;
const show = (sample: (typeof SAMPLES)[number], report: Partial<NonNullable<(typeof search)["run"]["report"]>> = {}) => {
  const built = buildDiagram(sample.explanation, { patch: sample.patch, withheld: false, issue: sample.issue });
  if (!built.ok) throw new Error(built.reason);
  const run = { ...sample.run, report: { ...sample.run.report!, ...report } };
  return render(<BugDiagram diagram={built.diagram} reasoning={reasoningFor(run, built.diagram)!} />);
};

it("opens an already selected item again and returns focus to what opened it (text list)", async () => {
  render(<ExplainerSample />);
  const step = steps().getByRole("button", { name: "Read the first result" });
  await userEvent.click(step);
  expect(inspector()).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  expect(step).toHaveFocus();
  // Same item, already selected: Enter, then Space, then the pointer each open it again.
  await userEvent.keyboard("{Enter}");
  expect(inspector()).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  expect(step).toHaveFocus();
  await userEvent.keyboard(" ");
  expect(inspector()).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  await userEvent.click(step);
  expect(inspector()).toHaveFocus();

  const connection = steps().getByRole("button", { name: "Connection to Crash: IndexError" });
  await userEvent.click(connection);
  expect(inspector()).toHaveFocus();
  expect(inspector()).toHaveTextContent("Read the first result → Crash: IndexError");
  await userEvent.keyboard("{Escape}");
  expect(connection).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  expect(inspector()).toHaveFocus();
});

it("opens a step on the canvas with Enter, Space and the pointer, every time, and Escape returns to it", () => {
  const { container } = render(<ExplainerSample />);
  const step = container.querySelector<HTMLElement>('.react-flow__node[data-id="first"]')!;
  expect(step).not.toBeNull();
  const presses = [
    () => fireEvent.keyDown(step, { key: "Enter" }), () => fireEvent.keyDown(step, { key: "Enter" }),
    () => fireEvent.keyDown(step, { key: " " }), () => fireEvent.click(step), () => fireEvent.click(step),
  ];
  for (const press of presses) {
    step.focus();
    press();
    expect(inspector()).toHaveFocus();
    expect(inspector()).toHaveTextContent("Read the first result");
    fireEvent.keyDown(inspector(), { key: "Escape" });
    expect(step).toHaveFocus();
  }
  // Ctrl + Enter is not the diagram's: nothing opens.
  fireEvent.keyDown(step, { key: "Enter", ctrlKey: true });
  expect(step).toHaveFocus();
});

it("offers one Fit control beside the zoom buttons", () => {
  render(<ExplainerSample />);
  expect(screen.getByRole("button", { name: "Fit view" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /zoom in/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /zoom out/i })).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: /fit/i })).toHaveLength(1);
});

it.each<[string, Parameters<typeof show>[1], string[], string[]]>([
  ["the bug was reproduced", {}, ["Bug reproduced on original code", "Tests passed"], []],
  ["the bug was not reproduced", { regression_reproduced: false }, ["Bug not reproduced on original code", "Tests passed"], ["Bug reproduced"]],
  ["the tests failed, so no reproduction was attempted", { tests_passed: false, regression_reproduced: null }, ["Reproduction on original code was not attempted", "Tests failed"], ["Bug reproduced", "Bug not reproduced"]],
])("words the recorded checks plainly when %s", (_name, report, present, absent) => {
  const { container } = show(search, report);
  const reasoning = screen.getByRole("region", { name: "Reasoning behind the fix" });
  for (const text of present) expect(reasoning).toHaveTextContent(text);
  for (const text of absent) expect(reasoning).not.toHaveTextContent(text);
  expect(container).not.toHaveTextContent(/Regression on unfixed code|: passed|: failed|not_run|not_applicable/);
});

it("explains what a reproduction result means beside its step, and says a documentation fix has none", async () => {
  show(search, { regression_reproduced: false });
  await open("Crash: IndexError");
  expect(inspector()).toHaveTextContent("Bug not reproduced on original code");
  expect(inspector()).toHaveTextContent("The new regression test did not fail on the code before the patch");
  expect(within(inspector()).getByLabelText("Reproduction on original code: log")).toBeInTheDocument();
  cleanup();
  show(docs);
  expect(screen.getByRole("region", { name: "Reasoning behind the fix" })).toHaveTextContent("No reproduction for a documentation fix");
  expect(screen.getByRole("region", { name: "Reasoning behind the fix" })).toHaveTextContent("Documentation checks passed");
});

it("shows the large sample whole: twelve steps, long labels in full, branches and check badges in words", async () => {
  show(large);
  await userEvent.click(screen.getByRole("tab", { name: "Changes" }));
  expect(steps().getAllByRole("listitem")).toHaveLength(12);
  expect(steps().getByRole("button", { name: "Does the number of fields on the line match the number of header columns?" })).toBeInTheDocument();
  expect(steps().getByText(/when: a column is missing/)).toBeInTheDocument();
  expect(steps().getByText(/when: all columns present/)).toBeInTheDocument();
  await open("Reject the whole file and report the row with the wrong field count");
  expect(inspector()).toHaveTextContent("Bug reproduced on original code");
  await open("Count the blank line as skipped and move on to the next line");
  expect(inspector()).toHaveTextContent("Tests passed");
});
