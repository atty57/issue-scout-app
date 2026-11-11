import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createBackend } from "./backend.js";
import { validEmail } from "./email.js";

const RELAY = "https://relay.example.com";
const HANDLE = "f".repeat(64);
const profile = {
  email: "", summary: "Python developer", skills: ["async"], languages: ["python"], work_types: ["code"],
  labels: ["bug"], documentation_labels: ["docs"], watchlist: [], merged_in: [], days: 3, scouting: { min_stars: 50 },
};
const sha = (n) => String(n).padStart(40, "0");
let raw, version, requests, variable, hasWorkflow, relayReply, store, backend;

const github = () => requests.filter((request) => !request.url.startsWith(RELAY));
const writes = () => github().filter((request) => request.method !== "GET");
const load = async () => (await backend("/api/email"))[1];
const save = (body) => backend("/api/email", "PUT", body);

function makeBackend(relayUrl = RELAY) {
  backend = createBackend({
    tokens: { load: () => "private-token", clear: () => {} },
    repositories: { get: () => ({ id: 42, full_name: "octocat/scout" }) },
    fetchImpl, clientId: "public", openExternal: vi.fn(), sleep: async () => {},
    emailRelayUrl: relayUrl, emailStore: store,
  });
}
const ok = (data, status = 200) => ({ ok: status < 300, status, headers: new Headers(), json: async () => data });
const fetchImpl = vi.fn(async (url, options = {}) => {
  const method = options.method ?? "GET";
  const body = options.body ? JSON.parse(options.body) : undefined;
  requests.push({ url, method, body, headers: options.headers ?? {} });
  if (url === `${RELAY}/confirm`) return relayReply(body);
  const { pathname: path } = new URL(url);
  if (path === "/user") return ok({ id: 7, login: "octocat", avatar_url: "" });
  if (path === "/repos/octocat/scout") return ok({ id: 42, full_name: "octocat/scout", owner: { id: 7 }, private: true, permissions: { admin: true }, default_branch: "main" });
  if (path.endsWith("/commits")) return ok([{ sha: "c".repeat(40), commit: { message: "Initial", committer: { date: "2026-11-08T11:00:00Z" } } }]);
  if (path.endsWith("/contents/profile.json") && method === "PUT") {
    if (body.sha !== sha(version)) return ok({ message: "does not match" }, 409);
    raw = JSON.parse(Buffer.from(body.content, "base64").toString("utf8"));
    return ok({ content: { sha: sha(++version) }, commit: { sha: "d".repeat(40), committer: { date: "2026-11-08T12:00:00Z" } } });
  }
  if (path.endsWith("/contents/profile.json")) return ok({ type: "file", encoding: "base64", sha: sha(version), content: Buffer.from(JSON.stringify(raw)).toString("base64") });
  if (path.endsWith("/contents/.github/workflows/email.yml")) return hasWorkflow ? ok({ type: "file", sha: "e".repeat(40) }) : ok({ message: "Not Found" }, 404);
  if (path.endsWith("/actions/variables/SCOUT_EMAIL_RELAY_URL")) {
    if (variable === undefined) return ok({ message: "Not Found" }, 404);
    if (method === "PATCH") variable = body.value;
    if (method === "DELETE") variable = undefined;
    return ok(null, 204);
  }
  if (path.endsWith("/actions/variables") && method === "POST") { variable = body.value; return ok(null, 201); }
  if (path.endsWith("/actions/workflows/email.yml/dispatches")) return hasWorkflow ? ok(null, 204) : ok({ message: "Not Found" }, 404);
  throw new Error(`Unexpected offline route: ${method} ${url}`);
});

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live requests are forbidden in offline tests."); }));
  raw = structuredClone(profile); version = 1; requests = []; variable = undefined; hasWorkflow = true;
  relayReply = () => ok({ status: "confirmed", email: "dev@example.com" });
  const saved = new Map();
  store = { get: (id) => saved.get(id), set: (id, value) => saved.set(id, value) };
  makeBackend();
});
afterEach(() => vi.unstubAllGlobals());

