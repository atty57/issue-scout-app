// @vitest-environment node
// The main process runs in Node; jsdom's typed arrays come from another realm and libsodium rejects them.
import sodium from "libsodium-wrappers";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createBackend } from "./backend.js";

const profileFile = {
  setup_required: true, email: "", summary: "Python developer", skills: ["async"], languages: ["python"],
  work_types: ["code"], labels: ["bug"], documentation_labels: ["docs"], watchlist: [], merged_in: [], days: 3, scouting: {},
};
let keys, backend, token, variables, secrets, raw, sha, requests;

beforeAll(async () => {
  await sodium.ready;
  keys = sodium.crypto_box_keypair();
});

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live requests are forbidden in offline tests."); }));
  token = "private-token"; variables = new Map(); secrets = new Map(); raw = structuredClone(profileFile); sha = "a".repeat(40); requests = [];
  const ok = (data, status = 200) => ({ ok: true, status, headers: new Headers(), json: async () => data });
  const fetchImpl = vi.fn(async (url, options = {}) => {
    const method = options.method ?? "GET";
    const body = options.body ? JSON.parse(options.body) : undefined;
    requests.push({ url, method, body });
    const path = new URL(url).pathname;
    if (path === "/user") return ok({ id: 7, login: "octocat", avatar_url: "" });
    if (path === "/repos/octocat/scout") return ok({ id: 42, full_name: "octocat/scout", owner: { id: 7 }, private: true, permissions: { admin: true }, default_branch: "main" });
    if (path.endsWith("/actions/variables") && method === "GET")
      return ok({ total_count: variables.size, variables: [...variables].map(([name, value]) => ({ name, value })) });
    if (path.endsWith("/actions/variables") && method === "POST") { variables.set(body.name, body.value); return ok(null, 201); }
    const variable = path.match(/\/actions\/variables\/(\w+)$/)?.[1];
    if (variable && method === "PATCH") { variables.set(variable, body.value); return ok(null, 204); }
    if (variable && method === "DELETE") { variables.delete(variable); return ok(null, 204); }
    if (path.endsWith("/actions/secrets/public-key")) return ok({ key_id: "key-1", key: sodium.to_base64(keys.publicKey, sodium.base64_variants.ORIGINAL) });
    if (path.endsWith("/actions/secrets")) return ok({ total_count: secrets.size, secrets: [...secrets.keys()].map((name) => ({ name })) });
    const secret = path.match(/\/actions\/secrets\/(\w+)$/)?.[1];
    if (secret && method === "PUT") { secrets.set(secret, body); return ok(null, 201); }
    if (path.endsWith("/commits")) return ok([{ sha: "c".repeat(40), commit: { message: "Initial", committer: { date: "2026-11-08T12:00:00Z" } } }]);
    if (path.endsWith("/contents/profile.json") && method === "PUT") {
      raw = JSON.parse(Buffer.from(body.content, "base64").toString("utf8")); sha = "b".repeat(40);
      return ok({ content: { sha }, commit: { committer: { date: "2026-11-08T12:05:00Z" } } });
    }
    if (path.endsWith("/contents/profile.json")) return ok({ type: "file", encoding: "base64", sha, content: Buffer.from(JSON.stringify(raw)).toString("base64") });
    throw new Error(`Unexpected offline route: ${method} ${url}`);
  });
  backend = createBackend({
    tokens: { load: () => token, clear: () => { token = null; } },
    repositories: { get: () => ({ id: 42, full_name: "octocat/scout" }) },
    fetchImpl, clientId: "public", openExternal: vi.fn(),
  });
});
afterEach(() => vi.unstubAllGlobals());

const writes = () => requests.filter((request) => request.method !== "GET");
const decrypt = (name) => sodium.to_string(sodium.crypto_box_seal_open(
  sodium.from_base64(secrets.get(name).encrypted_value, sodium.base64_variants.ORIGINAL), keys.publicKey, keys.privateKey));
const stage = (provider, auth, extra = {}) => ({ provider, auth, model: "", base_url: "", key: "", ...extra });

it("shows the engine defaults and which keys are saved, never their values", async () => {
  secrets.set("GROQ_API_KEY", {}); secrets.set("UNRELATED_SECRET", {});
  const [status, models] = await backend("/api/models");
  expect(status).toBe(200);
  expect(models).toMatchObject({
    picker: { provider: "groq", auth: "api-key", model: "", base_url: "" },
    solver: { provider: "claude-code", auth: "subscription" },
    secrets: ["GROQ_API_KEY"],
  });
  expect(models.providers.map((provider) => provider.id)).toEqual(["groq", "openai", "anthropic", "openai-compatible", "claude-code", "codex"]);
});

