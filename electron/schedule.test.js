import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { createBackend } from "./backend.js";

// The top of the template's daily.yml, as shipped (manual runs only).
const TEMPLATE = [
  "name: issue-scout",
  "",
  "on:",
  "  workflow_dispatch:   # manual only until you add a schedule; see README \"Schedule\"",
  "",
  "permissions:",
  "  contents: write   # commit state/seen.json",
  "",
  "concurrency: scout",
  "",
  "jobs:",
  "  scout:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - run: python -u scout.py",
  "",
].join("\n");
const SCHEDULED = (cron, zone) => TEMPLATE.replace(
  "\"Schedule\"\n",
  `"Schedule"\n  schedule:   # set by the Issue Scout app\n    - cron: "${cron}"\n      timezone: "${zone}"\n`,
);
// Swaps the template's `on:` block for other layouts of the same triggers.
const ON = "on:\n  workflow_dispatch:   # manual only until you add a schedule; see README \"Schedule\"\n";
const withOn = (...lines) => TEMPLATE.replace(ON, `${lines.join("\n")}\n`);
const profile = {
  email: "", summary: "Python developer", skills: ["async"], languages: ["python"], work_types: ["code"],
  labels: ["bug"], documentation_labels: ["docs"], watchlist: [], merged_in: [], days: 3, scouting: {},
};
const sha = (n) => String(n).padStart(40, "0");
let backend, workflow, raw, requests, serveStale, raceNextWrite, version;

const writes = () => requests.filter((request) => request.method === "PUT");
const saved = () => Buffer.from(writes().at(-1).body.content, "base64").toString("utf8");
const load = async () => (await backend("/api/schedule"))[1];
const save = (body) => backend("/api/schedule", "PUT", body);

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live requests are forbidden in offline tests."); }));
  version = 1; workflow = { text: TEMPLATE, sha: sha(version) }; raw = structuredClone(profile); requests = [];
  serveStale = false; raceNextWrite = false;
  let previous = workflow;
  const ok = (data, status = 200) => ({ ok: true, status, headers: new Headers(), json: async () => data });
  const refuse = (status, message) => ({ ok: false, status, headers: new Headers(), json: async () => ({ message }) });
  const file = ({ text, sha }) => ok({ type: "file", encoding: "base64", sha, content: Buffer.from(text).toString("base64") });
  const fetchImpl = vi.fn(async (url, options = {}) => {
    const method = options.method ?? "GET";
    const body = options.body ? JSON.parse(options.body) : undefined;
    requests.push({ url, method, body });
    const { pathname: path, searchParams } = new URL(url);
    if (path === "/user") return ok({ id: 7, login: "octocat", avatar_url: "" });
    if (path === "/repos/octocat/scout") return ok({ id: 42, full_name: "octocat/scout", owner: { id: 7 }, private: true, permissions: { admin: true }, default_branch: "main" });
    if (path.endsWith("/commits")) return ok([{ sha: "c".repeat(40), commit: { message: "Initial", committer: { date: "2026-11-08T11:00:00Z" } } }]);
    if (path.endsWith("/contents/profile.json")) return file({ text: JSON.stringify(raw), sha: "a".repeat(40) });
    if (path.endsWith("/contents/.github/workflows/daily.yml")) {
      if (method === "GET") {
        expect(searchParams.get("ref")).toBe("main");
        return file(serveStale ? previous : workflow);
      }
      if (raceNextWrite) { raceNextWrite = false; workflow = { text: `${workflow.text}# edited on GitHub\n`, sha: sha(++version) }; }
      if (body.sha !== workflow.sha) return refuse(409, `daily.yml does not match ${body.sha}`);
      previous = workflow;
      workflow = { text: Buffer.from(body.content, "base64").toString("utf8"), sha: sha(++version) };
      return ok({ content: { sha: workflow.sha }, commit: { sha: "d".repeat(40) } });
    }
    throw new Error(`Unexpected offline route: ${method} ${url}`);
  });
  backend = createBackend({
    tokens: { load: () => "private-token", clear: () => {} },
    repositories: { get: () => ({ id: 42, full_name: "octocat/scout" }) },
    fetchImpl, clientId: "public", openExternal: vi.fn(), sleep: async () => {},
  });
});
afterEach(() => vi.unstubAllGlobals());

it("shows daily runs as off for the template's manual-only workflow", async () => {
  const schedule = await load();
  expect(schedule).toMatchObject({ revision: `42:main:${sha(1)}`, enabled: false, custom: false, time: "09:30", setup_required: false });
  expect(schedule.timezone).toEqual(expect.any(String));
});

