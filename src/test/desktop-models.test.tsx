import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../api";
import { ApiError } from "../errors";
import ModelSettings from "../pages/ModelSettings";
import type { ModelSettings as Models } from "../types";

const models: Models = {
  providers: [
    { id: "groq", label: "Groq", stages: ["picker"], credentials: { "api-key": "GROQ_API_KEY" }, model: "optional", model_hint: "openai/gpt-oss-120b" },
    { id: "anthropic", label: "Anthropic", credentials: { "api-key": "ANTHROPIC_API_KEY" }, model: "required", model_hint: "" },
    { id: "claude-code", label: "Claude Code", credentials: { subscription: "CLAUDE_CODE_OAUTH_TOKEN", "api-key": "ANTHROPIC_API_KEY" }, model: "optional", model_hint: "CLI default" },
  ],
  secrets: ["GROQ_API_KEY"],
  picker: { provider: "groq", auth: "api-key", model: "", base_url: "" },
  solver: { provider: "claude-code", auth: "subscription", model: "", base_url: "" },
  ready: false,
};
beforeEach(() => {
  vi.spyOn(api, "models").mockResolvedValue(structuredClone(models));
});

it("shows which keys are saved and asks only for the missing ones", async () => {
  render(<ModelSettings />);
  expect(await screen.findByText("Saved as GROQ_API_KEY.")).toBeInTheDocument();
  expect(screen.getByLabelText(/Groq API key/)).toHaveAttribute("placeholder", "Saved · leave blank to keep it");
  expect(screen.getByLabelText(/Claude Code OAuth token/)).toHaveValue("");
  expect(screen.getByText("Run claude setup-token to create one.")).toBeInTheDocument();
});

it("switches a stage's provider and saves its model and key", async () => {
  const save = vi.spyOn(api, "saveModels").mockResolvedValue({ ...models, secrets: ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "GROQ_API_KEY"], picker: { provider: "anthropic", auth: "api-key", model: "claude-sonnet", base_url: "" }, ready: true });
  render(<ModelSettings />);
  expect(await screen.findByText("Setup needed")).toBeInTheDocument();
  fireEvent.change(await screen.findByRole("combobox", { name: "Issue picking provider" }), { target: { value: "anthropic" } });
  expect(screen.getByText("Will be saved as ANTHROPIC_API_KEY.")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: /Issue picking model/ }), { target: { value: "claude-sonnet" } });
  fireEvent.change(screen.getByLabelText(/Anthropic API key/), { target: { value: "sk-ant-test" } });
  fireEvent.change(screen.getByLabelText(/Claude Code OAuth token/), { target: { value: "sk-ant-oat01-test" } });
  fireEvent.click(screen.getByRole("button", { name: "Save models" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({
    picker: { provider: "anthropic", auth: "api-key", model: "claude-sonnet", base_url: "", key: "sk-ant-test" },
    solver: { provider: "claude-code", auth: "subscription", model: "", base_url: "", key: "sk-ant-oat01-test" },
  }));
  expect(await screen.findByRole("status")).toHaveTextContent("Models saved");
  expect(screen.getByLabelText(/Anthropic API key/)).toHaveValue("");
  expect(screen.getByText("Setup complete")).toBeInTheDocument();
});

it("shows the backend's setup readiness, not just which keys are saved", async () => {
  vi.spyOn(api, "models").mockResolvedValue({ ...structuredClone(models), secrets: ["CLAUDE_CODE_OAUTH_TOKEN", "GROQ_API_KEY"] });
  render(<ModelSettings />);
  expect(await screen.findByText("Saved as CLAUDE_CODE_OAUTH_TOKEN.")).toBeInTheDocument();
  expect(screen.getByText("Setup needed")).toBeInTheDocument();
  expect(screen.queryByText("Setup complete")).not.toBeInTheDocument();
});

