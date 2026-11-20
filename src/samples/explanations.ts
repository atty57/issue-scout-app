// Sample explanations for the visual prototype and the diagram model's tests (docs/evidence-walkthrough.md).
// WRITTEN BY HAND. No run produced them: the repositories, files, commits and issues here don't exist. Each is
// marked `sample: true`, and anything that shows one must say so on screen. Never attach one to a real run.

import type { Run, RunReport } from "../types";

export type Sample = {
  name: string;
  issue: { title: string; body_excerpt: string };
  patch: string;
  /** Deliberately untyped: this is what an engine would save, and the app must check it like any saved file. */
  explanation: unknown;
  /** A hand-written run holding the same issue and patch, so the sample goes through the same code as a real one. */
  run: Run;
};
type Draft = Omit<Sample, "run">;
type Recorded = Pick<RunReport, "work_type" | "root_cause" | "approach" | "not_verified" | "setup_commands" | "test_commands"
  | "regression_reproduced" | "documentation_verified" | "validation_log" | "regression_log">;

const lines = (...text: string[]) => text.join("\n") + "\n";
const withRun = (draft: Draft, number: number, outcome_reason: string, report: Recorded): Sample => ({
  ...draft,
  run: {
    id: `sample-${number}`, status: "completed", stage: "notify", started_at: "2026-01-01T00:00:00Z", events: [],
    outcome: "fix_verified", outcome_reason, artifact: { status: "available", message: "" },
    issue: { url: `https://example.com/sample/project/issues/${number}`, repo: "sample/project", number, ...draft.issue },
    report: {
      risks: "", maintainer_questions: [], checklist: [], claim_comment: "", commit_message: "", pr_title: "", pr_body: "",
      runtime: "python312", tests_passed: true, cost_estimate: null, attempts: null, patch: draft.patch, report_text: "",
      notification: { status: "disabled", attempts: 0 }, ...report,
    },
  },
});

const emptySearch: Draft = {
  name: "Empty search crashes",
  issue: {
    title: "Searching with an empty query crashes the results page",
    body_excerpt: "Searching with an empty query shows a traceback instead of a page.\n\nIndexError: list index out of range\n\nExpected: a message saying there are no results.",
  },
  patch: lines(
    "diff --git a/src/results.py b/src/results.py",
    "index 3f1c2aa..9b7d4e1 100644",
    "--- a/src/results.py",
    "+++ b/src/results.py",
    "@@ -15,6 +15,8 @@ def render(results):",
    " ",
    " ",
    " def first_result(results):",
    "+    if not results:",
    "+        return EMPTY_STATE",
    "     top = results[0]",
    "     return format_result(top)",
    " ",
    "diff --git a/tests/test_results.py b/tests/test_results.py",
    "index 77aa0c1..c2e19d0 100644",
    "--- a/tests/test_results.py",
    "+++ b/tests/test_results.py",
    "@@ -8,3 +8,7 @@ def test_first_result_formats_top():",
    " ",
    " def test_first_result_uses_first():",
    '     assert first_result(["a", "b"]) == "a"',
    "+",
    "+",
    "+def test_empty_search_shows_empty_state():",
    '+    assert first_result([]) == EMPTY_STATE, "SCOUT_REGRESSION:41 assertion failed"',
  ),
  explanation: {
    sample: true,
    kind: "behaviour",
    base_commit: "4f2a9c1e8b7d6a5f4e3d2c1b0a9f8e7d6c5b4a39",
    nodes: [
      { id: "query", label: "Search with an empty query", kind: "input", presence: "both", basis: "reported",
        issue_quote: "Searching with an empty query", explanation: "The reporter searched without typing anything." },
      { id: "none", label: "Search returns no results", kind: "step", presence: "both", basis: "inferred",
        explanation: "An empty query matches nothing, so search() returns an empty list.",
        code: {
          original: { path: "src/search.py", start_line: 42, end_line: 42, quote: "        return []" },
          patched: { path: "src/search.py", start_line: 42, end_line: 42, quote: "        return []" },
        } },
      { id: "guard", label: "Are there any results?", kind: "check", presence: "after", basis: "inferred",
        explanation: "The patch checks for an empty list before anything reads from it, in the one function that indexes into the results.",
        code: { patched: { path: "src/results.py", start_line: 18, end_line: 19, quote: "    if not results:\n        return EMPTY_STATE" } } },
      { id: "first", label: "Read the first result", kind: "step", presence: "both", basis: "inferred",
        explanation: "Assumes the list is never empty. With an empty list, results[0] raises IndexError.",
        code: {
          original: { path: "src/results.py", start_line: 18, end_line: 18, quote: "    top = results[0]" },
          patched: { path: "src/results.py", start_line: 20, end_line: 20, quote: "    top = results[0]" },
        } },
      { id: "crash", label: "Crash: IndexError", kind: "failure", presence: "before", basis: "reported",
        issue_quote: "IndexError: list index out of range", explanation: "The page shows a traceback instead of results." },
      { id: "empty", label: "Empty-state message", kind: "result", presence: "after", basis: "inferred",
        explanation: "The page shows the existing empty-state message." },
      { id: "shown", label: "Show the first result", kind: "result", presence: "both", basis: "inferred",
        explanation: "With at least one result, the first is formatted and shown, as before.",
        code: {
          original: { path: "src/results.py", start_line: 19, end_line: 19, quote: "    return format_result(top)" },
          patched: { path: "src/results.py", start_line: 21, end_line: 21, quote: "    return format_result(top)" },
        } },
    ],
    edges: [
      { id: "e1", from: "query", to: "none", presence: "both" },
      { id: "e2", from: "none", to: "first", presence: "before", explanation: "Nothing stops an empty list from reaching the index." },
      { id: "e3", from: "first", to: "crash", presence: "before", label: "list is empty" },
      { id: "e4", from: "none", to: "guard", presence: "after" },
      { id: "e5", from: "guard", to: "empty", presence: "after", label: "no results" },
      { id: "e6", from: "guard", to: "first", presence: "after", label: "has results" },
      { id: "e7", from: "first", to: "shown", presence: "both", label: "list isn't empty" },
    ],
    reasoning: {
      intended: "An empty search should show a message that there are no results.",
      cause: "first_result() reads results[0] without checking that the list has anything in it.",
      location: "first_result() is the only place that indexes into the results, so a check there covers every caller.",
      effect: "An empty list now returns the empty-state value before the index is read; non-empty lists take the same path as before.",
      uncertain: "Other code that might assume first_result() never returns EMPTY_STATE wasn't checked.",
    },
    evidence: [
      { check: "regression", target: "crash", note: "The new test calls first_result([]) and failed on the unfixed code." },
      { check: "tests", target: "empty", note: "test_empty_search_shows_empty_state expects EMPTY_STATE for an empty list." },
    ],
  },
};

