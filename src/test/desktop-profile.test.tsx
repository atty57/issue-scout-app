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
  vi.spyOn(api, "models").mockResolvedValue({
    providers: [
      { id: "groq", label: "Groq", credentials: { "api-key": "GROQ_API_KEY" }, model: "optional", model_hint: "" },
      { id: "claude-code", label: "Claude Code", credentials: { subscription: "CLAUDE_CODE_OAUTH_TOKEN" }, model: "optional", model_hint: "" },
    ],
    secrets: [], picker: { provider: "groq", auth: "api-key", model: "", base_url: "" }, solver: { provider: "claude-code", auth: "subscription", model: "", base_url: "" }, ready: false,
  });
  vi.spyOn(api, "schedule").mockResolvedValue({ revision: "42:main:sha", enabled: false, custom: false, time: "09:30", timezone: "UTC", setup_required: false });
  vi.spyOn(api, "email").mockResolvedValue({ available: false });
});

it("opens Runs as the primary workspace for a connected desktop account", async () => {
  vi.spyOn(api, "me").mockResolvedValue({ login: "octocat", avatar_url: "", onboarding: "ready", repository: { id: 42, full_name: "octocat/scout", html_url: "https://github.com/octocat/scout" } });
  render(<App />);
  expect(await screen.findByRole("heading", { name: "Your runs & reports" })).toBeInTheDocument();
  expect(window.location.hash).toBe("#/runs");
});

