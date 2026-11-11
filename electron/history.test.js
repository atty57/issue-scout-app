import { beforeEach, expect, it, vi } from "vitest";
import { createBackend } from "./backend.js";
import { engineHistory } from "./zip-fixture.js";

let backend, file, requests;
const encoded = (text) => ({ type: "file", encoding: "base64", size: Buffer.byteLength(text), content: Buffer.from(text).toString("base64") });

beforeEach(() => {
  file = encoded(engineHistory());
  requests = [];
  const ok = (data) => ({ ok: true, status: 200, headers: new Headers(), json: async () => data });
  const fetchImpl = vi.fn(async (url) => {
    requests.push(url);
    const { pathname } = new URL(url);
    if (pathname === "/user") return ok({ id: 7, login: "octocat" });
    if (pathname === "/repos/octocat/scout") return ok({ id: 42, full_name: "octocat/scout", owner: { id: 7 }, private: true, permissions: { admin: true }, default_branch: "main" });
    if (pathname === "/repos/octocat/scout/contents/state/seen.json")
      return file ? ok(file) : { ok: false, status: 404, headers: new Headers(), json: async () => ({ message: "Not Found" }) };
    throw new Error(`Unexpected offline route: ${url}`);
  });
  backend = createBackend({ tokens: { load: () => "private-token", clear: () => {} }, repositories: { get: () => ({ id: 42, full_name: "octocat/scout" }) }, fetchImpl });
});

it("lists the engine's attempted issues from state/seen.json, newest first, with only the facts it recorded", async () => {
  const [status, history] = await backend("/api/history");
  expect(status).toBe(200);
  expect(requests).toContain("https://api.github.com/repos/octocat/scout/contents/state/seen.json?ref=main");
  expect(history.skipped).toBe(0);
  // The fixture's engine attempted #3 first, then #1, then #2.
  expect(history.items.map((item) => [item.number, item.status])).toEqual([[2, "failed"], [1, "failed"], [3, "notified"]]);
  const issue = (number) => history.items.find((item) => item.number === number);
  expect(issue(3)).toMatchObject({ url: "https://github.com/acme/core/issues/3", repo: "acme/core", tests_passed: true, reproduces: true,
    notification: { status: "disabled" }, why: "Focused regression fix", reason: "verified patch" });
  expect(issue(2)).toMatchObject({ reason: expect.stringContaining("claude-code failed"), retry_after: expect.any(String) });
  expect(issue(3)).not.toHaveProperty("title"); // the engine doesn't record titles, so none is made up
});

it("reads the older URL-only history, skips records that aren't engine records, and has none before the first attempt", async () => {
  file = encoded(JSON.stringify(["https://github.com/acme/core/issues/9"]));
  expect((await backend("/api/history"))[1]).toEqual({ items: [{ url: "https://github.com/acme/core/issues/9", repo: "acme/core", number: 9, status: "notified", legacy: true }], skipped: 0 });
  file = encoded(JSON.stringify({
    "https://github.com/acme/core/issues/4": { status: "failed", attempts: 1, tests_passed: "yes", reason: 7 },
    "https://example.com/acme/core/issues/5": { status: "notified" },
    "https://github.com/acme/core/issues/6": { status: "claimed" },
  }));
  expect((await backend("/api/history"))[1]).toEqual({ items: [{ url: "https://github.com/acme/core/issues/4", repo: "acme/core", number: 4, status: "failed", attempts: 1 }], skipped: 2 });
  file = undefined;
  expect(await backend("/api/history")).toEqual([200, { items: [], skipped: 0 }]);
});

it("says plainly when the history can't be read or is too large", async () => {
  file = encoded("{not json");
  expect(await backend("/api/history")).toEqual([502, { error: expect.stringContaining("can't be read") }]);
  file = { type: "file", encoding: "none", size: 2_000_000, content: "" };
  expect(await backend("/api/history")).toEqual([413, { error: expect.stringContaining("over 1 MB") }]);
});
