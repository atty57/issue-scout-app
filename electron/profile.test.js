import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createBackend } from "./backend.js";

const initial = {
  setup_required: true, email: "existing@example.com", summary: "Python developer",
  skills: ["async"], languages: ["C#", "python"], work_types: ["code"],
  skill_aliases: { async: ["asynchronous"] }, labels: ["bug"], documentation_labels: ["docs"],
  watchlist: ["example/project"], merged_in: ["example/merged"], days: 3,
  scouting: { candidate_limit: 30, min_stars: 200, future_setting: "keep" },
};
const oldSha = "a".repeat(40), newSha = "b".repeat(40), commitSha = "c".repeat(40);
let backend, raw, sha, requests, token, pending, fetchImpl, manifest;
// The template's scout.json, as a newer Scout repository has it.
const NEW_ENGINE = JSON.stringify({ manifest_version: 1, languages: ["python", "javascript", "typescript", "csharp", "c", "go", "rust", "java", "cpp"], work_types: ["code", "documentation"] });

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live requests are forbidden in offline tests."); }));
  raw = structuredClone(initial); sha = oldSha; requests = []; token = "private-token"; pending = undefined; manifest = undefined;
  fetchImpl = vi.fn(async (url, options = {}) => {
    requests.push({ url, ...options });
    let data;
    if (url.endsWith("/user")) data = { id: 7, login: "octocat", avatar_url: "" };
    else if (url.endsWith("/repos/octocat/scout")) data = { id: 42, full_name: "octocat/scout", owner: { id: 7 }, private: true, permissions: { admin: true }, default_branch: "custom/branch" };
    else if (url.includes("/commits?")) data = [{ sha: commitSha, author: { login: "octocat" }, commit: { message: "Update profile", committer: { date: "2026-11-08T12:00:00Z" } } }];
    else if (url.includes("/contents/profile.json") && options.method === "PUT") {
      if (pending) await pending;
      const body = JSON.parse(options.body);
      if (body.sha !== sha) return { ok: false, status: 409, headers: new Headers() };
      raw = JSON.parse(Buffer.from(body.content, "base64").toString("utf8")); sha = newSha;
      data = { content: { sha }, commit: { sha: "d".repeat(40), committer: { date: "2026-11-08T12:01:00Z" } } };
    } else if (url.includes("/contents/profile.json")) data = { type: "file", encoding: "base64", sha, content: Buffer.from(JSON.stringify(raw)).toString("base64") };
    else if (url.includes("/contents/scout.json")) {
      if (manifest === undefined) return { ok: false, status: 404, headers: new Headers(), json: async () => ({ message: "Not Found" }) };
      data = { type: "file", encoding: "base64", content: Buffer.from(manifest).toString("base64") };
    } else if (url.includes("/contents/")) data = { type: "file" };
    else throw new Error(`Unexpected offline route: ${url}`);
    return { ok: true, status: 200, headers: new Headers(), json: async () => data };
  });
  backend = createBackend({
    tokens: { load: () => token, clear: () => { token = null; } },
    repositories: { get: () => ({ id: 42, full_name: "octocat/scout" }) },
    fetchImpl, clientId: "public", openExternal: vi.fn(),
  });
});
afterEach(() => vi.unstubAllGlobals());

async function profile() {
  const [status, result] = await backend("/api/profile");
  expect(status).toBe(200);
  return result;
}
async function settings() {
  const [status, result] = await backend("/api/scout/settings");
  expect(status).toBe(200);
  return result;
}

it("reuses the sign-in and skips Scout file checks across profile routes", async () => {
  await profile();
  await settings();
  await backend("/api/profile/history");
  expect(requests.filter((request) => request.url.endsWith("/user"))).toHaveLength(1);
  expect(requests.some((request) => request.url.includes("/contents/scout.py"))).toBe(false);
});

it("maps engine values to the reused profile UI with a GitHub revision", async () => {
  expect(await profile()).toMatchObject({
    skills: [{ value: "async" }], languages: [{ value: "csharp" }, { value: "python" }],
    revision: `42:custom%2Fbranch:${oldSha}`, updated_at: "2026-11-08T12:00:00Z", scouting: { shortlist_size: 5 },
  });
});

