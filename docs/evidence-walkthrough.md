# Visual bug explainer

Direction revised 2026-11-14. The main experience is an interactive diagram of **how** the bug happens, **where** the
fix intervenes and **why** that change was chosen, drawn for the particular issue and patch. The five-item evidence
summary (Part 2) is supporting data for it, not the screen.

Status (2026-11-16, branch `feat/evidence-walkthrough`): experimental source preview for feedback. Stages 1 and 2
are built. The only screen is the sample page; no real run shows a diagram, and the engine is unchanged.

| Part | State |
|---|---|
| Evidence model with source references, logs and commands (`src/explain.ts`, 22 tests) | Built; kept as supporting data |
| Patch splitter and real-git fixtures (`src/patch.ts`, `src/test/patches/`, 33 tests), with each hunk's line numbers and `sideLines` | Built; feeds the Changes view and code-reference checks |
| Diagram model (`src/diagram.ts`, 35 tests): `buildDiagram`, `view`, `reasoningFor` | Built (stage 1) |
| Hand-written samples (`src/samples/explanations.ts`): a branching behaviour fix, a documentation fix and a large flow at the 12-step limit, all `sample: true` | Built |
| Visual prototype on those samples (`src/components/BugDiagram.tsx`, `src/pages/ExplainerSample.tsx`, route `/samples/explainer`, 15 tests; offline Electron check of 72 layout states) | Built (stage 2) and polished after review 2026-11-15; waiting for the user's judgement of whether it helps |
| Engine output for real runs (`explanation`, base commit, regression test) | Proposed below; needs the user's go-ahead |
| Automatic diagrams for real runs | Blocked on the engine output |
| Markdown and Obsidian Canvas export | Optional, last; the diagram data is plain so it maps directly |

## Trying the source preview

Run `npm ci`, then `npm start`. In the workspace footer, open **Preview: sample bug explanation**. All three
examples are written by hand and labelled on screen. Try Before, After and Changes, select a step or connection,
and inspect its code, reasoning and recorded-check examples. Keyboard activation uses Enter or Space; Escape
returns focus to the control that opened the inspector. Plain `+`, `-` and `0` control the focused diagram.

This preview is for source builds on the feature branch. The published v0.1.0 installer does not contain it.
Gate the sample route and footer link before an installer release. Automatic explanations for real runs and
Markdown/Obsidian exports are not implemented. Packaged-app, screen-reader and broader Windows scaling checks
remain outstanding.

# Part 1: the diagram

## What presentation can and can't do

A diagram is a way to show an explanation. It adds no knowledge of its own. A run today records one paragraph on the
cause, one on the approach, a patch and check results; it does not record the steps the code takes, which line
fails, or how the change alters the path. Drawing boxes around those paragraphs would look like causal understanding
without containing any. So:

- Runs recorded by today's engine get **no behaviour diagram**. They get the reasoning the run did record, the
  changed files and hunks, the evidence, and a plain statement that this run recorded no step-by-step flow.
- A behaviour diagram appears only when the run itself recorded one in a structured form (the `explanation` proposed
  below), and that form passed checks in the engine and again in the app.
- The app never derives nodes or connections from free text.

## What today's artifacts support

Checked against `save_result` and `BRIEF_SCHEMA` in the template (`84956cb`) and the app's reader.

| Wanted | Recorded today? | Where |
|---|---|---|
| What failed, as reported | Yes, as an excerpt (1,200 characters) | `issue.title`, `issue.body_excerpt` |
| What caused it | One free-text paragraph, Scout's | `report.root_cause` |
| What the patch changes, and why | One free-text paragraph, Scout's | `report.approach` |
| What remains uncertain | Free text, Scout's | `report.not_verified`, `report.risks` |
| The change itself | Yes | `report.patch`: files, hunks, old and new line numbers |
| What was tested | Yes | check flags, `validation_log`, `regression_log`, `test_commands`, `setup_commands` |
| Intended behaviour | No | |
| Why this location was changed | No (sometimes inside `approach`, not separable) | |
| Steps from input to failure, and the changed path | No | |
| Code references outside the patch | No | |
| Which commit the original code is | No: the engine makes a shallow clone and saves no commit id | |
| Which test is the regression test | Known to the engine (`test_files`, `regression_marker`), not saved | |
| An execution trace | No, and none is proposed | |

