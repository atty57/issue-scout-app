import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import App from "../App";
import { api } from "../api";
import { mockRequest } from "../mock/server";
import type { Me } from "../types";

// The real desktop transport, not just the desktop flag: every page request goes through window.scout.request
// (the IPC bridge), so the test sees the exact routes the pages ask main for.
vi.hoisted(() => vi.stubEnv("VITE_API_MODE", "desktop"));

const me: Me = {
  login: "octocat", avatar_url: "", onboarding: "ready",
  repository: { id: 42, full_name: "octocat/scout", html_url: "https://github.com/octocat/scout" },
};
let requests: Set<string>;

// What each page loads on open; anything else gets the desktop backend's own "not in the desktop app yet".
async function answer(path: string, method: string) {
  requests.add(`${method} ${path}`);
  if (method !== "GET") return [501, { error: "This part of Issue Scout isn't in the desktop app yet." }];
  if (path === "/api/me") return [200, me];
  if (path === "/api/runs") return [200, []];
  if (path === "/api/history") return [200, { items: [], skipped: 0 }];
  if (path === "/api/email") return [200, { available: false }];
  if (["/api/profile", "/api/profile/history", "/api/scout/settings"].includes(path)) return [200, await mockRequest(path, { method })];
  if (["/api/models", "/api/schedule"].includes(path)) return [503, { error: "GitHub is unavailable." }];
  return [501, { error: "This part of Issue Scout isn't in the desktop app yet." }];
}

beforeEach(() => {
  requests = new Set();
  window.location.hash = "";
  Object.assign(window, { scout: { request: vi.fn(answer) } });
});

async function open(hash: string) {
  await act(async () => {
    window.location.hash = hash;
    await new Promise((done) => setTimeout(done, 0));
  });
}

it("shows only pages the engine supports, and every page calls only routes the desktop backend serves", async () => {
  render(<App />);
  const nav = await screen.findByRole("navigation", { name: "Main navigation" });
  expect(within(nav).getAllByRole("link").map((link) => link.getAttribute("aria-label")))
    .toEqual(["Runs & reports", "Your profile", "History", "Scout settings", "Account"]);
  const pages: [string, () => Promise<unknown>][] = [
    ["#/runs", () => screen.findByText("Your runs & reports")],
    ["#/profile", () => screen.findByRole("button", { name: "Edit profile" })],
    ["#/history", () => screen.findByText("Your contribution trail starts here.")],
    ["#/scout-settings", () => screen.findByRole("button", { name: "Save scout settings" })],
    ["#/scout-settings/models", () => screen.findByRole("link", { name: "Models", current: "page" })],
    ["#/scout-settings/schedule", () => screen.findByRole("link", { name: "Schedule", current: "page" })],
    ["#/scout-settings/email", () => screen.findByRole("heading", { name: "Email is unavailable" })],
    ["#/settings", () => screen.findByRole("heading", { name: "Your Scout repository" })],
    // The shortlist and projects are demo-only: home opens the runs, and projects is a dead end.
    ["#/", () => screen.findByText("Your runs & reports")],
    ["#/projects", () => screen.findByRole("link", { name: "Back to your runs" })],
  ];
  for (const [hash, opened] of pages) {
    await open(hash);
    expect(await opened()).toBeInTheDocument();
  }
  expect(screen.queryByRole("heading", { name: /Your projects tell a story/ })).not.toBeInTheDocument();
  // Ask the desktop's real router about every request the pages made. A route it lacks answers 501
  // before any sign-in or network check.
  const backendModule = "../../electron/backend.js";
  const { createBackend } = await import(/* @vite-ignore */ backendModule);
  const backend = createBackend({
    tokens: { load: () => null, clear: () => {} }, repositories: { get: () => undefined },
    fetchImpl: async () => { throw new Error("offline test"); },
  });
  expect(requests.size).toBeGreaterThanOrEqual(8);
  for (const request of requests) {
    const [method, path] = request.split(" ");
    expect([request, (await backend(path, method))[0]]).not.toEqual([request, 501]);
  }
});

it("keeps Runs & reports selected and named on a run page", async () => {
  render(<App />);
  await screen.findByRole("navigation", { name: "Main navigation" });
  await open("#/runs/7");
  const nav = screen.getByRole("navigation", { name: "Main navigation" });
  expect(within(nav).getByRole("link", { name: "Runs & reports" })).toHaveAttribute("aria-current", "page");
  expect(within(nav).getAllByRole("link").filter((link) => link.getAttribute("aria-current"))).toHaveLength(1);
  expect(document.title).toBe("Runs & reports · Issue Scout");
});

it("offers only what the desktop supports on Account, and connects a different repository", async () => {
  const disconnect = vi.spyOn(api, "disconnectRepository").mockResolvedValue({ ...me, onboarding: "needs_repository", repository: undefined });
  window.location.hash = "#/settings";
  render(<App />);
  expect(await screen.findByRole("heading", { name: "Your Scout repository" })).toBeInTheDocument();
  expect(screen.queryByText(/Update your resume/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Delete my account/ })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Repository settings on GitHub/ })).toHaveAttribute("href", "https://github.com/octocat/scout/settings");
  // What's kept where, and what signing out or deleting the repository doesn't clear.
  expect(screen.getByText(/your address and whether it’s confirmed\. Signing out removes only the sign-in\./)).toBeInTheDocument();
  expect(screen.getByText(/email service keeps the address you confirmed/)).toHaveTextContent(
    /keeps delivery records to prevent duplicates and enforce limits\. Older records are cleaned up during subsequent sending activity\..*Resend.*Turning email off, signing out or deleting your repository doesn’t remove any of this/);
  expect(screen.queryByText(/100 days/)).not.toBeInTheDocument(); // cleanup only runs on later sends, so no fixed retention is promised
  expect(screen.queryByText(/keeps only your GitHub sign-in/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Use a different repository" }));
  fireEvent.click(screen.getByRole("button", { name: "Keep octocat/scout" }));
  expect(disconnect).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Use a different repository" }));
  fireEvent.click(screen.getByRole("button", { name: "Disconnect and choose another" }));
  expect(await screen.findByText("Create a private repository")).toBeInTheDocument(); // repository setup, nothing deleted
  expect(disconnect).toHaveBeenCalledTimes(1);
});