it("turns daily runs on with GitHub's time zone key and leaves the rest of daily.yml as it was", async () => {
  const [status, schedule] = await save({ revision: (await load()).revision, enabled: true, time: "07:05", timezone: "America/New_York" });
  expect(status).toBe(200);
  expect(saved()).toBe(SCHEDULED("5 7 * * *", "America/New_York"));
  expect(writes()[0].body).toMatchObject({ branch: "main", sha: sha(1), message: "Issue Scout: run daily at 07:05 America/New_York" });
  expect(schedule).toMatchObject({ revision: `42:main:${sha(2)}`, enabled: true, time: "07:05", timezone: "America/New_York" });
});

it("turns daily runs off again, restoring the file and keeping manual runs", async () => {
  const [, on] = await save({ revision: (await load()).revision, enabled: true, time: "07:05", timezone: "Europe/Berlin" });
  const [status, off] = await save({ revision: on.revision, enabled: false });
  expect(status).toBe(200);
  expect(saved()).toBe(TEMPLATE);
  expect(saved()).toContain("  workflow_dispatch:");
  expect(off).toMatchObject({ enabled: false, revision: `42:main:${sha(3)}` });
  expect(writes()[1].body.message).toBe("Issue Scout: turn off daily runs");
});

it("reads a schedule written by hand from the README, and replaces one it can't show", async () => {
  workflow.text = TEMPLATE.replace("\"Schedule\"\n", "\"Schedule\"\n  schedule:\n    - cron: \"0 9 * * *\"             # Scout starts at 09:00 every day\n      timezone: \"America/New_York\"   # keep this nested under the cron line\n");
  expect(await load()).toMatchObject({ enabled: true, custom: false, time: "09:00", timezone: "America/New_York" });
  workflow.text = TEMPLATE.replace("\"Schedule\"\n", "\"Schedule\"\n  schedule:\n    - cron: '30 5 * * 1,3'\n    - cron: '30 5,17 * * 2,4'\n");
  const custom = await load();
  expect(custom).toMatchObject({ enabled: true, custom: true });
  await save({ revision: custom.revision, enabled: true, time: "06:15", timezone: "UTC" });
  expect(saved()).toBe(SCHEDULED("15 6 * * *", "UTC"));
});

it("rejects stale or mismatched revisions without writing", async () => {
  const { revision } = await load();
  for (const stale of [`41:main:${sha(1)}`, `42:dev:${sha(1)}`, "anything"])
    expect((await save({ revision: stale, enabled: false }))[0]).toBe(409);
  workflow = { text: `${TEMPLATE}# edited on GitHub\n`, sha: sha(++version) };
  const [status, error] = await save({ revision, enabled: true, time: "07:00", timezone: "UTC" });
  expect([status, error.error]).toEqual([409, expect.stringContaining("changed on GitHub")]);
  expect(writes()).toHaveLength(0);
});

it("reports a conflict when daily.yml changes between reading and writing", async () => {
  raceNextWrite = true;
  const [status, error] = await save({ revision: (await load()).revision, enabled: true, time: "07:00", timezone: "UTC" });
  expect([status, error.error]).toEqual([409, expect.stringContaining("daily.yml changed on GitHub")]);
  expect(workflow.text).toContain("# edited on GitHub"); // the newer file was not overwritten
});

it("doesn't mistake a quick second save for a conflict while GitHub still serves the older file", async () => {
  const [, first] = await save({ revision: (await load()).revision, enabled: true, time: "07:00", timezone: "UTC" });
  serveStale = true;
  const [status, second] = await save({ revision: first.revision, enabled: true, time: "08:00", timezone: "UTC" });
  expect(status).toBe(200);
  expect(writes()[1].body.sha).toBe(sha(2));
  expect(second).toMatchObject({ time: "08:00", revision: `42:main:${sha(3)}` });
});

it("won't turn on daily runs while setup is unfinished, but can turn them off", async () => {
  raw.setup_required = true;
  workflow.text = SCHEDULED("0 9 * * *", "UTC");
  const schedule = await load();
  expect(schedule).toMatchObject({ setup_required: true, enabled: true });
  const [status, error] = await save({ ...schedule, time: "10:00" });
  expect([status, error.error]).toEqual([409, expect.stringContaining("Finish setup first")]);
  expect(writes()).toHaveLength(0);
  expect((await save({ revision: schedule.revision, enabled: false }))[0]).toBe(200);
  expect(saved()).toBe(TEMPLATE);
});