const timeoutDocs: Draft = {
  name: "Documentation gives the wrong unit",
  issue: {
    title: "README says --timeout is in seconds",
    body_excerpt: "The README says --timeout is in seconds, but --timeout 30 gives up almost immediately.",
  },
  patch: lines(
    "diff --git a/README.md b/README.md",
    "index 1a2b3c4..5d6e7f8 100644",
    "--- a/README.md",
    "+++ b/README.md",
    "@@ -30,5 +30,5 @@ Options",
    " ",
    " | Flag | Meaning |",
    " |---|---|",
    "-| `--timeout` | Seconds to wait before giving up |",
    "+| `--timeout` | Milliseconds to wait before giving up |",
    " | `--retries` | How many times to retry |",
  ),
  explanation: {
    sample: true,
    kind: "documentation",
    base_commit: "9c8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b",
    nodes: [
      { id: "report", label: "--timeout 30 gives up almost immediately", kind: "statement", presence: "both", basis: "reported",
        issue_quote: "--timeout 30 gives up almost immediately", explanation: "What the reporter saw." },
      { id: "code", label: "The code reads --timeout as milliseconds", kind: "statement", presence: "both", basis: "inferred",
        explanation: "The value is used as milliseconds without conversion, so 30 means 30 ms.",
        code: {
          original: { path: "src/cli.py", start_line: 12, end_line: 12, quote: "    timeout_ms = int(args.timeout)" },
          patched: { path: "src/cli.py", start_line: 12, end_line: 12, quote: "    timeout_ms = int(args.timeout)" },
        } },
      { id: "old", label: "README: seconds", kind: "statement", presence: "before", basis: "inferred",
        explanation: "The options table gives the unit as seconds.",
        code: { original: { path: "README.md", start_line: 33, end_line: 33, quote: "| `--timeout` | Seconds to wait before giving up |" } } },
      { id: "new", label: "README: milliseconds", kind: "statement", presence: "after", basis: "inferred",
        explanation: "The options table now gives the unit the code uses.",
        code: { patched: { path: "README.md", start_line: 33, end_line: 33, quote: "| `--timeout` | Milliseconds to wait before giving up |" } } },
    ],
    edges: [
      { id: "d1", from: "report", to: "code", presence: "both", label: "explained by" },
      { id: "d2", from: "code", to: "old", presence: "before", label: "contradicts" },
      { id: "d3", from: "code", to: "new", presence: "after", label: "matches" },
    ],
    reasoning: {
      intended: "The README should state the unit the program uses.",
      cause: "The options table says seconds; the code treats the value as milliseconds.",
      location: "The table row is the only place the README states the unit.",
      effect: "The row now says milliseconds, matching the code. Behaviour is unchanged.",
      uncertain: "Whether the maintainers would rather change the code to seconds wasn't asked.",
    },
    evidence: [{ check: "documentation", target: "new", note: "The documentation checks ran against the changed README." }],
  },
};