it("saves models as variables and keys as sealed secrets, then finishes setup", async () => {
  const [status, models] = await backend("/api/models", "PUT", {
    picker: stage("groq", "api-key", { key: " gsk_test_key " }),
    solver: stage("claude-code", "subscription", { key: "sk-ant-oat01-test" }),
  });
  expect(status).toBe(200);
  expect(Object.fromEntries(variables)).toEqual({
    SCOUT_PICKER_PROVIDER: "groq", SCOUT_PICKER_AUTH: "api-key",
    SCOUT_SOLVER_PROVIDER: "claude-code", SCOUT_SOLVER_AUTH: "subscription",
  });
  expect(decrypt("GROQ_API_KEY")).toBe("gsk_test_key");
  expect(decrypt("CLAUDE_CODE_OAUTH_TOKEN")).toBe("sk-ant-oat01-test");
  expect(secrets.get("GROQ_API_KEY").key_id).toBe("key-1");
  expect(raw).not.toHaveProperty("setup_required");
  expect(raw.summary).toBe(profileFile.summary);
  expect(requests.find((request) => request.url.includes("/contents/profile.json") && request.method === "PUT").body.message).toBe("Issue Scout: finish setup");
  expect(models.secrets).toEqual(["CLAUDE_CODE_OAUTH_TOKEN", "GROQ_API_KEY"]);
  expect(JSON.stringify(models)).not.toContain("gsk_test_key");
});

it("updates and removes existing variables instead of duplicating them, and keeps saved keys", async () => {
  variables.set("SCOUT_PICKER_PROVIDER", "openai"); variables.set("SCOUT_PICKER_MODEL", "gpt-old");
  secrets.set("GROQ_API_KEY", {}); secrets.set("CLAUDE_CODE_OAUTH_TOKEN", {});
  expect((await backend("/api/models", "PUT", { picker: stage("groq", "api-key"), solver: stage("claude-code", "subscription") }))[0]).toBe(200);
  expect(variables.get("SCOUT_PICKER_PROVIDER")).toBe("groq");
  expect(variables.has("SCOUT_PICKER_MODEL")).toBe(false);
  expect(writes().filter((request) => request.url.endsWith("/actions/variables")).map((request) => request.body.name)).not.toContain("SCOUT_PICKER_PROVIDER");
  expect(writes().some((request) => request.url.includes("/actions/secrets/"))).toBe(false);
});

it("asks for the key a stage needs and writes nothing until it is given", async () => {
  secrets.set("CLAUDE_CODE_OAUTH_TOKEN", {});
  const [status, error] = await backend("/api/models", "PUT", { picker: stage("anthropic", "api-key", { model: "claude-sonnet" }), solver: stage("claude-code", "subscription") });
  expect(status).toBe(422);
  expect(error.fields).toEqual({ "picker.key": "Enter your Anthropic API key." });
  expect(writes()).toHaveLength(0);
});

it.each([
  [{ picker: stage("ruby", "api-key") }, "picker.provider"],
  [{ picker: stage("groq", "subscription") }, "picker.auth"],
  [{ picker: stage("codex", "subscription") }, "picker.auth"],
  [{ picker: stage("openai", "api-key", { key: "sk-test" }) }, "picker.model"],
  [{ picker: stage("openai-compatible", "api-key", { model: "m", key: "k", base_url: "http://example.com/v1" }) }, "picker.base_url"],
  [{ picker: stage("openai-compatible", "api-key", { model: "m", key: "k", base_url: "https://user:pass@example.com/v1" }) }, "picker.base_url"],
  [{ picker: stage("groq", "api-key", { key: "two words" }) }, "picker.key"],
])("rejects invalid model settings without writing: %j", async (change, field) => {
  secrets.set("CLAUDE_CODE_OAUTH_TOKEN", {}); secrets.set("GROQ_API_KEY", {});
  const [status, error] = await backend("/api/models", "PUT", { solver: stage("claude-code", "subscription"), ...change });
  expect(status).toBe(422);
  expect(error.fields).toHaveProperty([field]);
  expect(writes()).toHaveLength(0);
});

it("saves to a stage's own SCOUT_PICKER_API_KEY when the repository already uses one", async () => {
  secrets.set("SCOUT_PICKER_API_KEY", {}); secrets.set("CLAUDE_CODE_OAUTH_TOKEN", {});
  expect((await backend("/api/models", "PUT", { picker: stage("groq", "api-key", { key: "gsk_new" }), solver: stage("claude-code", "subscription") }))[0]).toBe(200);
  expect(decrypt("SCOUT_PICKER_API_KEY")).toBe("gsk_new");
  expect(secrets.has("GROQ_API_KEY")).toBe(false);
});

it("refuses two different keys for a secret both stages share", async () => {
  const [status, error] = await backend("/api/models", "PUT", {
    picker: stage("openai", "api-key", { model: "gpt-a", key: "sk-one" }),
    solver: stage("openai", "api-key", { model: "gpt-b", key: "sk-two" }),
  });
  expect(status).toBe(422);
  expect(error.fields).toHaveProperty(["solver.key"]);
  expect(writes()).toHaveLength(0);
});

it("requires sign-in", async () => {
  token = null;
  expect((await backend("/api/models"))[0]).toBe(401);
  expect((await backend("/api/models", "PUT", {}))[0]).toBe(401);
  expect(requests).toHaveLength(0);
});
