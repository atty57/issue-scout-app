export type Language = "python" | "javascript" | "typescript" | "csharp" | "c" | "go" | "rust" | "java" | "cpp";
export type ScoutRepository = { id: number; full_name: string; html_url: string };
export type RepositorySetup =
  | { mode: "create"; name: string }
  | { mode: "connect"; repo: string };
export type Me = {
  login: string;
  avatar_url: string;
  onboarding: "needs_repository" | "needs_resume" | "building" | "ready";
  repository?: ScoutRepository;
  repository_error?: string;
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
  revision?: string;
  supported_languages?: Language[]; // desktop: what the Scout repository's own engine runs (its scout.json)
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
  before?: unknown;
  after?: unknown;
  commit_url?: string;
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
  revision?: string;
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
// Desktop models per stage (electron/models.js). Secret values never reach the renderer, only names.
export type ModelAuth = "api-key" | "subscription";
export type ModelProvider = {
  id: string;
  label: string;
  credentials: Partial<Record<ModelAuth, string>>;
  api_key_fallback?: string;
  model: "required" | "optional";
  model_hint: string;
  base_url?: boolean;
  stages?: ("picker" | "solver")[]; // absent: usable for both stages
};
export type ModelStage = { provider: string; auth: ModelAuth; model: string; base_url: string };
export type ModelStageUpdate = ModelStage & { key: string };
export type ModelSettings = {
  providers: ModelProvider[];
  secrets: string[];
  picker: ModelStage;
  solver: ModelStage;
  ready: boolean; // setup finished and both saved stages complete (electron/models.js), so runs can start
};
// Desktop daily run (electron/schedule.js), saved as `on.schedule` in the Scout repository's daily.yml.
export type Schedule = {
  revision: string;
  enabled: boolean;
  custom: boolean; // daily.yml has a schedule the app can't show; saving replaces it
  time: string; // "HH:MM", local to `timezone`
  timezone: string; // IANA name
  setup_required: boolean;
};
export type ScheduleUpdate = Pick<Schedule, "revision" | "enabled" | "time" | "timezone">;
// Desktop email reports (electron/email.js). `available: false` when the build has no email relay configured.
export type EmailSettings =
  | { available: false }
  | {
      available: true;
      ready: boolean; // the Scout repository has the email workflow
      revision: string;
      email: string;
      enabled: boolean;
      confirmed: boolean;
      code_sent: boolean;
    };
export type EmailUpdate = { revision: string; email: string; enabled: boolean };
export type Delivery = {
  status: "sent" | "disabled" | "failed" | "resending";
  reason?: string;
  message: string;
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
// desktop: the engine's outcome from the run's result.json. Only "fix_verified" means the fix's checks passed.
export type RunOutcome = "fix_verified" | "fix_not_verified" | "no_fix" | "no_pick";
export type RunIssue = {
  url: string;
  repo: string;
  number: number;
  title: string;
  labels?: string[];
  repo_stars?: number | null;
  updated_at?: string | null;
  body_excerpt?: string;
  why?: string; // the picker's reason
  work_type?: string | null;
  language?: string | null;
  feasibility?: string | null;
  ai_policy?: { status: string; quote: string } | null;
};
// desktop: what the run's saved artifact holds, or why it can't be shown
export type RunArtifact = {
  status: "available" | "older" | "missing" | "expired" | "unreadable" | "unavailable";
  message: string;
  report_text?: string; // a saved report without a review brief (a failed fix step, or an older engine)
  patch?: string; // an older engine's saved patch
};
export type Run = {
  id: string;
  status: "running" | "completed" | "abstained" | "failed" | "cancelled";
  stage: RunStage;
  started_at: string;
  finished_at?: string;
  suggestion_id?: string;
  issue?: RunIssue;
  events: { at: string; stage: RunStage; message: string }[];
  error?: string;
  report?: RunReport;
  html_url?: string; // desktop: the workflow run on GitHub
  delivery?: Delivery; // desktop: the run's email outcome
  outcome?: RunOutcome;
  outcome_reason?: string;
  artifact?: RunArtifact;
};
// desktop: one issue the engine attempted, from state/seen.json. Absent fields weren't recorded.
export type HistoryItem = {
  url: string;
  repo: string;
  number: number;
  status: "notified" | "completed" | "failed"; // notified: verified and delivered; completed: verified, email not sent
  legacy?: boolean; // from the older URL-only history, which listed delivered issues only
  attempted_at?: string;
  attempts?: number;
  retry_after?: string;
  tests_passed?: boolean;
  reproduces?: boolean | null;
  documentation_verified?: boolean;
  work_type?: string;
  language?: string;
  score?: number;
  why?: string;
  reason?: string;
  notification?: { status: string; reason?: string; error?: string };
};
export type HistoryResponse = { items: HistoryItem[]; skipped: number };
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
  work_type?: "code" | "documentation"; // a code fix's regression check runs only once its tests pass
  runtime: string | null;
  setup_commands?: string[][];
  test_commands: string[][];
  tests_passed: boolean;
  regression_reproduced: boolean | null;
  documentation_verified?: boolean;
  validation_log: string;
  regression_log: string;
  cost_estimate: number | null; // null: the provider reported none, which isn't the same as free
  attempts: number | null; // drafting attempts
  provider?: string | null;
  patch: string | null;
  patch_withheld_reason?: string;
  report_text: string;
  notification: {
    status: "sent" | "failed" | "disabled" | "pending";
    attempts: number;
    reason?: string;
    error?: string;
  };
};