it("saves plain engine values while preserving unrelated fields and the setup guard", async () => {
  const value = await profile();
  value.summary = "Updated developer profile";
  value.skills = [{ value: "pytest", sources: ["user"], locked: false }];
  value.merged_in = ["forged/value"];
  value.scouting.min_stars = 500;
  const [status, saved] = await backend("/api/profile", "PUT", value);
  expect(status).toBe(200);
  expect(saved.revision).toBe(`42:custom%2Fbranch:${newSha}`);
  expect(raw).toMatchObject({ ...initial, summary: value.summary, skills: ["pytest"], languages: ["csharp", "python"], scouting: { candidate_limit: 30, min_stars: 500, future_setting: "keep" } });
  expect(raw).not.toHaveProperty("revision");
  expect(raw).not.toHaveProperty("updated_at");
  const write = requests.find((request) => request.method === "PUT");
  expect(JSON.parse(write.body)).toMatchObject({ sha: oldSha, branch: "custom/branch", message: expect.stringContaining("profile") });
  expect(JSON.stringify(saved)).not.toContain("private-token");
});

it("offers the languages the repository's own engine lists in scout.json, and saves them", async () => {
  manifest = NEW_ENGINE;
  const value = await profile();
  expect(value.supported_languages).toEqual(["python", "javascript", "typescript", "csharp", "c", "go", "rust", "java", "cpp"]);
  value.languages = ["go", "rust", "java", "cpp"].map((language) => ({ value: language, sources: ["user"], locked: true }));
  const [status, saved] = await backend("/api/profile", "PUT", value);
  expect(status).toBe(200);
  expect(raw.languages).toEqual(["go", "rust", "java", "cpp"]);
  expect(saved.supported_languages).toContain("cpp");
  raw.languages = ["C++", "golang", "Rust"]; // aliases written by hand read as the engine's names
  sha = "e".repeat(40);
  expect((await profile()).languages.map((row) => row.value)).toEqual(["cpp", "go", "rust"]);
});

it("offers only the first five languages to a repository whose engine predates scout.json, and won't save others", async () => {
  const value = await profile();
  expect(value.supported_languages).toEqual(["python", "javascript", "typescript", "csharp", "c"]);
  value.languages = [{ value: "python", sources: ["user"], locked: true }, { value: "go", sources: ["user"], locked: true }];
  const [status, error] = await backend("/api/profile", "PUT", value);
  expect(status).toBe(422);
  expect(error.fields).toEqual({ "languages.1.value": expect.stringContaining("doesn't run this language yet") });
  expect(requests.some((request) => request.method === "PUT")).toBe(false); // the engine would reject it at startup
  manifest = "{not json"; // an unreadable manifest offers only what every engine runs
  expect((await profile()).supported_languages).toEqual(["python", "javascript", "typescript", "csharp", "c"]);
});

it("saves engine scouting settings without losing profile fields or other scouting settings", async () => {
  const value = await settings();
  value.days = 7; value.candidate_limit = 12; value.labels = ["help wanted"];
  expect((await backend("/api/scout/settings", "PUT", value))[0]).toBe(200);
  expect(raw).toMatchObject({ setup_required: true, summary: initial.summary, email: initial.email, days: 7, labels: ["help wanted"], scouting: { candidate_limit: 12, min_stars: 200, future_setting: "keep" } });
  expect(raw).not.toHaveProperty("schedule_enabled");
});

it("rejects stale profile and settings edits before writing", async () => {
  const value = await profile();
  const scout = await settings();
  sha = newSha;
  expect((await backend("/api/profile", "PUT", value))[0]).toBe(409);
  expect((await backend("/api/scout/settings", "PUT", scout))[0]).toBe(409);
  expect(requests.some((request) => request.method === "PUT")).toBe(false);
});

it.each([
  { summary: 5 }, { skills: null }, { languages: [{ value: "ruby" }] },
  { work_types: [] }, { watchlist: ["../escape"] },
  { scouting: { min_stars: 0, shortlist_size: 9, general_issues: "yes", exclude_labels: ['bad"label'] } },
])("rejects invalid profile fields with field errors: %j", async (change) => {
  const value = await profile();
  const [status, error] = await backend("/api/profile", "PUT", { ...value, ...change });
  expect(status).toBe(422);
  expect(Object.keys(error.fields).length).toBeGreaterThan(0);
  expect(requests.some((request) => request.method === "PUT")).toBe(false);
});

