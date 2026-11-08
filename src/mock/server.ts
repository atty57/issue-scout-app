import { ApiError } from "../errors";
import type {
  Connection,
  DemoScenario,
  Feedback,
  Job,
  Me,
  Profile,
  ProfileChange,
  Project,
  Run,
  ScoutSettings,
  Suggestion,
} from "../types";
import {
  initialChanges,
  initialPast,
  initialProfile,
  initialSuggestions,
} from "./data";
import {
  completedRun,
  defaultConnections,
  defaultProjects,
  defaultSettings,
  makeReport,
} from "./workflow";
import { runStages } from "../stages";
import { profileErrors } from "../validation";

let me: Me | null;
let profile: Profile;
let changes: ProfileChange[];
let suggestions: Suggestion[];
let past: Suggestion[];
let scenario: DemoScenario;
let refreshCount = 0;
let jobs = new Map<string, { reads: number; fails: boolean }>();
let projects: Project[];
let scoutSettings: ScoutSettings;
let connections: Connection[];
let runs: Run[];
const clone = <T>(value: T): T => structuredClone(value);
export function resetMock(next: DemoScenario = "ready") {
  scenario = next;
  me =
    next === "signed_out"
      ? null
      : {
          login: "octocat",
          avatar_url: "https://avatars.githubusercontent.com/u/583231",
          onboarding:
            next === "onboarding"
              ? "needs_resume"
              : ["building", "failure"].includes(next)
                ? "building"
                : "ready",
          ...(["building", "failure"].includes(next)
            ? { job_id: "job_initial" }
            : {}),
        };
  profile = clone(initialProfile);
  changes = clone(initialChanges);
  suggestions = next === "empty" ? [] : clone(initialSuggestions);
  past = clone(initialPast);
  jobs = new Map();
  refreshCount = 0;
  projects = clone(defaultProjects);
  scoutSettings = clone(defaultSettings);
  connections = clone(defaultConnections);
  runs = [completedRun(initialSuggestions[0])];
  if (next === "delivery_failure")
    runs[0].report = makeReport(initialSuggestions[0], true, true);
  if (next === "abstained") {
    runs[0] = {
      ...runs[0],
      status: "abstained",
      stage: "pick",
      issue: undefined,
      report: undefined,
      events: [
        {
          at: runs[0].started_at,
          stage: "pick",
          message:
            "No issue cleared the confidence and evidence checks. No patch was drafted.",
        },
      ],
    };
  }
  if (next === "run_failure") {
    runs[0] = {
      ...runs[0],
      status: "failed",
      stage: "validate",
      report: undefined,
      error:
        "The runtime could not finish dependency installation. This is a setup failure, not a regression result.",
    };
  }
  if (me?.job_id) jobs.set(me.job_id, { reads: 0, fails: next === "failure" });
}
resetMock();

function validateProfile(value: Profile) {
  const fields = profileErrors(value);
  if (Object.keys(fields).length)
    throw new ApiError(422, "Check the highlighted fields.", fields);
}