From today's data the app can build, honestly: the reasoning panel with two of the five questions answered and three
marked "not recorded", the Changes list (files and hunks, from `splitPatch`), and the evidence rows.

## Engine output needed (proposal; the engine is not changed in this step)

Three additions to `result.json`. The first two are facts the engine already has and cost nothing.

1. `base_commit`: the commit id of the checkout (`git rev-parse HEAD` after the clone). Ties every "original"
   reference to a real revision and lets the app link to that file on GitHub.
2. `fix.test_files` and `fix.regression_marker`: already in the solver's brief, just not saved. They identify what
   the regression check ran.
3. `explanation`: written by the solver in the same structured brief that already holds `root_cause`, then checked by
   the engine against the checkout before saving.

```text
explanation
  kind          "behaviour" or "documentation"
  nodes[]       id, label, kind (input, step, check, failure, result, statement), presence (both, before, after),
                basis (reported, inferred), issue_quote? (required when reported), explanation,
                code? { original?: reference, patched?: reference }
  edges[]       id, from, to, label?, presence, explanation?
  reasoning     intended, cause, location, effect, uncertain   (text; any may be empty)
  evidence[]    check (tests, regression, documentation), target (node or edge id), note

reference       path, start_line, end_line, quote
```

A node present in both versions carries **two references**, one per revision, because the same code can sit on
different lines or under a different file name after the patch. A `before` node may only have `original`; an `after`
node only `patched`.

Rules the engine enforces before saving:

- Every reference's `quote` equals those lines of that file at that revision: `original` is `base_commit`, `patched`
  is the checkout with the patch applied. The engine has the whole checkout, so it can check every reference,
  including lines no diff shows.
- A `reported` node's `issue_quote` appears word for word in the issue text the run saved.
- Ids are unique, connections join existing nodes, every connection's ends exist in each version the connection
  exists in, there are no cycles, and sizes are bounded (12 nodes, 16 connections, 600 characters per text).
- All text goes through the existing redaction. If the patch is withheld, no `explanation` is saved at all.

Decided 2026-11-15:

- The explanation is written in the **existing drafting call**, alongside the final fix, including repair attempts
  (it describes the patch that was finally validated, not an earlier attempt).
- **An invalid explanation never invalidates the fix or the report.** If it fails any rule above, the engine saves the
  run exactly as today without it. It never feeds into `outcome`, retries or the email.
- **Compatibility is settled before implementation:** the new fields are optional additions under
  `schema_version` 1. Checked 2026-11-15: the released reader (`df1d7dd`, identical to the current
  `electron/artifacts.js`) reads a version 1 result carrying `base_commit`, `explanation`, `fix.test_files` and
  `fix.regression_marker` as a normal report and ignores them. A regression test for this goes in with stage 4.
- Cost: more output tokens in the drafting call; to be measured on real runs (paid, so only with the user's
  go-ahead), not assumed.

## Diagram model (`src/diagram.ts`, pure data, no React)

One graph per run. **Before**, **After** and **Changes** are three views of it, not three drawings:

| View | Shows |
|---|---|
| Before | nodes and connections with presence `both` or `before` |
| After | presence `both` or `after` |
| Changes | everything; `before`-only marked removed, `after`-only marked added, the affected path highlighted |

Branches are ordinary: a node may have several outgoing connections, each with a label ("no results", "has results").

### Three separate layers on every node

A node answers three different questions, and one never stands in for another:

| Layer | Question | Values | Who says so |
|---|---|---|---|
| Behaviour (`basis`, `label`, `explanation`) | What happens here, and why? | `reported`: stated in the saved issue text, with the quoted words. `inferred`: Scout's reading of the code, not observed | The issue reporter, or Scout |
| Code (`code.original`, `code.patched`) | Which lines is this about? | `check: "patch"` (the app matched the quote against the saved patch) or `"engine"` (see below); `changed`: whether the patch adds or removes any of those lines | The patch, a recorded fact |
| Evidence (`evidence[]`) | What did a check record about this? | the check's recorded result, plus Scout's note on why it belongs here | The run for the result; Scout for the attribution |

Finding a guard in the patch proves those lines were added. It does not prove the explanation attached to the node,
which stays `inferred` however the code was checked. There is no `recorded` basis for behaviour: nothing a run saves
observes behaviour step by step. An explanation that claims one is refused.