it("clears a failed sign-in message after the next successful sign-in", async () => {
  vi.spyOn(api, "me").mockRejectedValue(new ApiError(401, "Signed out"));
  vi.spyOn(api, "runs").mockResolvedValue([]);
  vi.spyOn(api, "startLogin").mockRejectedValueOnce(new Error("Previous sign-in failed"))
    .mockResolvedValue({ user_code: "OFFLINE", verification_uri: "https://github.com/login/device" });
  vi.spyOn(api, "finishLogin").mockResolvedValue({ login: "octocat", avatar_url: "", onboarding: "ready", repository: { id: 42, full_name: "octocat/scout", html_url: "https://github.com/octocat/scout" } });
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Sign in with GitHub" }));
  await screen.findByText("Previous sign-in failed");
  fireEvent.click(screen.getByRole("button", { name: "Sign in with GitHub" }));
  await screen.findByRole("heading", { name: "Your runs & reports" });
  expect(screen.queryByText("Previous sign-in failed")).not.toBeInTheDocument();
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

it("offers Go, Rust, Java and C++ only when the Scout repository's engine runs them", async () => {
  const options = () => [...(screen.getAllByRole("combobox", { name: /Language 1/ })[0] as HTMLSelectElement).options].map((option) => option.text);
  const all = ["Python", "TypeScript", "JavaScript", "C#", "C", "Go", "Rust", "Java", "C++"];
  vi.spyOn(api, "profile").mockResolvedValueOnce({ ...structuredClone(profile), supported_languages: ["python", "javascript", "typescript", "csharp", "c", "go", "rust", "java", "cpp"] });
  const { unmount } = render(<Profile />);
  fireEvent.click(await screen.findByRole("button", { name: "Edit profile" }));
  expect(options()).toEqual(all);
  expect(screen.queryByText(/need a Scout repository created from the latest/)).not.toBeInTheDocument();
  unmount();
  // An engine from before scout.json runs only the first five; a newer language already saved stays visible.
  vi.spyOn(api, "profile").mockResolvedValueOnce({
    ...structuredClone(profile), languages: [{ value: "go", sources: ["profile.json"], locked: true }],
    supported_languages: ["python", "javascript", "typescript", "csharp", "c"],
  });
  render(<Profile />);
  fireEvent.click(await screen.findByRole("button", { name: "Edit profile" }));
  expect(options()).toEqual(["Python", "TypeScript", "JavaScript", "C#", "C", "Go"]);
  expect(screen.getByText("Go, Rust, Java, C++ need a Scout repository created from the latest Issue Scout template.")).toBeInTheDocument();
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
  // Discovery no longer mixes scheduling into the same screen. Its own section remains linked.
  expect(screen.queryByRole("checkbox", { name: /Run my scout automatically/ })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Schedule" })).toHaveAttribute("href", "#/scout-settings/schedule");
  expect(screen.queryByRole("checkbox", { name: /Draft a fix/ })).not.toBeInTheDocument();
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

it("keeps independent Discovery, Models, Schedule and Email drafts while changing settings sections", async () => {
  vi.spyOn(api, "email").mockResolvedValue({ available: true, ready: true, revision: "42:main:email", email: "", enabled: false, confirmed: false, code_sent: false });
  const discoverySave = vi.spyOn(api, "saveScoutSettings");
  const modelsSave = vi.spyOn(api, "saveModels");
  const scheduleSave = vi.spyOn(api, "saveSchedule");
  const emailSave = vi.spyOn(api, "saveEmail");
  const view = render(<ScoutSettings />);
  fireEvent.change(await screen.findByRole("textbox", { name: /Code issue labels/ }), { target: { value: "bug\nregression" } });
  expect(screen.getByRole("link", { name: "Email" })).toHaveAttribute("href", "#/scout-settings/email");
  view.rerender(<ScoutSettings section="models" />);
  fireEvent.change(await screen.findByLabelText(/Groq API key/), { target: { value: "typed-only-in-memory" } });
  view.rerender(<ScoutSettings section="schedule" />);
  fireEvent.click(await screen.findByRole("checkbox", { name: /Run my scout automatically/ }));
  fireEvent.change(screen.getByLabelText("Daily run time"), { target: { value: "11:45" } });
  view.rerender(<ScoutSettings section="email" />);
  fireEvent.change(await screen.findByLabelText(/^Email address/), { target: { value: "new@example.com" } });
  view.rerender(<ScoutSettings section="discovery" />);
  expect(screen.getByRole("textbox", { name: /Code issue labels/ })).toHaveValue("bug\nregression");
  expect(screen.getByLabelText(/Groq API key/)).not.toBeVisible();
  view.rerender(<ScoutSettings section="models" />);
  expect(screen.getByLabelText(/Groq API key/)).toHaveValue("typed-only-in-memory");
  view.rerender(<ScoutSettings section="schedule" />);
  expect(screen.getByLabelText("Daily run time")).toHaveValue("11:45");
  view.rerender(<ScoutSettings section="email" />);
  expect(screen.getByLabelText(/^Email address/)).toHaveValue("new@example.com");
  expect(screen.getByRole("checkbox", { name: /Email me each/ })).toBeDisabled();
  [discoverySave, modelsSave, scheduleSave, emailSave].forEach(save => expect(save).not.toHaveBeenCalled());
});

it("offers to reload scouting settings after a conflict", async () => {
  vi.spyOn(api, "saveScoutSettings").mockRejectedValue(new ApiError(409, "Profile changed on GitHub."));
  render(<ScoutSettings />);
  fireEvent.click(await screen.findByRole("button", { name: "Save scout settings" }));
  fireEvent.click(await screen.findByRole("button", { name: "Reload latest settings" }));
  await waitFor(() => expect(api.scoutSettings).toHaveBeenCalledTimes(2));
});

it("keeps the Email section, with its error and a retry, when the email check fails", async () => {
  vi.spyOn(api, "email").mockRejectedValue(new ApiError(503, "GitHub is unavailable."));
  render(<ScoutSettings section="email" />);
  expect(await screen.findByRole("link", { name: "Email" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByText("GitHub is unavailable.")).toBeInTheDocument();
  // No relay in this build is the only case that hides it.
  vi.spyOn(api, "email").mockResolvedValue({ available: false });
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(screen.queryByRole("link", { name: "Email" })).not.toBeInTheDocument());
});

it("drops Schedule's finish-setup hint once Models saves a complete setup, and points to Models until then", async () => {
  vi.spyOn(api, "schedule").mockResolvedValue({ revision: "42:main:sha", enabled: false, custom: false, time: "09:30", timezone: "UTC", setup_required: true });
  const models = await api.models();
  vi.spyOn(api, "saveModels").mockResolvedValue({ ...models, ready: true });
  render(<ScoutSettings section="models" />);
  expect(await screen.findByText(/save a model and key for both stages in Models/)).toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: "Save models" }));
  await waitFor(() => expect(screen.queryByText(/Finish setup first/)).not.toBeInTheDocument());
});

it("opens Discovery for an unknown settings address instead of a dead end", async () => {
  vi.spyOn(api, "me").mockResolvedValue({ login: "octocat", avatar_url: "", onboarding: "ready", repository: { id: 42, full_name: "octocat/scout", html_url: "https://github.com/octocat/scout" } });
  vi.spyOn(api, "windowTheme").mockResolvedValue(undefined);
  window.location.hash = "/scout-settings/nope";
  render(<App />);
  expect(await screen.findByRole("link", { name: "Discovery" })).toHaveAttribute("aria-current", "page");
  expect(screen.queryByText("This trail ends here.")).not.toBeInTheDocument();
});
