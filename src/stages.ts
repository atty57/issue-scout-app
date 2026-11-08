import type { RunStage } from "./types";

// Canonical pipeline stages shown in the run progress UI (engine order:
// discover → shortlist → gate → pick → revalidate → solve → notify; validate is
// surfaced separately but runs inside solve). Real app data — the mock reuses it
// for fixtures, but it must not live in the mock folder since live pages depend on it.
export const runStages: { key: RunStage; title: string; detail: string }[] = [
  {
    key: "discover",
    title: "Discover",
    detail: "Search issues for your skills, languages, and watched projects.",
  },
  {
    key: "shortlist",
    title: "Rank",
    detail: "Compare fit, freshness, scope, and repository familiarity.",
  },
  {
    key: "gate",
    title: "Check suitability",
    detail: "Check claims, linked PRs, runtimes, and AI contribution policies.",
  },
  {
    key: "pick",
    title: "Pick an issue",
    detail: "Choose one focused issue with enough evidence to proceed.",
  },
  {
    key: "revalidate",
    title: "Recheck availability",
    detail: "Check the issue again immediately before drafting.",
  },
  {
    key: "solve",
    title: "Draft a fix",
    detail: "Prepare a patch, regression test, and review brief.",
  },
  {
    key: "validate",
    title: "Validate",
    detail: "Run isolated checks and verify the test fails on unfixed code.",
  },
  {
    key: "notify",
    title: "Save & deliver",
    detail: "Save recovery files and deliver your review brief if enabled.",
  },
];