No run records an execution trace, so **every connection is `inferred`**, in every run. A passing test is attached to
the node it concerns as evidence; it does not turn the connections leading there into recorded facts. The inspector
says this in words: "Tests passed. This shows the changed behaviour, not that each step above happened as drawn."

### Checks the app repeats

The app trusts nothing the engine saved. `buildDiagram(explanation, { patch, withheld, issue })` returns a diagram or
a reason:

- structure, sizes, unique ids, no cycles, no dangling connections;
- **each view is closed:** a connection in both versions needs both ends in both versions; a `before` connection
  needs ends that exist before; an `after` connection needs ends that exist after. So no view can draw a connection
  to a node it doesn't show;
- a `reported` node's `issue_quote` must appear in the saved issue title or excerpt;
- code references, line by line against the saved patch (`splitPatch` now records each hunk's old and new starting
  line). `original` is compared with removed and context lines at the old numbers, `patched` with added and context
  lines at the new ones:

| The referenced lines are | Result |
|---|---|
| all shown by the patch, and equal the quote | accepted, `check: "patch"` |
| shown by the patch, and any differs from the quote | **refused**: the saved patch contradicts the reference |
| partly or wholly outside what the patch shows (a diff carries only a few lines of context), or in a file the patch doesn't touch | accepted, `check: "engine"`; any lines the patch does show must still match |
| in a version of the file that doesn't exist (`original` of an added file, `patched` of a deleted one) | **refused** |
| unknown because the saved patch can't be split, or there is none | accepted, `check: "engine"` |

  A reference outside the diff's context is not wrong evidence; the app just can't see those lines. `check: "engine"`
  is shown as "checked by the engine against commit abc1234 when the run was saved; not shown in the patch", with a
  link to the file at that commit for `original`. It is never shown as checked by the app.
- withheld patch: no diagram, whatever the artifact contains.

A refusal means no diagram and a stated reason. There is no partial diagram.

### Reasoning panel

Five fixed questions beside the diagram. Each answer names its source; an empty one says "This run didn't record
this." Nothing is written in its place.

| Question | Today | With `explanation` |
|---|---|---|
| What behaviour was intended? | not recorded | `reasoning.intended` (Scout) |
| What caused the reported failure? | `report.root_cause` (Scout) | `reasoning.cause`, else `report.root_cause` |
| Why was this location changed? | not recorded | `reasoning.location` (Scout) |
| How does the change address it? | `report.approach` (Scout) | `reasoning.effect`, else `report.approach` |
| What was tested, and what remains uncertain? | checks and logs (recorded); `not_verified`, `risks` (Scout) | the same, plus `reasoning.uncertain` |

