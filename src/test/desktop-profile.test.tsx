import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../api";
import { ApiError } from "../errors";
import { initialProfile } from "../mock/data";
import { defaultSettings } from "../mock/workflow";
import App from "../App";
import Profile from "../pages/Profile";
import ScoutSettings from "../pages/ScoutSettings";

vi.mock("../api", async (original) => ({ ...(await original<typeof import("../api")>()), isMock: false }));

const profile = { ...initialProfile, scouting: { ...initialProfile.scouting, exclude_labels: ["type: bug, regression"] }, revision: "42:main:revision" };
const settings = { ...defaultSettings, labels: ["type: bug, regression"], documentation_labels: ["docs, help"], revision: "42:main:revision", schedule_enabled: false, email_enabled: false, draft_fixes: false, tracing_enabled: false };
beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  window.location.hash = "/";
  vi.spyOn(api, "profile").mockResolvedValue(structuredClone(profile));
  vi.spyOn(api, "profileHistory").mockResolvedValue([]);
  vi.spyOn(api, "scoutSettings").mockResolvedValue(structuredClone(settings));
});

it("opens the profile editor for a connected desktop account", async () => {
  vi.spyOn(api, "me").mockResolvedValue({ login: "octocat", avatar_url: "", onboarding: "ready", repository: { id: 42, full_name: "octocat/scout", html_url: "https://github.com/octocat/scout" } });
  render(<App />);
  expect(await screen.findByRole("heading", { name: /Your profile, in your hands/ })).toBeInTheDocument();
  expect(window.location.hash).toBe("#/profile");
});

it("keeps the revision on a profile edit and omits unsupported lock controls", async () => {
  const save = vi.spyOn(api, "saveProfile").mockResolvedValue({ ...profile, summary: "My updated skills", revision: "new-revision" });
  render(<Profile />);
  fireEvent.click(await screen.findByRole("button", { name: "Edit profile" }));
  expect(screen.queryByRole("button", { name: /Allow automatic updates|Lock skill|Lock language/ })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "Profile summary" }), { target: { value: "My updated skills" } });
  fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ summary: "My updated skills", revision: profile.revision, scouting: expect.objectContaining({ exclude_labels: ["type: bug, regression"] }) })));
  expect(await screen.findByRole("status")).toHaveTextContent("Profile saved");
});

it("keeps a conflicting profile draft until the user chooses to reload", async () => {
  vi.spyOn(api, "saveProfile").mockRejectedValue(new ApiError(409, "Profile changed on GitHub."));
  render(<Profile />);
  fireEvent.click(await screen.findByRole("button", { name: "Edit profile" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Profile summary" }), { target: { value: "Unsaved draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
  const reload = await screen.findByRole("button", { name: "Reload latest profile" });
  expect(screen.getByRole("textbox", { name: "Profile summary" })).toHaveValue("Unsaved draft");
  fireEvent.click(reload);
  await waitFor(() => expect(api.profile).toHaveBeenCalledTimes(2));
  expect(await screen.findByRole("button", { name: "Edit profile" })).toBeInTheDocument();
});

it("shows actual commit links rather than invented before/after snapshots", async () => {
  vi.spyOn(api, "profileHistory").mockResolvedValue([{ at: "2026-11-08T12:00:00Z", source: "user", field: "profile", note: "Update profile", commit_url: "https://github.com/octocat/scout/commit/abc" }]);
  render(<Profile />);
  expect(await screen.findByRole("link", { name: "View changes on GitHub" })).toHaveAttribute("href", "https://github.com/octocat/scout/commit/abc");
  expect(screen.queryByText("Before")).not.toBeInTheDocument();
});

it("saves supported scouting settings with their revision and hides unavailable controls", async () => {
  const connections = vi.spyOn(api, "connections");
  const save = vi.spyOn(api, "saveScoutSettings").mockResolvedValue(settings);
  render(<ScoutSettings />);
  await screen.findByRole("heading", { name: "Discovery signals" });
  expect(screen.queryByRole("checkbox", { name: /Run my scout automatically/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("checkbox", { name: /Email my review/ })).not.toBeInTheDocument();
  expect(connections).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("textbox", { name: /Code issue labels/ }), { target: { value: "bug\nhelp wanted" } });
  fireEvent.click(screen.getByRole("button", { name: "Save scout settings" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ labels: ["bug", "help wanted"], revision: settings.revision })));
  expect(await screen.findByRole("status")).toHaveTextContent("Scout settings saved");
});

it("preserves commas in existing labels when saving unrelated scouting settings", async () => {
  const save = vi.spyOn(api, "saveScoutSettings").mockResolvedValue(settings);
  render(<ScoutSettings />);
  fireEvent.click(await screen.findByRole("button", { name: "Save scout settings" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ labels: ["type: bug, regression"], documentation_labels: ["docs, help"] })));
});

it("offers to reload scouting settings after a conflict", async () => {
  vi.spyOn(api, "saveScoutSettings").mockRejectedValue(new ApiError(409, "Profile changed on GitHub."));
  render(<ScoutSettings />);
  fireEvent.click(await screen.findByRole("button", { name: "Save scout settings" }));
  fireEvent.click(await screen.findByRole("button", { name: "Reload latest settings" }));
  await waitFor(() => expect(api.scoutSettings).toHaveBeenCalledTimes(2));
});