export async function mockRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  await new Promise((resolve) => setTimeout(resolve, 180));
  const method = options.method || "GET";
  const body =
    typeof options.body === "string" ? JSON.parse(options.body) : undefined;
  if (scenario === "network_error" && path === "/api/me")
    throw new ApiError(
      503,
      "We could not reach Issue Scout. Please try again in a moment.",
    );
  if (path === "/auth/github/login") {
    me = {
      login: "octocat",
      avatar_url: "https://avatars.githubusercontent.com/u/583231",
      onboarding: "needs_resume",
    };
    return clone(me) as T;
  }
  if (!me) throw new ApiError(401, "Please sign in to continue.");
  let result: unknown;
  if (path === "/api/me" && method === "DELETE") {
    me = null;
    jobs.clear();
    runs = [];
    projects = [];
    suggestions = [];
    past = [];
    changes = [];
    profile = {
      ...clone(initialProfile),
      summary: "",
      skills: [],
      languages: [],
      watchlist: [],
      merged_in: [],
      updated_at: new Date().toISOString(),
    };
    scoutSettings = clone(defaultSettings);
    connections = clone(defaultConnections);
    result = undefined;
  } else if (path === "/auth/logout") {
    me = null;
    result = undefined;
  } else if (path === "/api/me") result = me;
  else if (path === "/api/projects" && method === "PUT") {
    if (
      !Array.isArray(body) ||
      body.some((item: Project) => !/^[\w.-]+\/[\w.-]+$/.test(item.repo))
    )
      throw new ApiError(422, "Use owner/repository for each project.");
    projects = clone(body);
    changes.unshift({
      at: new Date().toISOString(),
      source: "user",
      field: "projects",
      before: null,
      after: projects,
      note: "Updated projects used as evidence for matching.",
    });
    result = projects;
  } else if (path === "/api/projects") result = projects;
  else if (path === "/api/scout/settings" && method === "PUT") {
    const next = body as ScoutSettings;
    const counts = [
      "days",
      "updated_days",
      "search_pages",
      "candidate_limit",
      "max_comment_pages",
      "max_timeline_pages",
      "claim_days",
      "retry_days",
      "max_attempts",
    ] as const;
    const fields: Record<string, string> = {};
    counts.forEach((key) => {
      if (!Number.isInteger(next[key]) || next[key] < 1)
        fields[key] = "Enter a positive whole number.";
    });
    if (!Number.isFinite(next.min_score) || next.min_score < 0)
      fields.min_score = "Use a non-negative score.";
    if (
      !Number.isFinite(next.min_confidence) ||
      next.min_confidence < 0 ||
      next.min_confidence > 1
    )
      fields.min_confidence = "Use a confidence between 0 and 1.";
    if (
      next.email_enabled &&
      (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.email) ||
        !connections.find((item) => item.id === "email")?.connected)
    )
      fields.email = "Connect email delivery and enter a valid address.";
    if (
      next.tracing_enabled &&
      !connections.find((item) => item.id === "tracing")?.connected
    )
      fields.tracing_enabled = "Connect run tracing first.";
    if (
      next.draft_fixes &&
      !connections.find((item) => item.id === "solver")?.connected
    )
      fields.draft_fixes = "Connect fix drafting first.";
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(next.schedule_time))
      fields.schedule_time = "Choose a valid time.";
    try {
      Intl.DateTimeFormat(undefined, { timeZone: next.timezone });
    } catch {
      fields.timezone = "Use an IANA timezone, such as America/New_York.";
    }
    if (Object.keys(fields).length)
      throw new ApiError(422, "Check your scout settings.", fields);
    scoutSettings = clone(next);
    result = scoutSettings;
  } else if (path === "/api/scout/settings") result = scoutSettings;
  else if (path === "/api/connections") result = connections;
  else if (/^\/api\/connections\/[^/]+$/.test(path) && method === "POST") {
    const connection = connections.find(
      (item) => item.id === path.split("/").pop(),
    );
    if (!connection) throw new ApiError(404, "Connection not found.");
    connection.connected = !connection.connected;
    result = connection;
  } else if (path === "/api/runs" && method === "POST") {
    if (runs.some((run) => run.status === "running"))
      throw new ApiError(
        409,
        "A scout is already running. Open it to see progress.",
      );
    if (
      !connections.find((item) => item.id === "ranking")?.connected ||
      (scoutSettings.draft_fixes &&
        !connections.find((item) => item.id === "solver")?.connected)
    )
      throw new ApiError(
        422,
        "Connect issue evaluation and fix drafting in Scout settings before running.",
      );
    const suggestion = suggestions.find(
      (item) => item.id === body?.suggestion_id,
    );
    const run: Run = {
      id: `run_${Date.now()}`,
      status: "running",
      stage: "discover",
      started_at: new Date().toISOString(),
      suggestion_id: suggestion?.id,
      issue: suggestion?.issue,
      events: [],
    };
    runs.unshift(run);
    result = run;
  } else if (path === "/api/runs") result = runs;
  else if (/^\/api\/runs\/[^/]+(\/cancel|\/retry-delivery)?$/.test(path)) {
    const run = runs.find((item) => item.id === path.split("/")[3]);
    if (!run) throw new ApiError(404, "Scout run not found.");
    if (path.endsWith("/cancel") && method === "POST") {
      run.status = "cancelled";
      run.finished_at = new Date().toISOString();
    } else if (path.endsWith("/retry-delivery") && method === "POST") {
      if (!run.report) throw new ApiError(409, "This run has no saved report.");
      run.report.notification = {
        status: "sent",
        attempts: run.report.notification.attempts + 1,
      };
    } else if (run.status === "running") {
      const stages = runStages.filter(
        (stage) =>
          scoutSettings.draft_fixes ||
          !["solve", "validate"].includes(stage.key),
      );
      const step = stages[run.events.length];
      if (step) {
        run.stage = step.key;
        run.events.push({
          at: new Date().toISOString(),
          stage: step.key,
          message: step.detail,
        });
        if (step.key === "pick" && scenario === "abstained") {
          run.status = "abstained";
          run.finished_at = new Date().toISOString();
        }
        if (step.key === "pick") {
          const selected =
            suggestions.find((item) => item.id === run.suggestion_id) ||
            suggestions[0] ||
            clone(initialSuggestions[0]);
          run.issue = selected.issue;
          run.suggestion_id = selected.id;
        }
        if (step.key === "validate" && scenario === "run_failure") {
          run.status = "failed";
          run.error =
            "The validation environment failed during setup. No passing test result was recorded.";
          run.finished_at = new Date().toISOString();
        }
      } else {
        run.status = "completed";
        run.finished_at = new Date().toISOString();
        const selected =
          suggestions.find((item) => item.id === run.suggestion_id) ||
          initialSuggestions[0];
        if (scoutSettings.draft_fixes)
          run.report = makeReport(
            selected,
            scoutSettings.email_enabled,
            scenario === "delivery_failure",
          );
      }
    }
    result = run;
  } else if (path === "/api/resume" && method === "POST") {
    const file =
      options.body instanceof FormData
        ? (options.body.get("file") as File | null)
        : null;
    if (file && file.size > 5 * 1024 * 1024)
      throw new ApiError(413, "Your resume must be 5 MB or smaller.");
    if (file && !/\.(pdf|docx)$/i.test(file.name))
      throw new ApiError(415, "Please choose a PDF or DOCX file.");
    const id = `job_${Date.now()}`;
    jobs.set(id, { reads: 0, fails: false });
    me = { ...me, onboarding: "building", job_id: id };
    result = { job_id: id };
  } else if (path.startsWith("/api/jobs/")) {
    const id = path.split("/").pop()!;
    const job = jobs.get(id);
    if (!job) throw new ApiError(404, "This job could not be found.");
    const steps: NonNullable<Job["step"]>[] = [
      "parsing_resume",
      "reading_github",
      "extracting_profile",
      "first_suggestions",
    ];
    job.reads++;
    if (job.fails && job.reads >= 2)
      result = {
        id,
        status: "failed",
        step: "reading_github",
        error:
          "GitHub was temporarily unavailable. Please try building your profile again.",
      };
    else if (job.reads > steps.length) {
      me = { ...me, onboarding: "ready", job_id: undefined };
      result = { id, status: "done" };
    } else result = { id, status: "running", step: steps[job.reads - 1] };
  } else if (path === "/api/profile" && method === "PUT") {
    validateProfile(body);
    const before = profile;
    profile = {
      ...clone(body),
      merged_in: before.merged_in,
      updated_at: new Date().toISOString(),
    };
    changes.unshift({
      at: profile.updated_at,
      source: "user",
      field: "profile",
      before,
      after: profile,
      note: "You updated your profile. Edited skills and languages are locked.",
    });
    result = profile;
  } else if (path === "/api/profile") result = profile;
  else if (path === "/api/profile/history") result = changes;
  else if (path.startsWith("/api/suggestions?"))
    result = {
      items: path.includes("status=past")
        ? past
        : suggestions.filter((item) => !item.feedback),
      next_run_at: new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString(),
    };
  else if (path === "/api/suggestions/refresh") {
    if (scenario === "rate_limit" || refreshCount > 0)
      throw new ApiError(429, "Your scouts are taking a short break.", {}, 30);
    refreshCount++;
    const id = `refresh_${Date.now()}`;
    jobs.set(id, { reads: 0, fails: false });
    result = { job_id: id };
  } else if (/^\/api\/suggestions\/[^/]+\/feedback$/.test(path)) {
    const id = path.split("/")[3];
    const item = suggestions.find((item) => item.id === id);
    if (!item) throw new ApiError(404, "This suggestion could not be found.");
    if (method === "DELETE") {
      item.feedback = null;
      past = past.filter((item) => item.id !== id);
    } else {
      const feedback = body as Feedback;
      if (
        !["up", "down"].includes(feedback.verdict) ||
        (feedback.note?.length ?? 0) > 500
      )
        throw new ApiError(
          422,
          "Feedback notes must be 500 characters or fewer.",
        );
      item.feedback = feedback;
      past = [clone(item), ...past.filter((item) => item.id !== id)];
      changes.unshift({
        at: new Date().toISOString(),
        source: "feedback",
        field: "preferences",
        before: null,
        after: feedback,
        note: `Feedback on ${item.issue.repo}#${item.issue.number}. Locked skills stay unchanged.`,
      });
    }
    result = item;
  } else throw new ApiError(404, "This endpoint is not available.");
  return result === undefined ? (undefined as T) : (clone(result) as T);
}