// A large sample at the 12-step limit, to check the layout: branches, long labels, connections that skip a layer,
// and steps with recorded-check badges. Hand-written like the others.
const csvImport: Draft = {
  name: "Large flow at the 12-step limit",
  issue: {
    title: "CSV import rejects the whole file when the last line is blank",
    body_excerpt: "Upload a CSV whose last line is blank and nothing is imported.\n\nThe page says: row 14 has 1 field, expected 6\n\nExpected: the blank line is ignored and the other rows are imported.",
  },
  patch: lines(
    "diff --git a/importer/csv_import.py b/importer/csv_import.py",
    "index 5a1c9e2..8d3f0b7 100644",
    "--- a/importer/csv_import.py",
    "+++ b/importer/csv_import.py",
    "@@ -40,6 +40,9 @@ def parse_rows(lines, columns):",
    "     records = []",
    "     for number, line in enumerate(lines, start=2):",
    "+        if not line.strip():",
    "+            skipped += 1",
    "+            continue",
    '         fields = line.strip().split(",")',
    "         if len(fields) != len(columns):",
    "             raise ImportRejected(number, len(fields))",
    "         records.append(dict(zip(columns, fields)))",
  ),
  explanation: {
    sample: true,
    kind: "behaviour",
    base_commit: "b3d94e07a1c25f68d0e9b7a6c5d4e3f2a1b0c9d8",
    nodes: [
      { id: "upload", label: "Upload a CSV file whose last line is blank", kind: "input", presence: "both", basis: "reported",
        issue_quote: "a CSV whose last line is blank", explanation: "The reporter's file ends with an empty line." },
      { id: "read", label: "Read the uploaded file into a list of lines", kind: "step", presence: "both", basis: "inferred",
        explanation: "The whole file is read at once and split on line breaks, so a trailing blank line becomes an empty string.",
        code: {
          original: { path: "importer/upload.py", start_line: 18, end_line: 18, quote: "    lines = handle.read().splitlines()" },
          patched: { path: "importer/upload.py", start_line: 18, end_line: 18, quote: "    lines = handle.read().splitlines()" },
        } },
      { id: "header", label: "Does the first line contain every required column name?", kind: "check", presence: "both", basis: "inferred",
        explanation: "The header row is checked before any data row is parsed." },
      { id: "badheader", label: "Show the missing-column message and stop the import", kind: "result", presence: "both", basis: "inferred",
        explanation: "Unchanged by the patch." },
      { id: "loop", label: "Parse each remaining line into a record, in file order", kind: "step", presence: "both", basis: "inferred",
        explanation: "parse_rows() walks the lines one at a time.",
        code: {
          original: { path: "importer/csv_import.py", start_line: 41, end_line: 41, quote: "    for number, line in enumerate(lines, start=2):" },
          patched: { path: "importer/csv_import.py", start_line: 41, end_line: 41, quote: "    for number, line in enumerate(lines, start=2):" },
        } },
      { id: "blank", label: "Is the line empty once the whitespace around it has been removed?", kind: "check", presence: "after", basis: "inferred",
        explanation: "The patch tests for a blank line before the line is split, the first place a blank line is handled at all.",
        code: { patched: { path: "importer/csv_import.py", start_line: 42, end_line: 44, quote: "        if not line.strip():\n            skipped += 1\n            continue" } } },
      { id: "skip", label: "Count the blank line as skipped and move on to the next line", kind: "step", presence: "after", basis: "inferred",
        explanation: "A blank line no longer reaches the field count." },
      { id: "split", label: "Split the line on commas into its separate fields", kind: "step", presence: "both", basis: "inferred",
        explanation: "A blank line splits into a single empty field.",
        code: {
          original: { path: "importer/csv_import.py", start_line: 42, end_line: 42, quote: '        fields = line.strip().split(",")' },
          patched: { path: "importer/csv_import.py", start_line: 45, end_line: 45, quote: '        fields = line.strip().split(",")' },
        } },
      { id: "count", label: "Does the number of fields on the line match the number of header columns?", kind: "check", presence: "both", basis: "inferred",
        explanation: "One empty field never matches a six-column header.",
        code: {
          original: { path: "importer/csv_import.py", start_line: 43, end_line: 43, quote: "        if len(fields) != len(columns):" },
          patched: { path: "importer/csv_import.py", start_line: 46, end_line: 46, quote: "        if len(fields) != len(columns):" },
        } },
      { id: "reject", label: "Reject the whole file and report the row with the wrong field count", kind: "failure", presence: "both", basis: "reported",
        issue_quote: "row 14 has 1 field, expected 6", explanation: "Still what happens for a row that really has the wrong number of fields.",
        code: {
          original: { path: "importer/csv_import.py", start_line: 44, end_line: 44, quote: "            raise ImportRejected(number, len(fields))" },
          patched: { path: "importer/csv_import.py", start_line: 47, end_line: 47, quote: "            raise ImportRejected(number, len(fields))" },
        } },
      { id: "save", label: "Save every parsed record to the database in one transaction", kind: "result", presence: "both", basis: "inferred",
        explanation: "Reached only when no row was rejected." },
      { id: "summary", label: "Show how many rows were imported and how many blank lines were skipped", kind: "result", presence: "after", basis: "inferred",
        explanation: "The skipped count is reported so the blank line is not silently dropped." },
    ],
    edges: [
      { id: "c1", from: "upload", to: "read", presence: "both" },
      { id: "c2", from: "read", to: "header", presence: "both" },
      { id: "c3", from: "header", to: "badheader", presence: "both", label: "a column is missing" },
      { id: "c4", from: "header", to: "loop", presence: "both", label: "all columns present" },
      { id: "c5", from: "loop", to: "split", presence: "before", explanation: "Every line was split, blank or not." },
      { id: "c6", from: "loop", to: "blank", presence: "after" },
      { id: "c7", from: "blank", to: "skip", presence: "after", label: "blank" },
      { id: "c8", from: "blank", to: "split", presence: "after", label: "not blank" },
      { id: "c9", from: "split", to: "count", presence: "both" },
      { id: "c10", from: "count", to: "reject", presence: "both", label: "counts differ" },
      { id: "c11", from: "count", to: "save", presence: "both", label: "every line matched" },
      { id: "c12", from: "skip", to: "save", presence: "after", label: "remaining lines" },
      { id: "c13", from: "save", to: "summary", presence: "after" },
    ],
    reasoning: {
      intended: "A blank line in a CSV file should be ignored, and the other rows imported.",
      cause: "A blank line is split like any other, giving one empty field, which fails the field count and rejects the file.",
      location: "parse_rows() is where each line is first looked at, so a blank line can be dropped there before it is split.",
      effect: "Blank lines are counted and skipped before the split; lines with content take the same path as before.",
      uncertain: "Lines that contain only commas are still rejected; whether they should be wasn't asked.",
    },
    evidence: [
      { check: "regression", target: "reject", note: "The new test imports a file ending in a blank line and was rejected on the original code." },
      { check: "tests", target: "skip", note: "test_blank_last_line_is_skipped expects the skipped count to be 1." },
      { check: "tests", target: "save", note: "The same test expects the other rows to be saved." },
    ],
  },
};