it.each([
  { search_pages: 11 }, { updated_days: 1000000000 }, { days: 0 },
  { min_confidence: 1.1 }, { labels: ['bad\\label'] }, { skill_aliases: { async: [5] } },
  { schedule_enabled: true }, { email_enabled: true }, { draft_fixes: true }, { tracing_enabled: true },
])("rejects invalid or unavailable scouting settings: %j", async (change) => {
  const value = await settings();
  const [status, error] = await backend("/api/scout/settings", "PUT", { ...value, ...change });
  expect(status).toBe(422);
  expect(error.fields).toBeDefined();
  expect(requests.some((request) => request.method === "PUT")).toBe(false);
});

it("lists bounded real commits with links to their actual profile changes", async () => {
  const [status, history] = await backend("/api/profile/history");
  expect(status).toBe(200);
  expect(history).toEqual([expect.objectContaining({
    at: "2026-11-08T12:00:00Z", source: "user", field: "profile", note: "Update profile",
    commit_url: `https://github.com/octocat/scout/commit/${commitSha}`,
  })]);
  expect(requests.find((request) => request.url.includes("/commits?"))?.url).toContain("per_page=30");
});

it("requires sign-in for profile reads and writes", async () => {
  token = null;
  expect((await backend("/api/profile"))[0]).toBe(401);
  expect((await backend("/api/scout/settings", "PUT", {}))[0]).toBe(401);
  expect(requests).toHaveLength(0);
});

it("refuses to write when a saved repository name has been replaced", async () => {
  const value = await profile();
  const normal = fetchImpl.getMockImplementation();
  fetchImpl.mockImplementation(async (url, options) => url.endsWith("/repos/octocat/scout")
    ? { ok: true, json: async () => ({ id: 99, full_name: "octocat/scout", private: true, owner: { id: 7 }, permissions: { admin: true }, default_branch: "main" }) }
    : normal(url, options));
  const [status, body] = await backend("/api/profile", "PUT", value);
  expect([status, body.reconnect]).toEqual([422, true]);
  expect(requests.some((request) => request.method === "PUT")).toBe(false);
});

it("rejects an edit from a different default branch even when the profile blob matches", async () => {
  const value = await profile();
  value.revision = value.revision.replace("custom%2Fbranch", "old-branch");
  expect((await backend("/api/profile", "PUT", value))[0]).toBe(409);
  expect(requests.some((request) => request.method === "PUT")).toBe(false);
});

it("rejects an edit from another repository with identical profile content", async () => {
  const value = await profile();
  value.revision = value.revision.replace(/^42:/, "43:");
  expect((await backend("/api/profile", "PUT", value))[0]).toBe(409);
  expect(requests.some((request) => request.method === "PUT")).toBe(false);
});

it("honors a GitHub write conflict after the app's revision check", async () => {
  const value = await profile(); value.summary = "Concurrent edit";
  const normal = fetchImpl.getMockImplementation();
  fetchImpl.mockImplementation((url, options = {}) => {
    if (options.method !== "PUT") return normal(url, options);
    sha = "e".repeat(40); // someone else saved profile.json first
    return { ok: false, status: 409, headers: new Headers(), json: async () => ({ message: "profile.json does not match" }) };
  });
  expect((await backend("/api/profile", "PUT", value))[0]).toBe(409);
  expect(raw.summary).toBe(initial.summary);
});

it("explains a branch-rule refusal instead of asking for a reload that can't help", async () => {
  const value = await profile(); value.summary = "Blocked edit";
  const normal = fetchImpl.getMockImplementation();
  fetchImpl.mockImplementation((url, options = {}) => options.method === "PUT"
    ? { ok: false, status: 409, headers: new Headers(), json: async () => ({ message: "Repository rule violations found\n\nChanges must be made through a pull request.\n" }) }
    : normal(url, options));
  const [status, body] = await backend("/api/profile", "PUT", value);
  expect(status).toBe(422);
  expect(body.error).toContain("Repository rule violations found Changes must be made through a pull request");
});

