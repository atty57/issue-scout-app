import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("sends repository setup as structured data through the real desktop transport", async () => {
  vi.stubEnv("VITE_API_MODE", "desktop");
  vi.resetModules();
  const connected = { login: "octocat", avatar_url: "", onboarding: "ready" };
  const request = vi.fn().mockResolvedValue([200, connected]);
  const previous = window.scout;
  window.scout = { request };
  try {
    const { api, isMock } = await import("../api");
    expect(isMock).toBe(false);
    await expect(api.setupRepository({ mode: "connect", repo: "octocat/issue-scout" })).resolves.toEqual(connected);
    expect(request).toHaveBeenCalledWith("/api/repository", "POST", { mode: "connect", repo: "octocat/issue-scout" });
  } finally {
    window.scout = previous;
  }
});

it("reloads the account when the desktop backend says the repository must be reconnected", async () => {
  vi.stubEnv("VITE_API_MODE", "desktop");
  vi.resetModules();
  const previous = window.scout;
  window.scout = { request: vi.fn().mockResolvedValue([422, { error: "Your repository has moved.", reconnect: true }]) };
  const changed = vi.fn();
  window.addEventListener("issue-scout:account-changed", changed);
  try {
    const { api } = await import("../api");
    await expect(api.profile()).rejects.toThrow("Your repository has moved.");
    expect(changed).toHaveBeenCalledTimes(1);
  } finally {
    window.removeEventListener("issue-scout:account-changed", changed);
    window.scout = previous;
  }
});

it("carries a rate-limit delay through the real desktop transport", async () => {
  vi.stubEnv("VITE_API_MODE", "desktop");
  vi.resetModules();
  const previous = window.scout;
  window.scout = { request: vi.fn().mockResolvedValue([429, { error: "Rate limited", retryAfter: 120 }]) };
  try {
    const { api } = await import("../api");
    await expect(api.run("9")).rejects.toMatchObject({ status: 429, retryAfter: 120 });
  } finally { window.scout = previous; }
});