export const SAMPLES: Sample[] = [
  withRun(emptySearch, 41, "Tests pass, and the new test fails on the unfixed code.", {
    work_type: "code",
    root_cause: "first_result() reads results[0] without checking that the list has anything in it.",
    approach: "Return the empty-state value when there are no results, before the index is read.",
    not_verified: "Callers that pass something other than a list.",
    setup_commands: [["python", "-m", "pip", "install", "-e", "."]],
    test_commands: [["python", "-m", "pytest", "tests/test_results.py"]],
    regression_reproduced: true, documentation_verified: false,
    validation_log: "tests/test_results.py ...                                    [100%]\n3 passed in 0.04s",
    regression_log: "FAILED tests/test_results.py::test_empty_search_shows_empty_state\nSCOUT_REGRESSION:41 assertion failed\n1 failed, 2 passed in 0.05s",
  }),
  withRun(timeoutDocs, 58, "Documentation checks pass.", {
    work_type: "documentation",
    root_cause: "The options table says seconds; the code treats the value as milliseconds.",
    approach: "Correct the unit in the README's options table.",
    not_verified: "Other pages that might repeat the old unit.",
    setup_commands: [], test_commands: [],
    regression_reproduced: null, documentation_verified: true,
    validation_log: "README.md: changed lines checked",
    regression_log: "not applicable to documentation",
  }),
  withRun(csvImport, 73, "Tests pass, and the new test fails on the unfixed code.", {
    work_type: "code",
    root_cause: "A blank line splits into one empty field, which fails the field count.",
    approach: "Skip blank lines before splitting, and count them.",
    not_verified: "Files that use a different line ending inside quoted fields.",
    setup_commands: [["python", "-m", "pip", "install", "-e", "."]],
    test_commands: [["python", "-m", "pytest", "tests/test_csv_import.py"]],
    regression_reproduced: true, documentation_verified: false,
    validation_log: "tests/test_csv_import.py .....                               [100%]\n5 passed in 0.11s",
    regression_log: "FAILED tests/test_csv_import.py::test_blank_last_line_is_skipped\nSCOUT_REGRESSION:73 assertion failed\n1 failed, 4 passed in 0.12s",
  }),
];