it("saves again straight after a save while GitHub still serves the older file", async () => {
  const first = await profile(); first.summary = "First";
  const [, saved] = await backend("/api/profile", "PUT", first);
  const normal = fetchImpl.getMockImplementation();
  const older = { type: "file", encoding: "base64", sha: oldSha, content: Buffer.from(JSON.stringify(initial)).toString("base64") };
  fetchImpl.mockImplementation(async (url, options = {}) => url.includes("/contents/profile.json") && options.method !== "PUT"
    ? { ok: true, status: 200, headers: new Headers(), json: async () => older } : normal(url, options));
  saved.summary = "Second";
  expect((await backend("/api/profile", "PUT", saved))[0]).toBe(200);
  expect(raw).toMatchObject({ summary: "Second", email: initial.email, setup_required: true });
  expect(JSON.parse(requests.filter((request) => request.method === "PUT").at(-1).body).sha).toBe(newSha);
});

it("trims labels before saving, because the engine matches them exactly", async () => {
  const value = await settings();
  value.labels = [" help wanted ", "bug"]; value.documentation_labels = ["docs "];
  expect((await backend("/api/scout/settings", "PUT", value))[0]).toBe(200);
  expect(raw).toMatchObject({ labels: ["help wanted", "bug"], documentation_labels: ["docs"] });
  const edited = await profile(); edited.scouting.exclude_labels = [" good first issue"];
  expect((await backend("/api/profile", "PUT", edited))[0]).toBe(200);
  expect(raw.scouting.exclude_labels).toEqual(["good first issue"]);
});

it("stops a save when the user signs out during the profile read", async () => {
  const value = await profile(); value.summary = "Should not save";
  const normal = fetchImpl.getMockImplementation();
  let release, entered;
  const waiting = new Promise((resolve) => { entered = resolve; });
  fetchImpl.mockImplementation(async (url, options) => {
    if (url.includes(`/contents/profile.json?ref=${commitSha}`)) {
      entered();
      await new Promise((resolve) => { release = resolve; });
    }
    return normal(url, options);
  });
  const saving = backend("/api/profile", "PUT", value);
  await waiting;
  await backend("/auth/logout", "POST");
  release();
  expect((await saving)[0]).toBe(401);
  expect(requests.some((request) => request.method === "PUT")).toBe(false);
});

it("does not create a second commit when saving an unchanged profile", async () => {
  raw.languages = ["csharp", "python"];
  raw.scouting = { ...raw.scouting, general_issues: false, shortlist_size: 5, exclude_labels: ["good first issue"] };
  expect((await backend("/api/profile", "PUT", await profile()))[0]).toBe(200);
  expect(requests.some((request) => request.method === "PUT")).toBe(false);
});

it("refuses malformed repository profile data without attempting to overwrite it", async () => {
  raw.languages = [null];
  expect((await backend("/api/profile"))[0]).toBe(502);
  expect(requests.some((request) => request.method === "PUT")).toBe(false);
});

it("refuses unknown root fields that the engine cannot load", async () => {
  raw.unsupported_field = "not accepted by settings.py";
  expect((await backend("/api/profile"))[0]).toBe(502);
  expect(requests.some((request) => request.method === "PUT")).toBe(false);
});

it("rejects multibyte profile text before saving a file the app could not reopen", async () => {
  const value = await profile();
  value.skills = [{ value: "界".repeat(110000), sources: ["user"], locked: true }];
  expect((await backend("/api/profile", "PUT", value))[0]).toBe(422);
  expect(requests.some((request) => request.method === "PUT")).toBe(false);
  expect((await backend("/api/profile"))[0]).toBe(200);
});

it("checks the final merged file size including preserved fields", async () => {
  raw.scouting.preserved = "x".repeat(230000);
  const value = await profile();
  value.skills = [{ value: "y".repeat(25000), sources: ["user"], locked: true }];
  expect((await backend("/api/profile", "PUT", value))[0]).toBe(422);
  expect(requests.some((request) => request.method === "PUT")).toBe(false);
});
