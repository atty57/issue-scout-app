import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createBackend } from "./backend.js";

const user = { id: 7, login: "octocat", avatar_url: "https://avatars.githubusercontent.com/u/7" };
const repository = {
  id: 42, full_name: "octocat/issue-scout", private: true,
  owner: { id: 7 }, permissions: { admin: true }, default_branch: "main",
};
let token, saved, requests, repo, missingFile, backend, store, fetchImpl;

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected live network request in an offline test."); }));
  token = "private-token";
  saved = new Map();
  requests = [];
  repo = structuredClone(repository);
  missingFile = false;
  store = { get: (id) => saved.get(id), set: vi.fn((id, value) => saved.set(id, value)) };
  fetchImpl = vi.fn(async (url, options = {}) => {
    requests.push({ url, ...options });
    let data = repo;
    let status = 200;
    if (url.endsWith("/user")) data = user;
    else if (url.includes("/contents/")) {
      status = missingFile ? 404 : 200;
      data = { type: "file" };
    } else if (url.endsWith("/generate")) status = 201;
    return { ok: status < 400, status, headers: new Headers(), json: async () => data };
  });
  backend = createBackend({
    tokens: { load: () => token, save: (value) => { token = value; }, clear: () => { token = null; } },
    repositories: store, clientId: "public-client", openExternal: vi.fn(), fetchImpl,
    sleep: async () => {},
  });
});
afterEach(() => vi.unstubAllGlobals());

it("sends a signed-in user without a saved repository to desktop onboarding", async () => {
  expect(await backend("/api/me")).toEqual([200, { login: user.login, avatar_url: user.avatar_url, onboarding: "needs_repository" }]);
});

it("creates only a private copy of the fixed template, then remembers it for this account", async () => {
  const [status, me] = await backend("/api/repository", "POST", { mode: "create", name: "issue-scout", private: false });
  expect(status).toBe(200);
  const create = requests.find((request) => request.method === "POST");
  expect(create.url).toBe("https://api.github.com/repos/atty57/issue-scout-template/generate");
  expect(JSON.parse(create.body)).toMatchObject({ owner: "octocat", name: "issue-scout", private: true, include_all_branches: false });
  expect(create.headers.Authorization).toBe("Bearer private-token");
  expect(store.set).toHaveBeenCalledWith(7, { id: 42, full_name: "octocat/issue-scout" });
  expect(me).toMatchObject({ onboarding: "ready", repository: { id: 42, full_name: "octocat/issue-scout", html_url: "https://github.com/octocat/issue-scout" } });
  expect(JSON.stringify(me)).not.toContain("private-token");
  expect(requests.filter((request) => request.url.includes("/contents/"))).toHaveLength(3);
});

it("connects and restores an existing private Scout repository without changing GitHub files", async () => {
  expect((await backend("/api/repository", "POST", { mode: "connect", repo: "octocat/issue-scout" }))[0]).toBe(200);
  expect((await backend("/api/me"))[1]).toMatchObject({ onboarding: "ready", repository: { id: 42 } });
  expect(requests.every((request) => request.method === "GET")).toBe(true);
});

it.each([
  null, {}, { mode: "delete" }, { mode: "create", name: "../other" },
  { mode: "create", name: "." }, { mode: "create", name: "a".repeat(101) },
  { mode: "connect", repo: "https://github.com/octocat/issue-scout" },
  { mode: "connect", repo: "other/issue-scout" },
])("rejects invalid repository input before any GitHub mutation: %j", async (body) => {
  expect((await backend("/api/repository", "POST", body))[0]).toBe(422);
  expect(requests.some((request) => request.method === "POST")).toBe(false);
  expect(store.set).not.toHaveBeenCalled();
});

it.each([
  { private: false }, { owner: { id: 88 } }, { permissions: { admin: false } },
  { archived: true }, { disabled: true },
])("rejects repositories unsuitable for a personal Scout workspace: %j", async (change) => {
  Object.assign(repo, change);
  expect((await backend("/api/repository", "POST", { mode: "connect", repo: "octocat/issue-scout" }))[0]).toBe(422);
  expect(store.set).not.toHaveBeenCalled();
});