async function confirm(email = "dev@example.com") {
  const { revision } = await load();
  await save({ revision, email, enabled: false });
  store.set(42, { ...store.get(42), handle: HANDLE });
  relayReply = () => ok({ status: "confirmed", email });
  expect((await backend("/api/email/confirm", "POST", { code: "123456" }))[0]).toBe(200);
}

it("lets Discovery and Email, open together, save one after the other, but not over a change made elsewhere", async () => {
  // Scout settings loads every section at once, so each holds the revision from before the other's save.
  const [, discovery] = await backend("/api/scout/settings");
  const email = await load();
  expect((await save({ revision: email.revision, email: "dev@example.com", enabled: false }))[0]).toBe(200);
  const [status, saved] = await backend("/api/scout/settings", "PUT", { ...discovery, days: 5 });
  expect(status).toBe(200);
  expect(raw).toMatchObject({ email: "dev@example.com", days: 5 }); // neither save undid the other
  // And the other way round, from the revisions each editor now holds.
  expect((await save({ revision: email.revision, email: "new@example.com", enabled: false }))[0]).toBe(200);
  expect(raw).toMatchObject({ email: "new@example.com", days: 5 });
  // A change this app didn't make (an edit on GitHub) is still a conflict.
  raw = { ...raw, summary: "Edited on GitHub" }; version++;
  const [conflict] = await backend("/api/scout/settings", "PUT", { ...saved, days: 6 });
  expect(conflict).toBe(409);
  expect(raw).toMatchObject({ summary: "Edited on GitHub", days: 5 });
});

it("stays hidden, with no GitHub calls, in a build without an email relay", async () => {
  for (const url of ["", "http://relay.example.com", "https://user:pw@relay.example.com", "not a url"]) {
    makeBackend(url);
    expect(await backend("/api/email")).toEqual([200, { available: false }]);
    expect((await save({ revision: "x", email: "dev@example.com", enabled: true }))[0]).toBe(404);
  }
  expect(github()).toHaveLength(0);
});

it("shows the saved address and that nothing is confirmed or on yet", async () => {
  raw.email = "dev@example.com";
  expect(await load()).toEqual({ available: true, ready: true, revision: `42:main:${sha(1)}`, email: "dev@example.com", enabled: false, confirmed: false, code_sent: false });
});

it("asks the user's email workflow for a code, and confirms the address with the relay without the GitHub token", async () => {
  const { revision } = await load();
  await save({ revision, email: "dev@Example.COM", enabled: false });
  expect(raw.email).toBe("dev@example.com");
  const [status, view] = await backend("/api/email/verify", "POST");
  expect([status, view.code_sent, view.confirmed]).toEqual([202, true, false]);
  expect(variable).toBe(RELAY);
  const dispatch = requests.find((request) => request.url.endsWith("/actions/workflows/email.yml/dispatches"));
  expect(dispatch.body).toEqual({ ref: "main", inputs: { task: "verify", handle: expect.stringMatching(/^[0-9a-f]{64}$/) } });
  const [confirmed, after] = await backend("/api/email/confirm", "POST", { code: " 123 456 " });
  expect([confirmed, after.confirmed, after.code_sent]).toEqual([200, true, false]);
  const call = requests.find((request) => request.url === `${RELAY}/confirm`);
  expect(call.body).toEqual({ handle: dispatch.body.inputs.handle, code: "123456" });
  expect(JSON.stringify(call)).not.toContain("private-token");
  expect(call.headers).not.toHaveProperty("Authorization");
});

it("won't turn email on for an address that isn't confirmed", async () => {
  const { revision } = await load();
  const [status, error] = await save({ revision, email: "dev@example.com", enabled: true });
  expect([status, error.error]).toEqual([409, expect.stringContaining("Confirm this address")]);
  expect(writes()).toHaveLength(0);
  expect(raw.email_enabled).toBeUndefined();
});

