import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createBackend } from "./backend.js";
import { engineArchive, engineFiles, streamed, zip } from "./zip-fixture.js";

const profile = {
  email: "", summary: "Python developer", skills: ["async"], languages: ["python"], work_types: ["code"],
  labels: ["bug"], documentation_labels: ["docs"], watchlist: [], merged_in: [], days: 3, scouting: {},
};
const workflowRun = (id, status, conclusion = null, extra = {}) => ({
  id, status, conclusion, event: "workflow_dispatch", path: ".github/workflows/daily.yml",
  created_at: "2026-11-08T12:00:00Z", run_started_at: "2026-11-08T12:00:05Z", updated_at: "2026-11-08T12:20:00Z", ...extra,
});
let backend, runs, steps, raw, requests, dispatched, saved, nextId, hiddenPolls, dispatchReply, annotations, emailRuns, emailDispatches, saveFile, storage;

// A run's artifact as GitHub lists it; `saved[run id]` holds its zip (or { expired }, or a declared size).
const artifactFor = (runId) => saved[runId] && {
  id: 5000 + runId, name: `scout-result-${runId}-1`, workflow_run: { id: runId },
  size_in_bytes: saved[runId].size ?? saved[runId].archive?.length ?? 0, expired: saved[runId].expired === true,
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live requests are forbidden in offline tests."); }));
  runs = []; steps = []; raw = structuredClone(profile); requests = []; dispatched = undefined; saved = {}; nextId = 900; hiddenPolls = 1; dispatchReply = "ok";
  annotations = {}; emailRuns = []; emailDispatches = []; saveFile = vi.fn(async () => true); storage = "ok";
  const ok = (data, status = 200) => ({ ok: true, status, headers: new Headers(), json: async () => data });
  const fetchImpl = vi.fn(async (url, options = {}) => {
    const method = options.method ?? "GET";
    const body = options.body ? JSON.parse(options.body) : undefined;
    requests.push({ url, method, body, headers: options.headers });
    // Signed artifact storage, outside GitHub's API.
    if (url.startsWith("https://storage.example.net/")) {
      const runId = Number(url.match(/\/(\d+)\.zip/)[1]) - 5000;
      if (storage === "down" && saved[runId].down) return { ok: false, status: 503, headers: new Headers() };
      return { ok: true, status: 200, headers: new Headers(), body: streamed(saved[runId].archive) };
    }
    const { pathname: path, searchParams } = new URL(url);
    const download = path.match(/^\/repos\/octocat\/scout\/actions\/artifacts\/(\d+)\/zip$/);
    if (download) return { ok: false, status: 302, headers: new Headers({ location: `https://storage.example.net/${download[1]}.zip?sig=signed` }) };
    if (path === "/user") return ok({ id: 7, login: "octocat", avatar_url: "" });
    if (path === "/repos/octocat/scout") return ok({ id: 42, full_name: "octocat/scout", owner: { id: 7 }, private: true, permissions: { admin: true }, default_branch: "main" });
    if (path.endsWith("/commits")) return ok([{ sha: "c".repeat(40), commit: { message: "Initial", committer: { date: "2026-11-08T11:00:00Z" } } }]);
    if (path.endsWith("/contents/profile.json")) return ok({ type: "file", encoding: "base64", sha: "a".repeat(40), content: Buffer.from(JSON.stringify(raw)).toString("base64") });
    if (path.endsWith("/actions/workflows/daily.yml/runs")) {
      // A dispatched run shows up in the list after `hiddenPolls` polls (one, as on GitHub most of the time).
      if (dispatched && searchParams.get("event") === "workflow_dispatch" && dispatched.polls++ >= hiddenPolls) runs.unshift(dispatched.run), dispatched = undefined;
      return ok({ total_count: runs.length, workflow_runs: runs });
    }
    if (path.endsWith("/actions/workflows/daily.yml/dispatches")) {
      if (dispatchReply === "refused") return { ok: false, status: 422, headers: new Headers(), json: async () => ({ message: "Workflow does not have 'workflow_dispatch' trigger" }) };
      dispatched = { polls: 0, run: workflowRun(nextId++, "queued") };
      if (dispatchReply === "lost") throw new TypeError("fetch failed"); // GitHub took it, but its answer never arrived
      if (dispatchReply === "outage") return { ok: false, status: 502, headers: new Headers(), json: async () => ({}) };
      return ok(null, 204);
    }
    if (path.endsWith("/actions/workflows/email.yml/runs")) return ok({ workflow_runs: emailRuns });
    if (path.endsWith("/actions/workflows/email.yml/dispatches")) {
      if (dispatchReply === "refused") return { ok: false, status: 422, headers: new Headers(), json: async () => ({ message: "Unexpected inputs" }) };
      emailDispatches.push(body);
      if (dispatchReply === "lost") throw new TypeError("fetch failed");
      return ok(null, 204);
    }
    if (path.includes("/check-runs/")) return ok(annotations[Number(path.match(/check-runs\/(\d+)/)[1])] ?? []);
    const id = Number(path.match(/\/actions\/runs\/(\d+)/)?.[1]);
    const run = runs.find((item) => item.id === id);
    if (path.endsWith("/cancel")) { Object.assign(run, { status: "completed", conclusion: "cancelled" }); return ok({}, 202); }
    if (path.endsWith("/jobs")) return ok({ jobs: [{ id: 7000 + id, steps }] }); // a job's ID is its check run's ID
    if (path.endsWith("/repos/octocat/scout/actions/artifacts")) return ok({ artifacts: Object.keys(saved).map((runId) => artifactFor(Number(runId))) });
    if (path.endsWith("/artifacts")) return ok({ total_count: saved[id] ? 1 : 0, artifacts: saved[id] ? [artifactFor(id)] : [] });
    if (run) return ok(run);
    throw new Error(`Unexpected offline route: ${method} ${url}`);
  });
  backend = createBackend({
    tokens: { load: () => "private-token", clear: () => {} },
    repositories: { get: () => ({ id: 42, full_name: "octocat/scout" }) },
    fetchImpl, clientId: "public", openExternal: vi.fn(), sleep: async () => {}, saveFile: (file) => saveFile(file),
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("lists the scout workflow's runs with the app's statuses and links", async () => {
  runs = [workflowRun(5, "queued"), workflowRun(4, "in_progress"), workflowRun(3, "completed", "success"), workflowRun(2, "completed", "failure"), workflowRun(1, "completed", "cancelled")];
  saved = { 3: { archive: engineArchive("fix_verified") } };
  const [status, list] = await backend("/api/runs");
  expect(status).toBe(200);
  expect(list.map((run) => [run.id, run.status])).toEqual([["5", "running"], ["4", "running"], ["3", "completed"], ["2", "failed"], ["1", "cancelled"]]);
  expect(list[2]).toMatchObject({ html_url: "https://github.com/octocat/scout/actions/runs/3", started_at: "2026-11-08T12:00:05Z", finished_at: "2026-11-08T12:20:00Z" });
});

it("shows a run's workflow steps as activity and names the step that failed", async () => {
  runs = [workflowRun(2, "completed", "failure")];
  steps = [
    { name: "Set up job", status: "completed", conclusion: "success", started_at: "2026-11-08T12:00:05Z" },
    { name: "Free runner disk space", status: "completed", conclusion: "success", started_at: "2026-11-08T12:00:10Z" },
    { name: "Run python -u scout.py", status: "completed", conclusion: "failure", started_at: "2026-11-08T12:02:00Z" },
    { name: "Upload scout report and patch", status: "completed", conclusion: "success", started_at: "2026-11-08T12:19:00Z" },
  ];
  const [, run] = await backend("/api/runs/2");
  expect(run.events.map((event) => event.message)).toEqual(["Preparing the GitHub runner", "Scouting: discovering, checking and picking an issue", "Saving the report and patch"]);
  expect(run).toMatchObject({ status: "failed", stage: "discover", error: expect.stringContaining("Scouting: discovering") });
});

it("shows a queued run as waiting for a runner", async () => {
  runs = [workflowRun(6, "queued")];
  const [, run] = await backend("/api/runs/6");
  expect(run).toMatchObject({ status: "running", stage: "discover", events: [{ message: "Waiting for a GitHub runner" }] });
});

it("won't open or stop runs of other workflows, or ids that aren't numbers", async () => {
  runs = [workflowRun(7, "in_progress", null, { path: ".github/workflows/other.yml" })];
  expect((await backend("/api/runs/7"))[0]).toBe(404);
  expect((await backend("/api/runs/7/cancel", "POST"))[0]).toBe(404);
  expect(requests.some((request) => request.url.endsWith("/cancel"))).toBe(false);
  requests = [];
  expect((await backend("/api/runs/..%2Fsecrets"))[0]).toBe(501);
  expect(requests).toHaveLength(0);
});

it("starts the scout workflow on the default branch and returns the new run", async () => {
  runs = [workflowRun(3, "completed", "success")];
  const [status, run] = await backend("/api/runs", "POST", {});
  expect(status).toBe(200);
  expect(run).toMatchObject({ id: "900", status: "running" });
  const dispatch = requests.find((request) => request.url.endsWith("/dispatches"));
  expect(dispatch).toMatchObject({ method: "POST", body: { ref: "main" } });
  expect(requests.filter((request) => request.url.endsWith("/dispatches"))).toHaveLength(1);
});

it("dispatches once when two starts arrive together", async () => {
  const results = await Promise.all([backend("/api/runs", "POST", {}), backend("/api/runs", "POST", {})]);
  expect(results.map(([status]) => status).sort()).toEqual([200, 409]);
  expect(results.find(([status]) => status === 409)[1].error).toContain("already starting");
  expect(requests.filter((request) => request.url.endsWith("/dispatches"))).toHaveLength(1);
  runs[0].status = "completed"; runs[0].conclusion = "success"; // the lock is released once a start settles
  expect((await backend("/api/runs", "POST", {}))[0]).toBe(200);
});

const dispatches = () => requests.filter((request) => request.url.endsWith("/dispatches"));

it("waits for a run GitHub accepted but hasn't listed, without dispatching another", async () => {
  hiddenPolls = Infinity;
  expect(await backend("/api/runs", "POST", {})).toEqual([202, { pending: true }]);
  const [status, error] = await backend("/api/runs", "POST", {});
  expect([status, error.error]).toEqual([409, expect.stringContaining("hasn't shown up on GitHub yet")]);
  runs.unshift(dispatched.run); // GitHub lists it at last, still queued
  const [later, active] = await backend("/api/runs", "POST", {});
  expect([later, active.error]).toEqual([409, expect.stringContaining("already running")]);
  expect(dispatches()).toHaveLength(1);
});

it.each(["lost", "outage"])("doesn't dispatch again when GitHub took the start but its answer was %s", async (reply) => {
  dispatchReply = reply;
  expect(await backend("/api/runs", "POST", {})).toEqual([202, { pending: true }]);
  dispatchReply = "ok";
  const [status, error] = await backend("/api/runs", "POST", {});
  expect([status, error.error]).toEqual([409, expect.stringContaining("hasn't shown up on GitHub yet")]);
  expect(dispatches()).toHaveLength(1);
});

it("lets you start again at once when GitHub refuses the start", async () => {
  dispatchReply = "refused";
  const [status, error] = await backend("/api/runs", "POST", {});
  expect([status, error.error]).toEqual([422, expect.stringContaining("workflow_dispatch")]);
  dispatchReply = "ok";
  expect((await backend("/api/runs", "POST", {}))[0]).toBe(200);
  expect(dispatches()).toHaveLength(2);
});

it("allows a new start once an unlisted dispatch's grace period ends", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  hiddenPolls = Infinity;
  expect((await backend("/api/runs", "POST", {}))[0]).toBe(202);
  vi.setSystemTime(Date.now() + 2 * 60e3 - 1000);
  expect((await backend("/api/runs", "POST", {}))[0]).toBe(409);
  vi.setSystemTime(Date.now() + 2000);
  expect((await backend("/api/runs", "POST", {}))[0]).toBe(202);
  expect(dispatches()).toHaveLength(2);
});

it("won't start while setup is unfinished or another scout is running", async () => {
  raw.setup_required = true;
  const [status, error] = await backend("/api/runs", "POST", {});
  expect([status, error.error]).toEqual([409, expect.stringContaining("Finish setup first")]);
  delete raw.setup_required;
  runs = [workflowRun(4, "in_progress")];
  expect((await backend("/api/runs", "POST", {}))[0]).toBe(409);
  expect(requests.some((request) => request.url.endsWith("/dispatches"))).toBe(false);
});

it("classifies finished runs by the engine's saved outcome, never by the workflow's success or an artifact's presence", async () => {
  runs = [11, 12, 13, 14, 15, 16].map((id) => workflowRun(id, "completed", "success", { updated_at: new Date().toISOString() }))
    .concat(workflowRun(17, "completed", "failure"), workflowRun(18, "in_progress"));
  saved = {
    11: { archive: engineArchive("no_pick") }, 12: { archive: engineArchive("fix_verified") },
    13: { archive: engineArchive("fix_not_verified") }, 14: { archive: engineArchive("no_fix") },
    16: { expired: true }, 17: { archive: engineArchive("no_pick") },
  };
  const [, list] = await backend("/api/runs");
  expect(list.map((run) => [run.id, run.status, run.outcome, run.artifact?.status])).toEqual([
    ["11", "abstained", "no_pick", "available"],
    ["12", "completed", "fix_verified", "available"],
    ["13", "completed", "fix_not_verified", "available"], // the workflow succeeded; the fix still isn't verified
    ["14", "completed", "no_fix", "available"],
    ["15", "completed", undefined, "missing"], // no artifact no longer means nothing was picked
    ["16", "completed", undefined, "expired"],
    ["17", "failed", "no_pick", "available"],
    ["18", "running", undefined, undefined],
  ]);
  expect(list[0]).toMatchObject({ stage: "pick", outcome_reason: expect.stringContaining("No issue was picked") });
  expect(list[1].issue).toMatchObject({ repo: "acme/core", number: 3, title: "Pydantic validation returns wrong result for nested input" });
  // Each archive is fetched from storage once, without the GitHub token, and kept.
  const fetched = () => requests.filter((request) => request.url.startsWith("https://storage.example.net/"));
  expect(fetched()).toHaveLength(5);
  expect(fetched().every((request) => !JSON.stringify(request.headers ?? {}).includes("private-token"))).toBe(true);
  await backend("/api/runs");
  await backend("/api/runs/12");
  expect(fetched()).toHaveLength(5);
});

it("opens a run's saved issue, review brief, validation evidence and patch", async () => {
  runs = [workflowRun(12, "completed", "success"), workflowRun(13, "completed", "success"), workflowRun(14, "completed", "success")];
  saved = { 12: { archive: engineArchive("fix_verified") }, 13: { archive: engineArchive("fix_not_verified") }, 14: { archive: engineArchive("no_fix") } };
  const [, verified] = await backend("/api/runs/12");
  expect(verified).toMatchObject({ status: "completed", outcome: "fix_verified", issue: { url: "https://github.com/acme/core/issues/3", labels: ["bug"] } });
  expect(verified.report).toMatchObject({ tests_passed: true, regression_reproduced: true, runtime: "python312", attempts: 1, cost_estimate: null,
    test_commands: [["python", "-m", "pytest", "tests/test_validation.py"]], root_cause: "Review detail" });
  expect(verified.report.patch).toBe(engineFiles("fix_verified")["change.patch"]);
  expect(verified.report.report_text).toBe(engineFiles("fix_verified")["report.txt"]);
  const [, unproven] = await backend("/api/runs/13");
  expect(unproven).toMatchObject({ status: "completed", outcome: "fix_not_verified", report: { tests_passed: true, regression_reproduced: false } });
  const [, failed] = await backend("/api/runs/14");
  expect(failed).toMatchObject({ outcome: "no_fix", outcome_reason: expect.stringContaining("claude-code failed"), issue: { number: 2 } });
  expect(failed.report).toBeUndefined();
  expect(failed.artifact.report_text).toContain("No fix this time");
});

it("explains older, unreadable, unsafe or unavailable artifacts without guessing an outcome", async () => {
  runs = [21, 22, 23, 24, 25].map((id) => workflowRun(id, "completed", "success"));
  const { "result.json": _, ...older } = engineFiles("fix_verified");
  const newer = JSON.stringify({ ...JSON.parse(engineFiles("no_pick")["result.json"]), schema_version: 2 });
  saved = {
    21: { archive: zip(Object.entries(older).map(([name, content]) => ({ name, content }))) },
    22: { archive: zip([{ name: "result.json", content: newer }]) },
    23: { archive: zip([{ name: "../result.json", content: engineFiles("no_pick")["result.json"] }]) },
    24: { archive: engineArchive("no_pick"), size: 9 * 2 ** 20 },
    25: { archive: engineArchive("no_pick"), down: true },
  };
  storage = "down";
  const [, list] = await backend("/api/runs");
  expect(list.map((run) => [run.status, run.outcome, run.artifact.status])).toEqual([
    ["completed", undefined, "older"], ["completed", undefined, "unreadable"], ["completed", undefined, "unreadable"],
    ["completed", undefined, "unreadable"], ["completed", undefined, "unavailable"]]);
  expect(list.map((run) => run.artifact.message)).toEqual([
    expect.stringContaining("older Scout engine"), expect.stringContaining("newer Scout engine"), expect.stringContaining("unsafe file path"),
    expect.stringContaining("larger than"), expect.stringContaining("Try again")]);
  expect(requests.filter((request) => request.url.includes("/artifacts/5024/zip"))).toHaveLength(0); // too large to fetch at all
  storage = "ok";
  saved = { 21: saved[21], 25: saved[25] };
  const [, again] = await backend("/api/runs/25"); // an unavailable download is tried again, not remembered
  expect(again).toMatchObject({ status: "abstained", outcome: "no_pick" });
  expect((await backend("/api/runs/21"))[1].artifact).toMatchObject({ status: "older", report_text: older["report.txt"], patch: older["change.patch"] });
});

it("won't show or save a patch the engine withheld, even if its result also names one", async () => {
  runs = [workflowRun(31, "completed", "success")];
  const contradictory = JSON.stringify({ ...JSON.parse(engineFiles("fix_not_verified")["result.json"]), patch_withheld_reason: "github token matched in the output." });
  saved = { 31: { archive: engineArchive("fix_not_verified", { "result.json": contradictory }) } };
  const [, run] = await backend("/api/runs/31");
  expect(run).toMatchObject({ status: "completed", artifact: { status: "unreadable", message: expect.stringContaining("also withheld") } });
  expect(run.report).toBeUndefined();
  expect(run.artifact).not.toHaveProperty("patch");
  expect(await backend("/api/runs/31/save", "POST", { file: "patch" })).toEqual([404, { error: "This run has no safe patch to download." }]);
  expect(saveFile).not.toHaveBeenCalled();
});

it("saves a run's report or patch through main's save dialog", async () => {
  runs = [workflowRun(12, "completed", "success"), workflowRun(14, "completed", "success")];
  saved = { 12: { archive: engineArchive("fix_verified") }, 14: { archive: engineArchive("no_fix") } };
  expect(await backend("/api/runs/12/save", "POST", { file: "patch" })).toEqual([200, { saved: true }]);
  expect(saveFile).toHaveBeenLastCalledWith({ name: "scout-run-12-change.patch", content: engineFiles("fix_verified")["change.patch"] });
  expect(await backend("/api/runs/14/save", "POST", { file: "report" })).toEqual([200, { saved: true }]);
  expect(saveFile).toHaveBeenLastCalledWith({ name: "scout-run-14-report.txt", content: engineFiles("no_fix")["report.txt"] });
  saveFile.mockResolvedValueOnce(false); // the user closed the dialog
  expect(await backend("/api/runs/12/save", "POST", { file: "report" })).toEqual([200, { saved: false }]);
  expect(await backend("/api/runs/14/save", "POST", { file: "patch" })).toEqual([404, { error: "This run has no safe patch to download." }]);
  expect((await backend("/api/runs/12/save", "POST", { file: "../../result.json" }))[0]).toBe(422);
  expect(saveFile).toHaveBeenCalledTimes(3);
});

it("won't start when the profile gives Scout nothing to search for", async () => {
  Object.assign(raw, { languages: [], watchlist: [], work_types: ["code"] });
  const [status, error] = await backend("/api/runs", "POST", {});
  expect([status, error.error]).toEqual([409, expect.stringContaining("nothing to search for")]);
  raw.watchlist = ["example/project"];
  expect((await backend("/api/runs", "POST", {}))[0]).toBe(200);
  expect(requests.filter((request) => request.url.endsWith("/dispatches"))).toHaveLength(1);
});

it("stops a running scout", async () => {
  runs = [workflowRun(4, "in_progress")];
  const [status, run] = await backend("/api/runs/4/cancel", "POST");
  expect(status).toBe(200);
  expect(run.status).toBe("cancelled");
  expect(requests.find((request) => request.url.endsWith("/actions/runs/4/cancel")).method).toBe("POST");
});

it("shows a finished run's email outcome from the engine's annotation", async () => {
  runs = [workflowRun(3, "completed", "success")];
  saved = { 3: { archive: engineArchive("fix_verified") } };
  annotations[7003] = [{ title: "Lint", message: "unrelated" }, { title: "Issue Scout email: failed (quota)", message: "Issue Scout's shared email quota is used up for now." }];
  const [, run] = await backend("/api/runs/3");
  expect(run.delivery).toEqual({ status: "failed", reason: "quota", message: "Issue Scout's shared email quota is used up for now." });
  annotations[7003] = [];
  expect((await backend("/api/runs/3"))[1]).not.toHaveProperty("delivery"); // older runs have no email outcome
});

it("emails a finished run's saved report again through the email workflow, never a new scout", async () => {
  runs = [workflowRun(3, "completed", "success")];
  Object.assign(raw, { email: "dev@example.com", email_enabled: true });
  const [status, run] = await backend("/api/runs/3/retry-delivery", "POST");
  expect([status, run.id, run.delivery.status]).toEqual([200, "3", "resending"]);
  expect(emailDispatches).toEqual([{ ref: "main", inputs: { task: "resend", run_id: "3" } }]);
  expect(requests.some((request) => request.url.endsWith("/daily.yml/dispatches"))).toBe(false);
  // While that runs, the run shows it and won't start another; then its own outcome replaces the original one.
  emailRuns = [{ id: 950, status: "in_progress", display_title: "Email the report from run 3 again" }];
  expect((await backend("/api/runs/3"))[1].delivery.status).toBe("resending");
  expect((await backend("/api/runs/3/retry-delivery", "POST"))[1].error).toContain("already being sent again");
  Object.assign(emailRuns[0], { status: "completed", conclusion: "success" });
  annotations[7950] = [{ title: "Issue Scout email: sent", message: "Your report was emailed." }];
  expect((await backend("/api/runs/3"))[1].delivery).toEqual({ status: "sent", message: "Your report was emailed." });
  expect(emailDispatches).toHaveLength(1);
});

it("shows a report as being sent again before GitHub lists that send, and asks for it only once", async () => {
  runs = [workflowRun(3, "completed", "success")];
  Object.assign(raw, { email: "dev@example.com", email_enabled: true });
  annotations[7003] = [{ title: "Issue Scout email: failed (unavailable)", message: "Email was unavailable." }];
  // An earlier send-again already finished; its outcome must not stand in for the new request.
  emailRuns = [{ id: 940, status: "completed", conclusion: "success", display_title: "Email the report from run 3 again" }];
  annotations[7940] = [{ title: "Issue Scout email: failed (unavailable)", message: "Still unavailable." }];
  const replies = await Promise.all([1, 2].map(() => backend("/api/runs/3/retry-delivery", "POST")));
  expect(replies.map(([status]) => status).sort()).toEqual([200, 409]);
  expect((await backend("/api/runs/3"))[1].delivery.status).toBe("resending"); // not listed yet
  expect((await backend("/api/runs/3/retry-delivery", "POST"))[0]).toBe(409);
  emailRuns.unshift({ id: 951, status: "completed", conclusion: "success", display_title: "Email the report from run 3 again" });
  annotations[7951] = [{ title: "Issue Scout email: sent", message: "Your report was emailed." }];
  expect((await backend("/api/runs/3"))[1].delivery).toEqual({ status: "sent", message: "Your report was emailed." });
  expect(emailDispatches).toHaveLength(1);
});

it("after a lost send-again answer, waits for GitHub to list it or 2 minutes before allowing another", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  runs = [workflowRun(3, "completed", "success")];
  Object.assign(raw, { email: "dev@example.com", email_enabled: true });
  annotations[7003] = [{ title: "Issue Scout email: failed (unavailable)", message: "Email was unavailable." }];
  dispatchReply = "refused";
  expect((await backend("/api/runs/3/retry-delivery", "POST"))[0]).toBe(422);
  expect((await backend("/api/runs/3"))[1].delivery.status).toBe("failed"); // refused, so nothing is sending
  dispatchReply = "lost";
  expect((await backend("/api/runs/3/retry-delivery", "POST"))[0]).toBe(502);
  expect((await backend("/api/runs/3"))[1].delivery.status).toBe("resending"); // GitHub may have taken it
  expect((await backend("/api/runs/3/retry-delivery", "POST"))[0]).toBe(409);
  vi.setSystemTime(Date.now() + 2 * 60e3 + 1000); // never showed up
  expect((await backend("/api/runs/3"))[1].delivery.status).toBe("failed");
  dispatchReply = "ok";
  expect((await backend("/api/runs/3/retry-delivery", "POST"))[0]).toBe(200);
  expect(emailDispatches).toHaveLength(2);
});

it("won't email a report again while email is off or the run is still going", async () => {
  runs = [workflowRun(3, "completed", "success"), workflowRun(4, "in_progress")];
  expect((await backend("/api/runs/3/retry-delivery", "POST"))[1].error).toContain("Turn on email reports");
  Object.assign(raw, { email: "dev@example.com", email_enabled: true });
  expect((await backend("/api/runs/4/retry-delivery", "POST"))[1].error).toContain("finish");
  expect(emailDispatches).toHaveLength(0);
});
