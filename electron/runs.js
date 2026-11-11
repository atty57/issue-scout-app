import { ArchiveError, LIMITS, MESSAGES, artifactView, downloadArtifact, readZip, unreadable } from "./artifacts.js";
import { GitHubError, githubRequest } from "./github.js";

// A scout run is one run of the template's daily.yml workflow, in the user's own GitHub Actions.
const WORKFLOW = "daily.yml";
const STEP_LABELS = {
  "Run actions/checkout@v7": "Checking out your Scout repository",
  "Free runner disk space": "Preparing the GitHub runner",
  "Run actions/setup-python@v7": "Setting up Python",
  "Install Scout and selected CLI backends": "Installing Scout and your model tools",
  "Run python -u scout.py": "Scouting: discovering, checking and picking an issue",
  "Upload scout report and patch": "Saving the report and patch",
};
// ponytail: GitHub only reports workflow steps, so everything before the upload counts as discovery.
const stageOf = (step) => (step?.name === "Upload scout report and patch" ? "notify" : "discover");
const valid = (run) => Number.isSafeInteger(run?.id) && typeof run.status === "string";
// daily.yml uploads each attempt's files as scout-result-<run id>-<attempt>.
const artifactOf = (run, artifacts) => (Array.isArray(artifacts) ? artifacts : []).find((item) =>
  item?.name === `scout-result-${run.id}-${run.run_attempt ?? 1}` && Number.isSafeInteger(item.id));
const SAVED_FILES = { report: "report.txt", patch: "change.patch" };
// The engine annotates each run with its email outcome (email_delivery.annotate in the template).
const DELIVERY = /^Issue Scout email: (sent|disabled|failed)(?: \(([a-z_]+)\))?$/;
const resendTitle = (id) => `Email the report from run ${id} again`; // email.yml's run-name
const RESENDING = { status: "resending", message: "Sending the saved report again. It should arrive in a minute or two." };
// GitHub normally lists a dispatched run within seconds; keep refusing new starts this long if it hasn't.
// src/pages/Runs.tsx waits the same time before offering Run again.
const LISTING_GRACE_MS = 2 * 60e3;

// Mirrors discover() in the template's scout.py: without any of these, Scout makes no searches at all.
function searchable(profile) {
  const work = Array.isArray(profile.work_types) ? profile.work_types : ["code"];
  return (work.includes("code") && profile.languages?.length > 0 && profile.labels?.length > 0)
    || (work.includes("documentation") && (profile.documentation_labels ?? ["documentation", "docs"]).length > 0)
    || profile.watchlist?.length > 0;
}

// `saved` is what the run's artifact says (artifactView in ./artifacts.js), for a finished run. Only the engine's
// result decides that no issue was picked; a missing, expired or older artifact proves nothing either way,
// and a successful workflow says nothing about whether the fix was verified.
function asRun(repo, run, jobs = [], saved) {
  const steps = jobs.flatMap((job) => (Array.isArray(job?.steps) ? job.steps : []))
    .filter((step) => typeof step?.name === "string" && step.started_at && !/^(Set up job|Complete job|Post )/.test(step.name));
  const status = run.status !== "completed" ? "running"
    : run.conclusion === "success" ? (saved?.outcome === "no_pick" ? "abstained" : "completed")
    : run.conclusion === "cancelled" ? "cancelled" : "failed";
  const failed = steps.find((step) => step.conclusion === "failure");
  const current = steps.findLast((step) => step.status !== "completed") ?? steps.at(-1);
  const events = steps.map((step) => ({ at: step.started_at, stage: stageOf(step), message: STEP_LABELS[step.name] ?? step.name }));
  if (!steps.length && status === "running") events.push({ at: run.created_at, stage: "discover", message: "Waiting for a GitHub runner" });
  return {
    id: String(run.id),
    status,
    stage: status === "completed" ? "notify" : status === "abstained" ? "pick" : stageOf(failed ?? current),
    started_at: run.run_started_at || run.created_at,
    ...(status !== "running" && run.updated_at ? { finished_at: run.updated_at } : {}),
    events,
    ...saved,
    html_url: `https://github.com/${repo}/actions/runs/${run.id}`,
    ...(status === "failed" ? {
      error: failed
        ? `The run failed at “${STEP_LABELS[failed.name] ?? failed.name}”. Open it on GitHub to see the log.`
        : "The run failed on GitHub. Open it on GitHub to see the log.",
    } : {}),
  };
}