it("checks the time and IANA time zone, and keeps the local time rather than converting to UTC", async () => {
  const { revision } = await load();
  for (const timezone of ["Mars/Olympus_Mons", "america/new_york", "EST", "", "America/New_York\"\n  push:"]) {
    const [status, error] = await save({ revision, enabled: true, time: "09:30", timezone });
    expect([status, error.fields?.timezone]).toEqual([422, expect.stringContaining("time zone")]);
  }
  for (const time of ["24:00", "9:30", "09:60", undefined]) {
    const [status, error] = await save({ revision, enabled: true, time, timezone: "UTC" });
    expect([status, error.fields?.time]).toEqual([422, expect.any(String)]);
  }
  expect(writes()).toHaveLength(0);
  // India never changes clocks and is UTC+5:30; the workflow still says 09:30 in that zone.
  await save({ revision, enabled: true, time: "09:30", timezone: "Asia/Kolkata" });
  expect(saved()).toBe(SCHEDULED("30 9 * * *", "Asia/Kolkata"));
});

it("keeps Windows line endings", async () => {
  workflow.text = TEMPLATE.replace(/\n/g, "\r\n");
  const [, on] = await save({ revision: (await load()).revision, enabled: true, time: "07:00", timezone: "UTC" });
  expect(saved()).toBe(SCHEDULED("0 7 * * *", "UTC").replace(/\n/g, "\r\n"));
  expect(await load()).toMatchObject({ enabled: true, time: "07:00", timezone: "UTC" });
  await save({ revision: on.revision, enabled: false });
  expect(saved()).toBe(TEMPLATE.replace(/\n/g, "\r\n"));
});

it.each([
  ["a comment at the start of the line", ["on:", "  workflow_dispatch:", "# daily run", "  schedule:", "    - cron: \"0 9 * * *\""]],
  ["a quoted key", ["on:", "  workflow_dispatch:", "  \"schedule\":", "    - cron: \"0 9 * * *\""]],
  ["list items at the key's own indentation", ["on:", "  schedule:", "  - cron: \"0 9 * * *\"", "    timezone: \"UTC\"", "  workflow_dispatch:"]],
])("finds a schedule written with %s, and turns it off or replaces it cleanly", async (_, block) => {
  workflow.text = withOn(...block);
  const schedule = await load();
  expect(schedule).toMatchObject({ enabled: true, custom: false, time: "09:00", timezone: "UTC" });
  const [offStatus, off] = await save({ revision: schedule.revision, enabled: false });
  expect(offStatus).toBe(200);
  expect(parse(saved())).toEqual({ ...parse(TEMPLATE), on: { workflow_dispatch: null } });
  expect(off.enabled).toBe(false);
  const [onStatus] = await save({ revision: off.revision, enabled: true, time: "07:00", timezone: "UTC" });
  expect(onStatus).toBe(200);
  expect(parse(saved()).on).toEqual({ workflow_dispatch: null, schedule: [{ cron: "0 7 * * *", timezone: "UTC" }] });
});

it("reads a schedule in any layout, but won't save an edit it can't make cleanly", async () => {
  workflow.text = withOn("on:", "  { workflow_dispatch: {}, schedule: [ { cron: \"0 9 * * *\" } ] }");
  const schedule = await load();
  expect(schedule).toMatchObject({ enabled: true, custom: false, time: "09:00" });
  for (const change of [{ enabled: false }, { enabled: true, time: "07:00", timezone: "UTC" }]) {
    const [status, error] = await save({ revision: schedule.revision, ...change });
    expect([status, error.error]).toEqual([422, expect.stringContaining("Edit the schedule on GitHub")]);
  }
  expect(writes()).toHaveLength(0);
});

it("won't touch a daily.yml that isn't valid YAML", async () => {
  workflow.text = withOn("on:", "  workflow_dispatch:", "  schedule:", "    - cron: \"0 9 * * *\"", "  schedule:", "    - cron: \"0 18 * * *\"");
  const [status, error] = await backend("/api/schedule");
  expect([status, error.error]).toEqual([422, expect.stringContaining("isn't valid YAML")]);
});

it("won't edit a workflow whose triggers aren't laid out as a block", async () => {
  workflow.text = TEMPLATE.replace("on:\n  workflow_dispatch:   # manual only until you add a schedule; see README \"Schedule\"\n", "on: [workflow_dispatch]\n");
  const [status, error] = await backend("/api/schedule");
  expect([status, error.error]).toEqual([422, expect.stringContaining("can't edit")]);
});
