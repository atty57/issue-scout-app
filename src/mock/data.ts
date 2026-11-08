import type { Profile, ProfileChange, Suggestion } from "../types";

export const initialProfile: Profile = {
  summary:
    "Developer working at the intersection of Python, developer tools, and AI. I enjoy tracing tricky bugs, improving async systems, and making complex ideas easier to understand.",
  skills: [
    {
      value: "Async programming",
      sources: ["resume", "octocat/async-toolkit"],
      locked: true,
    },
    {
      value: "Observability",
      sources: ["resume", "octocat/trace-lab"],
      locked: false,
    },
    { value: "Developer tooling", sources: ["github"], locked: false },
    { value: "Technical writing", sources: ["resume"], locked: false },
  ],
  languages: [
    {
      value: "python",
      sources: ["resume", "octocat/async-toolkit"],
      locked: false,
    },
    { value: "typescript", sources: ["github"], locked: false },
  ],
  work_types: ["code", "documentation"],
  watchlist: ["example-org/trace-kit", "example-org/devtools"],
  merged_in: ["example-org/async-kit"],
  scouting: {
    general_issues: true,
    min_stars: 100,
    shortlist_size: 5,
    exclude_labels: ["wontfix", "on hold"],
  },
  updated_at: "2026-10-17T15:20:00Z",
};
export const initialChanges: ProfileChange[] = [
  {
    at: "2026-10-17T15:20:00Z",
    source: "github",
    field: "skills",
    before: [],
    after: ["Developer tooling"],
    note: "New merged PR in octocat/async-toolkit.",
  },
  {
    at: "2026-10-16T14:00:00Z",
    source: "user",
    field: "skills",
    before: "Async programming (automatic)",
    after: "Async programming (locked)",
    note: "You chose to keep this skill in your profile.",
  },
  {
    at: "2026-10-15T12:00:00Z",
    source: "resume",
    field: "languages",
    before: [],
    after: ["python", "typescript"],
    note: "Extracted from your resume.",
  },
];

export const initialSuggestions: Suggestion[] = [
  {
    id: "sg_01",
    issue: {
      url: "https://github.com/example-org/trace-kit/issues/101",
      repo: "example-org/trace-kit",
      number: 101,
      title: "Span attributes are lost when exporting async generators",
      labels: ["bug", "area/tracing"],
      repo_stars: 21000,
      updated_at: "2026-10-16T09:12:00Z",
      body_excerpt:
        '### Steps to reproduce\n```python\n@trace\nasync def gen():\n    yield {"inputs": "hello"}\n```\nThe exported span should keep its `inputs` attribute after the generator closes.',
    },
    work_type: "code",
    language: "python",
    why: "Your async Python experience and observability work are a close match. This repository is also on your watchlist.",
    reason:
      "A clear reproducer, expected behavior, and a scope limited to one exporter function.",
    validation_plan:
      "Add a pytest regression test for the async-generator tracing path. Confirm span attributes survive export.",
    score: 27,
    score_components: {
      topic_fit: 13,
      language_fit: 4,
      documentation: 0,
      reproducer: 2,
      bug_label: 2,
      maintainer_signal: 4,
      familiarity: 2,
      scope: -2,
      freshness: 1,
      repo_activity: 1,
    },
    confidence: 0.82,
    ai_policy: {
      status: "disclosure",
      quote: "Please disclose any AI assistance in your PR description.",
    },
    created_at: "2026-10-17T15:41:00Z",
    feedback: null,
  },
  {
    id: "sg_02",
    issue: {
      url: "https://github.com/example-org/devtools/issues/248",
      repo: "example-org/devtools",
      number: 248,
      title: "Document how to configure a custom retry strategy",
      labels: ["documentation", "help wanted"],
      repo_stars: 8400,
      updated_at: "2026-10-17T11:00:00Z",
      body_excerpt:
        "The retry API supports custom backoff functions, but the guide only shows the defaults. Add a short, runnable TypeScript example and explain when a custom strategy helps.",
    },
    work_type: "documentation",
    language: "typescript",
    why: "Combines your technical writing skills with TypeScript in a repository you follow.",
    reason:
      "A maintainer has confirmed the missing guide. The change is one focused documentation page.",
    validation_plan:
      "Run the docs build and type-check the example against the public retry API.",
    score: 24,
    score_components: {
      topic_fit: 7,
      language_fit: 4,
      documentation: 4,
      reproducer: 0,
      bug_label: 0,
      maintainer_signal: 4,
      familiarity: 2,
      scope: 1,
      freshness: 1,
      repo_activity: 1,
    },
    confidence: 0.9,
    ai_policy: { status: "allowed", quote: "" },
    created_at: "2026-10-17T15:41:00Z",
    feedback: null,
  },
  {
    id: "sg_03",
    issue: {
      url: "https://github.com/example-org/async-kit/issues/76",
      repo: "example-org/async-kit",
      number: 76,
      title: "Handle cancellation while a worker queue is draining",
      labels: ["bug", "async"],
      repo_stars: 3200,
      updated_at: "2026-10-15T18:40:00Z",
      body_excerpt:
        "Cancelling a task during `queue.join()` leaves a pending worker. A minimal reproduction and a failing test are included in the issue.",
    },
    work_type: "code",
    language: "python",
    why: "You have contributed to this repository before, and the issue builds on your async programming experience.",
    reason:
      "Includes a failing test and maintainer guidance. The fix is isolated to queue cleanup.",
    validation_plan:
      "Extend the cancellation regression test, run the queue tests, and check for pending tasks under asyncio debug mode.",
    score: 22,
    score_components: {
      topic_fit: 7,
      language_fit: 4,
      documentation: 0,
      reproducer: 2,
      bug_label: 2,
      maintainer_signal: 2,
      familiarity: 5,
      scope: -2,
      freshness: 1,
      repo_activity: 1,
    },
    confidence: 0.78,
    ai_policy: { status: "none", quote: "" },
    created_at: "2026-10-17T15:41:00Z",
    feedback: null,
  },
];
export const initialPast: Suggestion[] = [
  {
    ...initialSuggestions[1],
    id: "sg_past_01",
    issue: {
      ...initialSuggestions[1].issue,
      title: "Add a troubleshooting guide for local development",
      number: 212,
    },
    created_at: "2026-10-14T15:30:00Z",
    feedback: { verdict: "up" },
  },
  {
    ...initialSuggestions[2],
    id: "sg_past_02",
    issue: {
      ...initialSuggestions[2].issue,
      title: "Redesign the worker scheduling subsystem",
      number: 61,
    },
    created_at: "2026-10-13T15:30:00Z",
    feedback: {
      verdict: "down",
      reasons: ["too_big"],
      note: "Looking for a smaller first contribution.",
    },
  },
];