Alternatives considered and investigation steps are not shown: no run records them. (`approach` is prompted as "what
changed and why this over alternatives", so that paragraph may mention some; it is shown as Scout's text, unedited.)

### Documentation fixes

No runtime path is drawn. `kind: "documentation"` uses `statement` nodes: what the documentation said, what the code
or issue shows instead (with a reference), and what it says now. The three views still apply (the old statement is
`before`, the new one `after`). The evidence is the documentation check; the regression row stays "not applicable".

### When there isn't enough

| Situation | Shown |
|---|---|
| Run from today's engine (no `explanation`) | Reasoning panel, Changes list, evidence; "This run didn't record a step-by-step flow." |
| `explanation` fails a check | The same, plus which check failed |
| Patch withheld | Reasoning text and evidence only; no diagram, no Changes list, no code |
| `no_fix`, `no_pick`, unfinished, or no readable report | Unchanged from today (see Part 2) |

## Concrete example

The sample the prototype will use. It is written by hand, marked `sample: true` in its fixture and labelled on screen
"Sample explanation, written by hand. Not produced by a run."

```text
BEFORE
[1 Empty search] → [2 No results] → [3 Read first result] → [4 Crash: IndexError]
   reported           inferred         inferred                  reported
                      search.py:42     results.py:18             + regression check
                      (engine)         (patch, unchanged)

AFTER
[1 Empty search] → [2 No results] → [5 Any results?] ── no ──→ [6 Empty-state message]
                                     inferred                    inferred + tests check
                                     results.py:18-19
                                     (patch, added lines)
                                          └── yes ──→ [3 Read first result] → [7 Show result]
                                                       results.py:20

CHANGES
node 5 and its three connections added; connections 2→3 and 3→4 and node 4 removed
```

Node 3 exists in both versions with two references: line 18 originally, line 20 after the patch adds two lines above
it. Selecting it in Before opens:

```text
Read first result                                  Scout's reading of the code (not observed)
src/results.py, line 18, original (commit 4f2a9c1)   matched against the saved patch; not changed by it
    top = results[0]
Assumes the list is never empty. An empty search returns [], so this raises IndexError.
```

Selecting node 5 in After opens three separate things: the two added lines ("These lines are in the saved patch,
added by it"), Scout's explanation of why the check goes here (labelled as Scout's reading), and the tests row with
its command and log. Node 2 points at `search.py`, which the patch doesn't touch, so its code is labelled "checked by
the engine against commit 4f2a9c1; not shown in the patch".

Reasoning panel for the sample: intended ("an empty search shows an empty-state message"), cause, location ("the
only place that indexes into the results"), effect, tested (tests passed; the new test failed on the unfixed code),
uncertain ("other callers of `first_result` weren't checked").

## Interaction and accessibility

- Before, After and Changes are a real tab set (arrow keys, WAI tabs pattern).
- The canvas is drawn by React Flow (`@xyflow/react` 12.12.0, MIT, the user's choice 2026-11-15; a pinned dev
  dependency bundled by Vite into its own lazily loaded chunk, so the main bundle is unchanged). React Flow does no
  layout: `positions()` in `src/diagram.ts` places steps by longest path, **top to bottom**, over the whole graph, so
  a step stays put when the view changes. Top to bottom keeps step text at 12px or more at the default window size;
  fitting never shrinks below 90%. Ceiling: no crossing minimisation, acceptable at 12 nodes.
- Diagram zoom never uses Ctrl. Ctrl +/−/0 and Ctrl + wheel already zoom the whole application
  (`electron/main.js`) and keep doing only that. The diagram has its own Zoom in, Zoom out and Fit buttons, and
  while the canvas has focus plain `+`, `-` and `0` do the same. The wheel never zooms the diagram: it always
  scrolls the page (wheel and pinch zoom are switched off in React Flow).
- Pan: drag, or Shift + arrow keys while the canvas has focus.
- Steps and connections are focusable; Down and Up follow connections, Right and Left step through the steps; Enter
  or Space opens the inspector and moves focus to it; Escape returns to the step.
- Beside the canvas, the same graph as an ordered text list (step, basis, where it leads). It is the accessible
  equivalent and the fallback at narrow widths, and it is what the Markdown export will print.
- Basis, added/removed and check states are always in words, not colour alone. Green only for a passed check; amber
  for failed or not verified; inferred items are neutral.
- All labels, paths, quotes and explanations are untrusted text and rendered as text.

### Polish pass after review (2026-11-15)

These replace the earlier wording above where they differ.

- **Opening is separate from selecting.** Enter, Space or a click on a step or connection always opens the inspector
  and moves focus to it, including when that item is already selected. Escape returns focus to whatever opened it:
  the step or connection on the canvas, or its button in the text list.
- **One fitting rule** for the first view, the Fit button, the `0` key and a resized canvas. It fits the whole graph
  (all three views together), so switching view moves nothing. Width alone sets the zoom, between 90% and 100%; the
  canvas is as tall as the graph and the page scrolls. The smallest step text is 13.5px, so fitting never shows text
  under 12px. A graph too wide for 90% starts at its left edge and is panned; a step that takes focus while partly
  outside the canvas is moved into it. Zooming further out is only ever the user's own choice (buttons or keys).
  A window resize refits only while the user hasn't moved or zoomed the diagram.
- **Routing.** `layout()` in `src/diagram.ts` gives every connection that skips a layer a place of its own in each
  layer it passes. A connection drops straight to the foot of its layer, moves sideways only in the gap between
  layers, and runs straight down its own place in a skipped layer, so it never crosses a step. Steps are 190px wide
  and each layer is as tall as its tallest step, estimated from the text (on the generous side), so the layout is
  identical in every view and doesn't wait for measurement.
- **Labels on connections** sit in the gap, clear of steps: at the far end when several labelled connections leave
  one step, otherwise at the near end, and pulled back along their own line when another connection arrives at the
  same point. On the canvas a label is cut at 26 characters; the inspector, the text list and the accessible name
  carry it whole.
- **Check wording.** The regression check "passes" when the new test fails on the code before the patch, so it is
  worded as what it shows. The recorded flags and outcome rules underneath are unchanged.

| Recorded | Shown |
|---|---|
| `regression_reproduced` true | Bug reproduced on original code |
| `regression_reproduced` false | Bug not reproduced on original code |
| `regression_reproduced` null on a code fix | Reproduction on original code was not attempted |
| documentation fix | No reproduction for a documentation fix |
| `tests_passed` true / false | Tests passed / Tests failed |
| `documentation_verified` true / false | Documentation checks passed / Documentation checks failed |

- **Large sample.** A third hand-written sample sits at the 12-step limit with branches, labels up to 73 characters,
  two connections that skip a layer and three check badges.

Evidence: `out/explainer/REPORT.md` (local, not committed), from `out/explainer/review.cjs`: 72 layout states (three
samples, three views, four window sizes, two themes), 24 fitting cases and real key and mouse input in an offline
Electron window. Not tested: a screen reader, a real drag or touch, the packaged installer, display scaling other
than 100%, graphs with three or more steps side by side or crossings the layout can't untangle, and any real run.

## Stages

Each stage is its own reviewable change; the suite and build pass before each.

| # | Stage | Uses real runs? | Needs |
|---|---|---|---|
| 0 | Evidence model, patch splitter | Yes | Done |
| 1 | Diagram model: types, `buildDiagram`, the three views, the reasoning panel's data, hunk line numbers in `splitPatch`; hand-written samples (the branching example above and a documentation one; refused cases are those samples with one thing changed) | No | Done 2026-11-15 |
| 2 | Visual prototype: canvas, inspector, reasoning panel, text list, all on the sample fixtures and reachable only from a labelled sample page (footer link "Preview: sample bug explanation"; remove or gate the link before any release) | No | Done 2026-11-15 |
| 3 | Compatibility view for runs without an explanation (every existing run, and repositories on an older engine): "Explain" tab with the reasoning panel, Changes list, evidence, and the limitation notice. No diagram. Lower priority than getting stage 2 right | Yes | Review of stage 2 |
| 4 | Engine contract: `base_commit`, `test_files`, `regression_marker`, `explanation`, engine-side checks, redaction; cost measured | Template repo | User's go-ahead; paid test runs |
| 5 | App reads the new fields; diagrams appear for runs whose explanation passes `validate` | Yes | Stage 4 on the template's `main` |
| 6 | Checks: both themes at 1280×860, 900×700, 900×500 and narrow; keyboard-only pass; large patch; packaged app; one real run, read-only; a first-time reader says what was observed and what was inferred | Yes | |
| 7 | Optional exports: Markdown (the text list plus reasoning), Obsidian Canvas (nodes and connections map one to one) | | Only if wanted |

The prototype comes first so the user can judge whether a diagram actually makes a fix easier to understand before
any engine work. Stage 2 proves the interaction and nothing else. It must not be described, on screen or in release notes, as Scout
explaining real bugs; that starts at stage 5.

# Part 2: the evidence model (built, supporting data)

## What it is

`explain(run)` connects what a finished run recorded: the reported symptom, Scout's proposed cause, the recorded
change, the validation evidence and the recorded outcome. It uses only what the run already saved. It feeds the
reasoning panel, the evidence shown beside diagram nodes, and the stage 3 screen for runs without a diagram.

It is not a causal graph. It does not prove the cause, and it never decides or changes a run's outcome.

**Success criterion:** a reader can get from any statement to the saved evidence behind it, and no statement is
presented as stronger than that evidence.

## The one rule

**No claim may exceed the evidence supporting that particular claim.**

Each item is judged on its own. A passing fact (tests passed) may be shown as passing even when the overall
outcome is not verified. An explanation written by the model is always attributed to Scout, never shown as proven,
whatever the outcome.

## Where the data comes from

```text
engine artifact → existing validation (electron/artifacts.js) → Run (src/types.ts) → explanation model → view
```

The explanation model reads the `Run` the renderer already receives. It does not read `result.json`, and it adds no
second interpretation of verification. If the backend refuses an artifact (unreadable, contradictory, withheld and
present at once), there is no report and so no walkthrough.

## Explanation model

A pure function, `explain(run)`, in `src/explain.ts`. It returns either "not supported, and why" or five items in a
fixed order. Each item has separate fields for separate questions, never one status that mixes them:

| Field | Values | Answers |
|---|---|---|
| `origin` | `recorded`, `proposed` | Is this a saved fact, or Scout's explanation? |
| `availability` | `available`, `unavailable`, `withheld`, `not_applicable` | Is there something to show? |
| `check` (evidence only) | `passed`, `failed`, `not_run` | What did this check record? |
| `source` | `{ run, fields }`: the run's id and the `Run` fields read to build the item | Where is the evidence? |

### Source references

Every item, the change description and every evidence row has a `source`. `fields` are paths into the `Run`, typed
against `RunIssue` and `RunReport` (`"issue.title"`, `"report.validation_log"`, `"outcome"`), so a renamed field
fails the type check. They list every field read, including ones that turned out empty. The model holds no React
elements, callbacks or DOM targets, and JSON round-trips it unchanged; the view decides where a reference opens.

| Item | `source.fields` |
|---|---|
| Reported symptom | `issue.title`, `issue.body_excerpt`, `issue.url` |
| Proposed cause | `report.root_cause` |
| Recorded change | `report.patch`; withheld: `report.patch_withheld_reason` only; absent: both |
| Change description | `report.approach` |
| Validation evidence | `report.work_type`, `report.setup_commands` |
| Tests row | `report.tests_passed`, `report.test_commands`, `report.validation_log` |
| Regression row | `report.regression_reproduced`, `report.regression_log` (documentation: `report.work_type`, `report.regression_log`) |
| Documentation row | `report.documentation_verified`, `report.test_commands`, `report.validation_log` |
| Recorded outcome | `outcome`, `outcome_reason` |

A withheld change never references `report.patch`, so nothing can follow a reference to a withheld patch.

Colour follows `check` and the outcome only: `passed` may be green, `failed` and "not verified" are amber, everything
else is neutral. `proposed` items are always neutral.

### The five items

| # | Label | Origin | Content | Source |
|---|---|---|---|---|
| 1 | Reported symptom | recorded | Issue title and the saved excerpt of its description, labelled "saved excerpt" with a link to the issue on GitHub | `run.issue` |
| 2 | Proposed cause | proposed | `report.root_cause`, attributed "from Scout's report" | Review brief |
| 3 | Recorded change | recorded | Files and hunks of the saved patch, each opening that place in the Patch view | `report.patch` |
| 4 | Validation evidence | recorded | One row per check, below | Validation view and its logs |
| 5 | Recorded outcome | recorded | `run.outcome` and `run.outcome_reason`, word for word | the run |

`report.approach` is shown with item 3 as "Scout's description of the change", origin `proposed`.

### Evidence rows (item 4)

| Row | Shown when | `check` |
|---|---|---|
| Tests | code or documentation | `passed` if `tests_passed`, else `failed` |
| Regression on unfixed code | code | `regression_reproduced` true → `passed`; false → `failed` ("not shown"); null → `not_run` |
| Regression on unfixed code | documentation | availability `not_applicable` |
| Documentation checks | documentation | `passed` if `documentation_verified`, else `failed` |

Each row carries its recorded evidence, and the evidence item carries `setup` (`setup_commands`, which prepared the
environment for every check):

| Row | `log` | `commands` |
|---|---|---|
| Tests | `validation_log` | `test_commands` |
| Regression | `regression_log` | always `unavailable`: the artifact records no commands for the regression run, and none are invented |
| Documentation checks | `validation_log` (these checks are the validation run) | `test_commands` |

- Logs are repeated word for word, whitespace included. Commands stay as the recorded argument lists and are not
  joined into shell strings.
- A blank log, or an empty or absent command list, is `{ availability: "unavailable" }`. Nothing is written in its
  place.
- The regression row repeats `regression_log` even when the check didn't run or doesn't apply. The engine saves a
  placeholder there (the `tests_failed` fixture, a code fix, records "not applicable to documentation"). The row's
  `check` or `availability` says what happened; the view must label that text as the saved log field, not as a result.

### Availability rules

- Empty `root_cause`: item 2 is `unavailable` ("Scout's report gave no cause"). Nothing is written in its place.
- Empty issue excerpt: item 1 shows the title only and says no description was saved.
- `patch` null with `patch_withheld_reason`: item 3 is `withheld` with the reason. No file names, hunk headers,
  counts, previews or navigation targets derived from the patch exist anywhere in the model.
- `patch` null without a reason: item 3 is `unavailable`.

## Which runs get a walkthrough

Only finished runs that have a validated report (`run.report`): outcomes `fix_verified` and `fix_not_verified`.
For these, "Explain" is the first tab; Review brief, Patch, Validation and PR preparation stay as they are.

Every other run keeps its current page and gets no walkthrough:

| Run | Why not |
|---|---|
| `no_pick` | A valid abstention, not five failed steps |
| `no_fix` | No change or checks were recorded; the saved report is already shown |
| Saved report missing, expired, unreadable, not downloaded | Evidence unavailable; this is not an unverified fix |
| Older engine's saved report | No structured result to attribute |
| Running, failed, stopped | Not finished |

## Fixture matrix

Expected output is written for each row before `explain` exists.

| Case | Source | Expect |
|---|---|---|
| Verified code fix | engine fixture `fix_verified` | Tests passed, regression passed, outcome verified |
| Unverified code fix | engine fixture `fix_not_verified` | Tests passed (green), regression failed, outcome not verified |
| Tests failed | engine fixture `tests_failed` | Tests failed, regression `not_run` |
| Verified documentation fix | engine fixture `docs_verified` | Documentation checks passed, regression `not_applicable` |
| No fix | engine fixture `no_fix` | Not supported |
| No pick | engine fixture `no_pick` | Not supported |
| Withheld patch | variant | Item 3 withheld; no patch-derived text anywhere in the result |
| Patch absent, no reason | variant | Item 3 unavailable |
| Empty root cause | variant | Item 2 unavailable |
| No issue excerpt | variant | Item 1 title only |
| Missing, expired, unreadable, unavailable, older | variants | Not supported |
| Running, failed, cancelled | variants | Not supported |

Rules checked across every row:

1. Item 2 is never `passed`, green or "verified".
2. The outcome item equals `run.outcome` and `run.outcome_reason` exactly.
3. An item with no content has an explicit availability other than `available`, never filler text.
4. With a withheld patch, the serialised result contains no line of the patch.
5. `explain` does not change its input.
6. Every source names the run and resolves to fields of it; following a reference gives exactly what the item shows.
7. Logs and commands equal the recorded ones exactly; missing ones are `unavailable`; the regression row never has
   commands.
8. With a withheld patch, no source lists `report.patch`.

## Patch handling

The engine fixtures' patches are one line, so they cannot test navigation. Separate fixtures are real `git diff`
output, generated once and saved under `src/test/patches/`:

modified file with several hunks · new file · deleted file · rename with and without changes · quoted path (spaces,
non-ASCII) · no newline at end of file · CRLF content · binary file · two files changed · mode-only change.

Rules:

- The patch string received from the backend is kept untouched. Copy and download keep using it.
- Each file and hunk records its line range in that original string. Navigation targets are those line numbers.
- Tests check both that the pieces joined in order reproduce the original exactly, and that each file's name and each
  hunk's range point at the right lines.
- Conservative fallback: if any line can't be accounted for, or the patch is malformed or uses a form the parser
  doesn't support, the change is shown as one unsplit patch with no file list. Binary files are listed as "binary,
  not shown".
- File names and all report text are untrusted and rendered as text.

## View

Superseded by Part 1. The five items are not drawn as five boxes; they supply the reasoning panel, the evidence in
the inspector and the stage 3 screen.

## Tests and checks (evidence model and patch splitter; the diagram's are in Part 1, stages 1 and 6)

1. Model: the fixture matrix and the five rules above.
2. Patch: the real-git fixtures, round trip and range checks, fallback cases.
3. View: step content per fixture, keyboard activation, focus after jumping, text states, untrusted file names and
   report text, withheld patch absent from previews, copied content and link targets.
4. Size: a patch of several thousand lines stays responsive (measured, with a stated limit), not only screenshots.
5. Browser: both themes at 1280×860, 900×700, 900×500 and the narrow window; no page overflow or clipped controls.
6. Packaged app: the built installer's renderer shows the walkthrough for a fixture run.
7. Real report: compare against the existing verified run, read-only.
8. A person who hasn't seen the run page: can they say what was proven and what wasn't?

Full suite and production build pass before each reviewable change.

## Not in the evidence model

Linking the cause to lines of code and showing how the bug moves through it are the diagram's job (Part 1) and need
the engine output proposed there. The evidence model makes no model call and changes no engine, `result.json`, IPC
or backend behaviour.