it("does not remember a repository missing Scout files", async () => {
  missingFile = true;
  expect((await backend("/api/repository", "POST", { mode: "connect", repo: "octocat/issue-scout" }))[0]).toBe(404);
  expect(store.set).not.toHaveBeenCalled();
});

it("returns to onboarding if a saved name now refers to a different repository", async () => {
  saved.set(7, { id: 999, full_name: "octocat/issue-scout" });
  expect((await backend("/api/me"))[1]).toMatchObject({ onboarding: "needs_repository", repository_error: expect.any(String) });
  expect(store.set).not.toHaveBeenCalled();
});

it("keeps repository choices separate between accounts", async () => {
  saved.set(88, { id: 42, full_name: "someone/issue-scout" });
  expect((await backend("/api/me"))[1].onboarding).toBe("needs_repository");
  expect(requests).toHaveLength(1);
});

it("requires sign-in before repository setup", async () => {
  token = null;
  expect((await backend("/api/repository", "POST", { mode: "create", name: "issue-scout" }))[0]).toBe(401);
  expect(requests).toHaveLength(0);
});

it("polls for a generated repository's files without creating the repository twice", async () => {
  const normal = fetchImpl.getMockImplementation();
  let pending = true;
  fetchImpl.mockImplementation(async (url, options) => {
    if (url.includes("/contents/") && pending) {
      pending = false;
      return { ok: false, status: 404, headers: new Headers() };
    }
    return normal(url, options);
  });
  expect((await backend("/api/repository", "POST", { mode: "create", name: "issue-scout" }))[0]).toBe(200);
  expect(requests.filter((request) => request.method === "POST")).toHaveLength(1);
  expect(store.set).toHaveBeenCalledTimes(1);
});

it("offers to reconnect a generated repository if its files never become available", async () => {
  missingFile = true;
  const [status, body] = await backend("/api/repository", "POST", { mode: "create", name: "issue-scout" });
  expect(status).toBe(409);
  expect(body.error).toContain("octocat/issue-scout");
  expect(requests.filter((request) => request.method === "POST")).toHaveLength(1);
  expect(store.set).not.toHaveBeenCalled();
});

it.each([401, 403, 422, 429, 500])("preserves GitHub failure status %s and never saves a failed setup", async (status) => {
  const normal = fetchImpl.getMockImplementation();
  fetchImpl.mockImplementation((url, options) => url.endsWith("/generate")
    ? { ok: false, status, headers: new Headers() } : normal(url, options));
  expect((await backend("/api/repository", "POST", { mode: "create", name: "issue-scout" }))[0]).toBe(status);
  expect(store.set).not.toHaveBeenCalled();
});

it("does not treat GitHub rate limiting as a lost repository connection", async () => {
  saved.set(7, { id: 42, full_name: "octocat/issue-scout" });
  const normal = fetchImpl.getMockImplementation();
  fetchImpl.mockImplementation((url, options) => url.includes("/repos/")
    ? { ok: false, status: 403, headers: new Headers({ "x-ratelimit-remaining": "0" }) } : normal(url, options));
  expect((await backend("/api/me"))[0]).toBe(429);
  expect(saved.get(7)).toEqual({ id: 42, full_name: "octocat/issue-scout" });
});

it("follows the repository GitHub actually created when its name differs from the request", async () => {
  repo.full_name = "octocat/issue-scout-1";
  expect((await backend("/api/repository", "POST", { mode: "create", name: "issue-scout" }))[0]).toBe(200);
  expect(requests.map((request) => request.url)).toContain("https://api.github.com/repos/octocat/issue-scout-1");
  expect(requests.map((request) => request.url)).not.toContain("https://api.github.com/repos/octocat/issue-scout");
  expect(store.set).toHaveBeenCalledWith(7, { id: 42, full_name: "octocat/issue-scout-1" });
});

it("asks the app to reopen repository setup when a page finds the saved repository renamed", async () => {
  saved.set(7, { id: 42, full_name: "octocat/issue-scout" });
  const normal = fetchImpl.getMockImplementation();
  fetchImpl.mockImplementation((url, options) => url.includes("/repos/")
    ? { ok: false, status: 301, headers: new Headers() } : normal(url, options));
  const [status, body] = await backend("/api/profile");
  expect(status).toBe(422);
  expect(body).toMatchObject({ reconnect: true, error: expect.stringContaining("moved") });
});

