export type Language = "python" | "javascript" | "typescript" | "csharp" | "c";
export type Me = {
  login: string;
  avatar_url: string;
  onboarding: "needs_resume" | "building" | "ready";
  job_id?: string;
};
export type Job = {
  id: string;
  status: "queued" | "running" | "done" | "failed";
  step?:
    | "parsing_resume"
    | "reading_github"
    | "extracting_profile"
    | "first_suggestions";
  error?: string;
};
export type Sourced<T> = { value: T; sources: string[]; locked: boolean };
export type Profile = {
  summary: string;
  skills: Sourced<string>[];
  languages: Sourced<Language>[];
  work_types: ("code" | "documentation")[];
  watchlist: string[];
  merged_in: string[];
  scouting: {
    general_issues: boolean;
    min_stars: number;
    shortlist_size: number;
    exclude_labels: string[];
  };
  updated_at: string;
};
export type ProfileChange = {
  at: string;
  source: "resume" | "github" | "feedback" | "user";
  field: string;
  before: unknown;
  after: unknown;
  note?: string;
};
export type FeedbackReason =
  | "not_my_skills"
  | "too_big"
  | "repo_not_interesting"
  | "already_taken"
  | "unclear_issue"
  | "other";
export type Feedback = {
  verdict: "up" | "down";
  reasons?: FeedbackReason[];
  note?: string;
};
export type Suggestion = {
  id: string;
  issue: {
    url: string;
    repo: string;
    number: number;
    title: string;
    labels: string[];
    repo_stars: number;
    updated_at: string;
    body_excerpt: string;
  };
  work_type: "code" | "documentation";
  language: Language | "none";
  why: string;
  reason: string;
  validation_plan: string;
  score: number;
  score_components: Record<
    | "topic_fit"
    | "language_fit"
    | "documentation"
    | "reproducer"
    | "bug_label"
    | "maintainer_signal"
    | "familiarity"
    | "scope"
    | "freshness"
    | "repo_activity",
    number
  >;
  confidence: number;
  ai_policy: { status: "none" | "allowed" | "disclosure"; quote: string };
  created_at: string;
  feedback: Feedback | null;
};
export type SuggestionResponse = {
  items: Suggestion[];
  next_run_at: string | null;
  setup_required?: string[];
  last_error?: string;
};
export type DemoScenario =
  | "ready"
  | "signed_out"
  | "onboarding"
  | "building"
  | "failure"
  | "empty"
  | "rate_limit"
  | "network_error"
  | "delivery_failure"
  | "abstained"
  | "run_failure";

// Public-product extensions beyond the original recommendation-only brief.
export type Project = {
  id: string;
  repo: string;
  description: string;
  language: Language | "none";
  use_as_evidence: boolean;
  topics: string[];
};
export type ScoutSettings = {
  days: number;
  updated_days: number;
  search_pages: number;
  candidate_limit: number;
  max_comment_pages: number;
  max_timeline_pages: number;
  claim_days: number;
  retry_days: number;
  max_attempts: number;
  min_score: number;
  min_confidence: number;
  labels: string[];
  documentation_labels: string[];
  skill_aliases: Record<string, string[]>;
  schedule_enabled: boolean;
  schedule_time: string;
  timezone: string;
  draft_fixes: boolean;
  email_enabled: boolean;
  email: string;
  tracing_enabled: boolean;
};
export type Connection = {
  id: "github" | "solver" | "ranking" | "email" | "tracing";
  name: string;
  detail: string;
  connected: boolean;
  required: boolean;
};
export type RunStage =
  | "discover"
  | "shortlist"
  | "gate"
  | "pick"
  | "revalidate"
  | "solve"
  | "validate"
  | "notify";
export type Run = {
  id: string;
  status: "running" | "completed" | "abstained" | "failed" | "cancelled";
  stage: RunStage;
  started_at: string;
  finished_at?: string;
  suggestion_id?: string;
  issue?: Suggestion["issue"];
  events: { at: string; stage: RunStage; message: string }[];
  error?: string;
  report?: RunReport;
};
export type RunReport = {
  root_cause: string;
  approach: string;
  risks: string;
  not_verified: string;
  maintainer_questions: string[];
  checklist: string[];
  claim_comment: string;
  commit_message: string;
  pr_title: string;
  pr_body: string;
  runtime: string;
  test_commands: string[][];
  tests_passed: boolean;
  regression_reproduced: boolean | null;
  validation_log: string;
  regression_log: string;
  cost_estimate: number;
  attempts: number;
  patch: string | null;
  patch_withheld_reason?: string;
  report_text: string;
  notification: {
    status: "sent" | "failed" | "disabled";
    attempts: number;
    error?: string;
  };
};
