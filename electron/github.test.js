import { expect, it } from "vitest";
import { waitForToken } from "./github.js";

const device = { device_code: "device-1", interval: 5 };
const replying = (...replies) => async () => ({ ok: true, json: async () => replies.shift() });

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