it("offers Groq for issue picking only, and flags a repository still using it for fixes", async () => {
  render(<ModelSettings />);
  const solverOptions = () => [...(screen.getByRole("combobox", { name: "Fix drafting provider" }) as HTMLSelectElement).options].map((option) => option.value);
  await screen.findByRole("combobox", { name: "Fix drafting provider" });
  expect(solverOptions()).not.toContain("groq");
  expect([...(screen.getByRole("combobox", { name: "Issue picking provider" }) as HTMLSelectElement).options].map((option) => option.value)).toContain("groq");
  expect(screen.queryByText(/can’t draft fixes/)).not.toBeInTheDocument();

  vi.spyOn(api, "models").mockResolvedValue({ ...structuredClone(models), solver: { provider: "groq", auth: "api-key", model: "", base_url: "" } });
  render(<ModelSettings />);
  expect(await screen.findByText(/Groq can pick issues but can’t draft fixes/)).toBeInTheDocument();
});

it("shows the backend's field errors next to their fields", async () => {
  vi.spyOn(api, "saveModels").mockRejectedValue(new ApiError(422, "Check the highlighted model settings.", { "solver.key": "Paste your Claude Code OAuth token." }));
  render(<ModelSettings />);
  fireEvent.click(await screen.findByRole("button", { name: "Save models" }));
  expect(await screen.findByText("Paste your Claude Code OAuth token.")).toBeInTheDocument();
  expect(screen.getByText("Check the highlighted model settings.")).toBeInTheDocument();
});

it("discards a typed key when switching providers while keeping the other stage's token", async () => {
  const save = vi.spyOn(api, "saveModels").mockResolvedValue(models);
  render(<ModelSettings />);
  fireEvent.change(await screen.findByLabelText(/Groq API key/), { target: { value: "gsk-wrong-provider" } });
  fireEvent.change(screen.getByLabelText(/Claude Code OAuth token/), { target: { value: "solver-token" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Issue picking provider" }), { target: { value: "anthropic" } });
  expect(screen.getByLabelText(/Anthropic API key/)).toHaveValue("");
  fireEvent.change(screen.getByRole("textbox", { name: /Issue picking model/ }), { target: { value: "claude-sonnet" } });
  fireEvent.click(screen.getByRole("button", { name: "Save models" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({
    picker: { provider: "anthropic", auth: "api-key", model: "claude-sonnet", base_url: "", key: "" },
    solver: { ...models.solver, key: "solver-token" },
  }));
});

it("discards typed credentials when switching between subscription and API-key authentication", async () => {
  const save = vi.spyOn(api, "saveModels").mockResolvedValue(models);
  render(<ModelSettings />);
  fireEvent.change(await screen.findByLabelText(/Claude Code OAuth token/), { target: { value: "oauth-token" } });
  const auth = screen.getByRole("combobox", { name: "Fix drafting sign-in" });
  fireEvent.change(auth, { target: { value: "api-key" } });
  expect(screen.getByLabelText(/Claude Code API key/)).toHaveValue("");
  fireEvent.change(screen.getByLabelText(/Claude Code API key/), { target: { value: "anthropic-key" } });
  fireEvent.change(auth, { target: { value: "subscription" } });
  expect(screen.getByLabelText(/Claude Code OAuth token/)).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "Save models" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({
    picker: { ...models.picker, key: "" }, solver: { ...models.solver, key: "" },
  }));
});

it.each([
  ["codex", "Codex", "CODEX_API_KEY"],
  ["openai-compatible", "OpenAI-compatible endpoint", "SCOUT_API_KEY"],
])("recognizes the saved OpenAI key fallback when choosing %s", async (id, label, primary) => {
  vi.spyOn(api, "models").mockResolvedValue({
    ...structuredClone(models), secrets: ["OPENAI_API_KEY"],
    providers: [...models.providers, {
      id, label, credentials: { "api-key": primary }, api_key_fallback: "OPENAI_API_KEY",
      model: "optional", model_hint: "",
    }],
  });
  const save = vi.spyOn(api, "saveModels").mockResolvedValue(models);
  render(<ModelSettings />);
  fireEvent.change(await screen.findByRole("combobox", { name: "Issue picking provider" }), { target: { value: id } });
  expect(screen.getByText("Saved as OPENAI_API_KEY.")).toBeInTheDocument();
  expect(screen.getByLabelText(new RegExp(`${label} API key`))).toHaveAttribute("placeholder", "Saved · leave blank to keep it");
  fireEvent.click(screen.getByRole("button", { name: "Save models" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({
    picker: { provider: id, auth: "api-key", model: "", base_url: "", key: "" },
  })));
});