it("turns email on and off through profile.json and the relay variable, keeping other settings", async () => {
  await confirm();
  const [onStatus, on] = await save({ revision: (await load()).revision, email: "dev@example.com", enabled: true });
  expect([onStatus, on.enabled, on.confirmed]).toEqual([200, true, true]);
  expect(raw).toEqual({ ...profile, email: "dev@example.com", email_enabled: true });
  expect(variable).toBe(RELAY);
  const onWrite = writes().findLast((request) => request.url.endsWith("/contents/profile.json"));
  expect(onWrite.body.message).toBe("Issue Scout: turn on email reports");

  requests = [];
  const [offStatus, off] = await save({ revision: on.revision, email: "dev@example.com", enabled: false });
  expect([offStatus, off.enabled]).toEqual([200, false]);
  expect(raw).toEqual({ ...profile, email: "dev@example.com", email_enabled: false });
  expect(variable).toBeUndefined();
  // The switch flips before the relay address goes, so nothing can send in between.
  expect(writes().map((request) => `${request.method} ${new URL(request.url).pathname.split("/").slice(-1)}`)).toEqual(["PUT profile.json", "DELETE SCOUT_EMAIL_RELAY_URL"]);
  expect(writes()[0].body.message).toBe("Issue Scout: turn off email reports");
});

it("needs a new confirmation after the address changes", async () => {
  await confirm();
  const { revision } = await load();
  const [, changed] = await save({ revision, email: "new@example.com", enabled: false });
  expect(changed.confirmed).toBe(false);
  expect((await save({ revision: changed.revision, email: "new@example.com", enabled: true }))[0]).toBe(409);
});

it("rejects stale revisions and invalid addresses without writing", async () => {
  await confirm();
  expect((await save({ revision: `42:main:${sha(99)}`, email: "dev@example.com", enabled: true }))[0]).toBe(409);
  expect(raw.email_enabled).toBe(false);
  for (const email of ["two@example.com, three@example.com", "nobody", "a@localhost"]) {
    const [status, error] = await save({ revision: (await load()).revision, email, enabled: false });
    expect([status, error.fields?.email]).toEqual([422, expect.any(String)]);
  }
});

it("explains wrong, expired and missing codes, and a relay that doesn't answer", async () => {
  raw.email = "dev@example.com";
  await backend("/api/email/verify", "POST");
  relayReply = () => ok({ reason: "wrong_code", attempts_left: 2 }, 422);
  expect((await backend("/api/email/confirm", "POST", { code: "000000" }))[1].fields.code).toBe("That code isn't right. 2 tries left.");
  relayReply = () => ok({ reason: "expired" }, 410);
  expect((await backend("/api/email/confirm", "POST", { code: "000000" }))[1].error).toContain("expired");
  relayReply = () => ok({ reason: "not_found" }, 404);
  expect((await backend("/api/email/confirm", "POST", { code: "000000" }))[1].error).toContain("No code has been sent");
  relayReply = () => { throw new TypeError("fetch failed"); };
  expect((await backend("/api/email/confirm", "POST", { code: "000000" }))[0]).toBe(503);
  relayReply = () => ok({ status: "confirmed", email: "someone-else@example.com" });
  expect((await backend("/api/email/confirm", "POST", { code: "000000" }))[1].error).toContain("different address");
  expect((await backend("/api/email/confirm", "POST", { code: "12ab" }))[1].fields.code).toContain("6-digit");
  expect((await load()).confirmed).toBe(false);
});

it("asks to update a Scout repository created before email existed", async () => {
  hasWorkflow = false;
  raw.email = "dev@example.com";
  expect((await load()).ready).toBe(false);
  expect((await backend("/api/email/verify", "POST"))[1].error).toContain("created before email reports existed");
  expect((await save({ revision: (await load()).revision, email: "dev@example.com", enabled: false }))[0]).toBe(409);
  expect(writes()).toHaveLength(0);
});

it("checks addresses the way the engine does", () => {
  expect(validEmail("dev+scout@Example.co.uk")).toBe("dev+scout@example.co.uk");
  expect(validEmail("dev@bücher.example")).toBe("dev@xn--bcher-kva.example");
  for (const bad of ["", " dev@example.com", "a@@example.com", ".a@example.com", "a..b@example.com", "a@exam_ple.com", "a@-example.com"])
    expect(validEmail(bad)).toBe("");
});
