import { expect, it } from "vitest";
import { githubRequest, waitForToken } from "./github.js";

const device = { device_code: "device-1", interval: 5 };
const replying = (...replies) => async () => ({ ok: true, json: async () => replies.shift() });

it.each([
  [403, { "retry-after": "120" }, 120],
  [429, { "retry-after": "12.5" }, 13],
  [403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "2000000120" }, 120],
  [429, { "retry-after": "30", "x-ratelimit-remaining": "0", "x-ratelimit-reset": "2000000120" }, 120],
  [429, {}, 60],
  [429, { "retry-after": "invalid" }, 60],
  [429, { "retry-after": "-1" }, 60],
])("keeps a safe retry delay for HTTP %s with headers %j", async (status, headers, expected) => {
  const now = Date.now;
  Date.now = () => 2000000000000;
  try {
    const error = await githubRequest("offline-token", "/user", {
      fetchImpl: async () => new Response(JSON.stringify({ message: "Rate limited" }), { status, headers }),
    }).catch(error => error);
    expect(error).toMatchObject({ status: 429, retryAfter: expected });
  } finally { Date.now = now; }
});

it("does not turn an ordinary permission error into a rate limit", async () => {
  const error = await githubRequest("offline-token", "/user", {
    fetchImpl: async () => new Response("{}", { status: 403 }),
  }).catch(error => error);
  expect(error.status).toBe(403);
  expect(error.retryAfter).toBeUndefined();
});

it("keeps polling until the user approves, slowing down when GitHub asks", async () => {
  const waits = [];
  const fetchImpl = replying({ error: "authorization_pending" }, { error: "slow_down", interval: 10 }, { access_token: "token-1" });
  await expect(waitForToken("client", device, { fetchImpl, sleep: async (ms) => waits.push(ms) })).resolves.toBe("token-1");
  expect(waits).toEqual([5000, 5000, 10000]);
});

it.each([
  ["access_denied", "cancelled"],
  ["expired_token", "expired"],
])("stops with a clear message when GitHub answers %s", async (error, message) => {
  await expect(waitForToken("client", device, { fetchImpl: replying({ error }), sleep: async () => {} })).rejects.toThrow(message);
});
