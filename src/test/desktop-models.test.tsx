import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../api";
import { ApiError } from "../errors";
import ModelSettings from "../pages/ModelSettings";
import type { ModelSettings as Models } from "../types";

const models: Models = {
  providers: [
    { id: "groq", label: "Groq", credentials: { "api-key": "GROQ_API_KEY" }, model: "optional", model_hint: "openai/gpt-oss-120b" },
    { id: "anthropic", label: "Anthropic", credentials: { "api-key": "ANTHROPIC_API_KEY" }, model: "required", model_hint: "" },
    { id: "claude-code", label: "Claude Code", credentials: { subscription: "CLAUDE_CODE_OAUTH_TOKEN", "api-key": "ANTHROPIC_API_KEY" }, model: "optional", model_hint: "CLI default" },
  ],
  secrets: ["GROQ_API_KEY"],
  picker: { provider: "groq", auth: "api-key", model: "", base_url: "" },
  solver: { provider: "claude-code", auth: "subscription", model: "", base_url: "" },
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
  const save = vi.spyOn(api, "saveModels").mockResolvedValue({ ...models, secrets: ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "GROQ_API_KEY"], picker: { provider: "anthropic", auth: "api-key", model: "claude-sonnet", base_url: "" } });
  render(<ModelSettings />);
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
});

it("shows the backend's field errors next to their fields", async () => {
  vi.spyOn(api, "saveModels").mockRejectedValue(new ApiError(422, "Check the highlighted model settings.", { "solver.key": "Paste your Claude Code OAuth token." }));
  render(<ModelSettings />);
  fireEvent.click(await screen.findByRole("button", { name: "Save models" }));
  expect(await screen.findByText("Paste your Claude Code OAuth token.")).toBeInTheDocument();
  expect(screen.getByText("Check the highlighted model settings.")).toBeInTheDocument();
});