it("offers reconnection after a saved repository is renamed, without following authenticated redirects", async () => {
  saved.set(7, { id: 42, full_name: "octocat/issue-scout" });
  const normal = fetchImpl.getMockImplementation();
  fetchImpl.mockImplementation((url, options) => url.includes("/repos/")
    ? { ok: false, status: 301, headers: new Headers({ Location: "https://api.github.com/repos/octocat/renamed" }) } : normal(url, options));
  const [status, me] = await backend("/api/me");
  expect(status).toBe(200);
  expect(me).toMatchObject({ onboarding: "needs_repository", repository_error: expect.stringContaining("moved") });
  expect(fetchImpl).toHaveBeenLastCalledWith("https://api.github.com/repos/octocat/issue-scout", expect.objectContaining({ redirect: "manual" }));
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it("does not save or return a completed connection after sign-out", async () => {
  const normal = fetchImpl.getMockImplementation();
  let release, entered;
  const waiting = new Promise((resolve) => { entered = resolve; });
  fetchImpl.mockImplementation(async (url, options) => {
    if (url.endsWith("/repos/octocat/issue-scout")) {
      entered();
      await new Promise((resolve) => { release = resolve; });
    }
    return normal(url, options);
  });
  const connecting = backend("/api/repository", "POST", { mode: "connect", repo: "octocat/issue-scout" });
  await waiting;
  expect((await backend("/auth/logout", "POST"))[0]).toBe(204);
  release();
  expect((await connecting)[0]).toBe(401);
  expect(token).toBeNull();
  expect(store.set).not.toHaveBeenCalled();
});

it("rejects concurrent setup requests without a second template generation", async () => {
  const normal = fetchImpl.getMockImplementation();
  let release, entered;
  const waiting = new Promise((resolve) => { entered = resolve; });
  fetchImpl.mockImplementation(async (url, options) => {
    if (url.endsWith("/generate")) {
      entered();
      await new Promise((resolve) => { release = resolve; });
    }
    return normal(url, options);
  });
  const creating = backend("/api/repository", "POST", { mode: "create", name: "issue-scout" });
  await waiting;
  expect((await backend("/api/repository", "POST", { mode: "create", name: "another" }))[0]).toBe(409);
  release();
  expect((await creating)[0]).toBe(200);
  expect(requests.filter((request) => request.method === "POST")).toHaveLength(1);
});

it("stops polling GitHub as soon as the user signs out during a pending sign-in", async () => {
  const normal = fetchImpl.getMockImplementation();
  let polls = 0;
  fetchImpl.mockImplementation(async (url, options) => {
    if (url.endsWith("/login/device/code")) return { ok: true, json: async () => ({ device_code: "code", user_code: "USER-CODE", verification_uri: "https://github.com/login/device" }) };
    if (url.endsWith("/login/oauth/access_token")) {
      if (++polls === 2) await backend("/auth/logout", "POST");
      return { ok: true, json: async () => ({ error: "authorization_pending" }) };
    }
    return normal(url, options);
  });
  expect((await backend("/auth/device", "POST"))[0]).toBe(200);
  expect((await backend("/auth/device/wait", "POST"))[0]).toBe(409);
  expect(polls).toBe(2);
});

it("does not restore a sign-in after the user signs out while the browser approval is pending", async () => {
  const normal = fetchImpl.getMockImplementation();
  let release, entered;
  const waiting = new Promise((resolve) => { entered = resolve; });
  fetchImpl.mockImplementation(async (url, options) => {
    if (url.endsWith("/login/device/code")) return { ok: true, json: async () => ({ device_code: "code", user_code: "USER-CODE", verification_uri: "https://github.com/login/device" }) };
    if (url.endsWith("/login/oauth/access_token")) {
      entered();
      await new Promise((resolve) => { release = resolve; });
      return { ok: true, json: async () => ({ access_token: "new-private-token" }) };
    }
    return normal(url, options);
  });
  expect((await backend("/auth/device", "POST"))[0]).toBe(200);
  const login = backend("/auth/device/wait", "POST");
  await waiting;
  await backend("/auth/logout", "POST");
  release();
  expect((await login)[0]).toBe(409);
  expect(token).toBeNull();
});