export function createRunRoutes({ repositoryContext, readProfile, fetchImpl, sleep, saveFile }) {
  const request = (context, route, options = {}) => githubRequest(context.token, `/repos/${context.repo.full_name}${route}`, { ...options, fetchImpl });

  async function listRuns(context, query = "") {
    const data = await request(context, `/actions/workflows/${WORKFLOW}/runs?per_page=20${query}`);
    context.assertCurrent();
    return Array.isArray(data?.workflow_runs) ? data.workflow_runs.filter(valid) : [];
  }

  // The route already pins the repository; also require the Scout workflow itself.
  async function scoutRun(context, id) {
    const run = await request(context, `/actions/runs/${id}`);
    if (!valid(run) || String(run.path ?? "").split("@")[0] !== `.github/workflows/${WORKFLOW}`)
      throw new GitHubError(404, "This scout run could not be found.");
    return run;
  }

  // Artifacts never change once uploaded, so each one read is kept, keyed by repository and artifact.
  // ponytail: the last 20 in memory, each at most a few MB of text; a restart reads them again.
  const kept = new Map();
  async function savedResult(context, artifact) {
    if (!artifact) return { artifact: { status: "missing", message: MESSAGES.missing } };
    if (artifact.expired === true) return { artifact: { status: "expired", message: MESSAGES.expired } };
    const key = `${context.repo.id}:${artifact.id}`;
    if (kept.has(key)) return kept.get(key);
    let value;
    try {
      if (artifact.size_in_bytes > LIMITS.archive) throw unreadable(`it is larger than the ${LIMITS.archive / 2 ** 20} MB the app reads`);
      const archive = await downloadArtifact(context.token, `/repos/${context.repo.full_name}/actions/artifacts/${artifact.id}/zip`, { fetchImpl });
      value = artifactView(readZip(archive));
    } catch (error) {
      if (error?.status === 401) throw error;
      if (error instanceof ArchiveError) value = { artifact: { status: "unreadable", message: error.message } };
      else if (error?.status === 410) value = { artifact: { status: "expired", message: MESSAGES.expired } };
      else if (error?.status === 404) value = { artifact: { status: "missing", message: MESSAGES.missing } };
      else return { artifact: { status: "unavailable", message: MESSAGES.unavailable } }; // not kept: the next look tries again
    }
    context.assertCurrent();
    kept.set(key, value);
    if (kept.size > 20) kept.delete(kept.keys().next().value);
    return value;
  }

  async function runArtifact(context, run) {
    if (run.status !== "completed") return undefined;
    const data = await request(context, `/actions/runs/${run.id}/artifacts`);
    return savedResult(context, artifactOf(run, data?.artifacts));
  }

  async function detail(context, id) {
    const run = await scoutRun(context, id);
    const [jobs, saved] = await Promise.all([request(context, `/actions/runs/${id}/jobs?per_page=10`), runArtifact(context, run)]);
    context.assertCurrent();
    const steps = Array.isArray(jobs?.jobs) ? jobs.jobs : [];
    const value = asRun(context.repo.full_name, run, steps, saved);
    if (value.status === "running") return value;
    // A later "email again" from the app says more than the run's own attempt.
    const [again, own] = await Promise.all([resendOf(context, id), deliveryOf(context, steps)]);
    context.assertCurrent();
    const delivery = again ?? own;
    return delivery ? { ...value, delivery } : value;
  }

  // The engine's email annotation on a run's job: "Issue Scout email: <status> (<reason>)". None means no status.
  async function deliveryOf(context, jobs) {
    for (const job of jobs.filter((item) => Number.isSafeInteger(item?.id))) {
      const annotations = await request(context, `/check-runs/${job.id}/annotations?per_page=50`).catch(() => []);
      for (const annotation of Array.isArray(annotations) ? annotations : []) {
        const match = DELIVERY.exec(typeof annotation?.title === "string" ? annotation.title : "");
        if (match) return { status: match[1], ...(match[2] ? { reason: match[2] } : {}), message: String(annotation.message ?? "").slice(0, 400) };
      }
    }
    return undefined;
  }

  // email.yml runs that send this run's saved report again (named by their run-name), newest first.
  async function resendRuns(context, id) {
    const data = await request(context, "/actions/workflows/email.yml/runs?per_page=20&event=workflow_dispatch");
    return (Array.isArray(data?.workflow_runs) ? data.workflow_runs : []).filter((item) => valid(item) && item.display_title === resendTitle(id));
  }

  // The latest of those runs. A request from the app counts as sending until GitHub lists its run, for up to 2 minutes.
  async function resendOf(context, id) {
    const runs = await resendRuns(context, id).catch(() => undefined);
    const key = `${context.repo.id}:${id}`;
    const waiting = resends.get(key);
    if (waiting) {
      if (!runs?.some((run) => !waiting.known.has(run.id)) && Date.now() < waiting.until) return RESENDING;
      resends.delete(key);
    }
    const run = runs?.[0];
    if (!run) return undefined;
    if (run.status !== "completed") return RESENDING;
    const jobs = await request(context, `/actions/runs/${run.id}/jobs?per_page=10`).catch(() => undefined);
    return deliveryOf(context, Array.isArray(jobs?.jobs) ? jobs.jobs : []);
  }

  // One request for the newest artifacts rather than one per listed run, then each finished run's result,
  // four downloads at a time (kept afterwards).
  // ponytail: GitHub's newest 100 artifacts cover the 20 listed runs; a run beyond them shows as saving none.
  async function listedResults(context, runs) {
    const data = await request(context, "/actions/artifacts?per_page=100");
    const results = [];
    for (let at = 0; at < runs.length; at += 4)
      results.push(...await Promise.all(runs.slice(at, at + 4).map((run) =>
        run.status === "completed" ? savedResult(context, artifactOf(run, data?.artifacts)) : undefined)));
    return results;
  }

  // Start guards per Scout repository (keyed by GitHub's repository id). `starting` covers a start in flight.
  // `accepted` covers a dispatch that was sent (and may have been taken) but isn't listed yet, which the
  // active-run check can't see.
  // ponytail: in memory, so quitting the app forgets an unlisted dispatch; GitHub's `scout` concurrency group still queues a duplicate.
  const starting = new Set();
  const accepted = new Map(); // repository id → { known: run ids listed before the dispatch, until }
  const resends = new Map(); // "repository id:run id" → { known: its email.yml runs listed before the request, until }

  async function start(context) {
    const key = context.repo.id;
    // The engine stops at once while setup is unfinished; don't spend the user's Actions minutes on that.
    const profile = await readProfile(context);
    if (profile.setup_required) throw new GitHubError(409, "Finish setup first: save a model and key for both stages in Scout settings.");
    if (!searchable(profile))
      throw new GitHubError(409, "Your profile gives Scout nothing to search for yet. Add a language or a watchlist project in your profile, or include documentation work.");
    const before = await listRuns(context);
    const waiting = accepted.get(key);
    if (waiting && Date.now() < waiting.until && before.every((run) => waiting.known.has(run.id)))
      throw new GitHubError(409, "Your last start hasn't shown up on GitHub yet. Give it up to 2 minutes to appear in your runs before starting another.");
    accepted.delete(key);
    if (before.some((run) => run.status !== "completed")) throw new GitHubError(409, "A scout is already running. Wait for it to finish, or stop it first.");
    context.assertCurrent();
    // Recorded before sending: if GitHub takes the request but its answer is lost, a retry must still wait.
    const known = new Set(before.map((run) => run.id));
    accepted.set(key, { known, until: Date.now() + LISTING_GRACE_MS });
    try {
      await request(context, `/actions/workflows/${WORKFLOW}/dispatches`, { method: "POST", body: { ref: context.repo.default_branch } });
    } catch (error) {
      // GitHub answered with a refusal, so nothing started. No answer, a timeout or an outage may still have started a run.
      if (error instanceof GitHubError && error.status < 500) {
        accepted.delete(key);
        throw error;
      }
      return [202, { pending: true }];
    }
    // GitHub doesn't return the new run's id, so wait for it to appear in the list.
    for (let attempt = 0; attempt < 10; attempt++) {
      await sleep(1500);
      const started = (await listRuns(context, "&event=workflow_dispatch")).find((run) => !known.has(run.id));
      if (started) {
        accepted.delete(key);
        return [200, asRun(context.repo.full_name, started)];
      }
    }
    // Accepted but not listed yet: say so, and keep refusing new starts until it shows up or the grace period ends.
    return [202, { pending: true }];
  }

  return {
    "GET /api/runs": async () => {
      const context = await repositoryContext();
      const runs = await listRuns(context);
      const saved = await listedResults(context, runs);
      context.assertCurrent();
      return [200, runs.map((run, index) => asRun(context.repo.full_name, run, [], saved[index]))];
    },
    "GET /api/runs/:id": async (_, id) => [200, await detail(await repositoryContext(), id)],
    // Saves the run's report or patch where the user chooses (a save dialog in main). The page gets no file paths.
    "POST /api/runs/:id/save": async (body, id) => {
      const file = SAVED_FILES[body?.file];
      if (!file) throw new GitHubError(422, "Choose the report or the patch.");
      const context = await repositoryContext();
      const saved = await runArtifact(context, await scoutRun(context, id));
      const content = file === "report.txt" ? saved?.report?.report_text ?? saved?.artifact?.report_text : saved?.report?.patch ?? saved?.artifact?.patch;
      if (!content) throw new GitHubError(404, file === "report.txt" ? "This run has no saved report to download." : "This run has no safe patch to download.");
      context.assertCurrent();
      return [200, { saved: await saveFile({ name: `scout-run-${id}-${file}`, content }) }];
    },
    "POST /api/runs": async () => {
      const context = await repositoryContext();
      const key = context.repo.id;
      // No await between this check and the add, so concurrent requests can't both pass.
      if (starting.has(key)) throw new GitHubError(409, "A scout is already starting. It will appear in your runs in a moment.");
      starting.add(key);
      try {
        return await start(context);
      } finally {
        starting.delete(key);
      }
    },
    // Emails a finished run's saved report again through the user's email.yml, which never scouts or calls a model.
    "POST /api/runs/:id/retry-delivery": async (_, id) => {
      const context = await repositoryContext();
      const run = await detail(context, id);
      if (run.status === "running") throw new GitHubError(409, "Wait for this scout to finish first.");
      if ((await readProfile(context)).email_enabled !== true) throw new GitHubError(409, "Turn on email reports in Scout settings first.");
      const known = new Set((await resendRuns(context, id)).map((item) => item.id));
      context.assertCurrent();
      const key = `${context.repo.id}:${id}`;
      // No await between this check and the set, so concurrent requests can't both send. Recorded before sending,
      // so a lost answer still blocks another request until the run shows up or 2 minutes pass.
      if (run.delivery?.status === "resending" || Date.now() < (resends.get(key)?.until ?? 0))
        throw new GitHubError(409, "This report is already being sent again.");
      resends.set(key, { known, until: Date.now() + LISTING_GRACE_MS });
      try {
        await request(context, "/actions/workflows/email.yml/dispatches", {
          method: "POST", body: { ref: context.repo.default_branch, inputs: { task: "resend", run_id: id } },
        });
      } catch (error) {
        if (error instanceof GitHubError && error.status < 500) resends.delete(key); // refused, so nothing will run
        if (error.status === 404) throw new GitHubError(409, "Your Scout repository was created before email reports existed, so it can't send reports again.");
        throw error;
      }
      return [200, { ...run, delivery: RESENDING }];
    },
    "POST /api/runs/:id/cancel": async (_, id) => {
      const context = await repositoryContext();
      await detail(context, id); // only this repository's Scout runs can be stopped
      await request(context, `/actions/runs/${id}/cancel`, { method: "POST" });
      return [200, await detail(context, id)];
    },
  };
}
